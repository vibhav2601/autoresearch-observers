import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import express from "express";
import type { Express } from "express";
import { loadWorkspaceEnv } from "../loadEnv.ts";
import { DEFAULT_THRESHOLDS, runDetectors, type FiringFacts, type Pattern } from "./detection.ts";
import { buildPrompt } from "./prompts.ts";
import type { WorkshopRun, WorkshopRunDetail } from "./types.ts";

loadWorkspaceEnv(import.meta.url);

const DEFAULT_PORT = Number(process.env.PORT ?? 3031);
const DEFAULT_MODEL = process.env.OPENCODE_OBSERVER_MODEL ?? "openai/gpt-4o-mini";
const WORKSHOP_BASE = process.env.RAINDROP_WORKSHOP_URL ?? "http://localhost:5899";
const OPENCODE_CONTROL_URL = process.env.OPENCODE_CONTROL_URL ?? "http://localhost:3032";
const WATCH_EVENT_NAME = process.env.OPENCODE_OBSERVER_WATCH_EVENT ?? "opencode_session";
const WATCH_POLL_MS = Number(process.env.OPENCODE_OBSERVER_POLL_MS ?? 2000);
const COOLDOWN_MS = Number(process.env.OPENCODE_OBSERVER_COOLDOWN_MS ?? 30_000);

const PLUGIN_PACKAGE = "@raindrop-ai/opencode-plugin";
const PLUGIN_LINK_TARGET = path.resolve(
  fileURLToPath(import.meta.url),
  "..",
  "node_modules",
  PLUGIN_PACKAGE,
);

interface ObserveRequest {
  runId?: string;
  model?: string;
  pattern?: Pattern;
}

interface VetoRequest {
  sessionID?: string;
  callID?: string;
  tool?: string;
  args?: unknown;
  ts?: number;
}

interface FiringRecord {
  fingerprint: string;
  inFlight: boolean;
  lastFiredAt: number;
}

let workspaceDir: string | null = null;

function workspace(): string {
  if (workspaceDir) return workspaceDir;
  const dir = path.join(tmpdir(), `raindrop-opencode-observer-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        plugin: existsSync(PLUGIN_LINK_TARGET) ? [`file://${PLUGIN_LINK_TARGET}`] : [],
      },
      null,
      2,
    ),
  );
  writeFileSync(path.join(dir, "README.md"), "# Raindrop Observer Workspace\n\nOpenCode runs here as a traced observer agent.\n");
  workspaceDir = dir;
  return dir;
}

function envForObserver(cwd: string, observedRunId: string, pattern: Pattern): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PWD: cwd,
    HOME: homedir(),
    RAINDROP_LOCAL_DEBUGGER: process.env.RAINDROP_LOCAL_DEBUGGER ?? `${WORKSHOP_BASE}/v1/`,
    RAINDROP_EVENT_METADATA: JSON.stringify({
      eventName: "observer_agent_session",
      userId: "opencode-observer",
      convoId: `observer:${observedRunId}:${pattern}`,
      properties: {
        role: "observer",
        observedRunId,
        observerKind: "harness-detected",
        pattern,
      },
    }),
  };
}

function fingerprintFiring(facts: FiringFacts): string {
  switch (facts.pattern) {
    case "stall": {
      const e = facts.evidence as { idleMs: number };
      return `stall:${facts.scope}:${Math.floor(e.idleMs / 30_000)}`;
    }
    case "repeat_loop": {
      const e = facts.evidence as { count: number };
      return `repeat:${facts.scope}:${e.count}`;
    }
    case "error_burst": {
      const e = facts.evidence as { count: number };
      return `error:${facts.scope}:${e.count}`;
    }
    case "empty_search": {
      const e = facts.evidence as { emptyCount: number };
      return `empty:${facts.scope}:${e.emptyCount}`;
    }
    case "wrong_path": {
      const e = facts.evidence as { failedCount: number };
      return `wrongpath:${facts.scope}:${e.failedCount}`;
    }
    case "prompt_drift": {
      const e = facts.evidence as { consecutiveLow: number };
      return `drift:${facts.scope}:${e.consecutiveLow}`;
    }
  }
}

async function runObserverOnce(
  observedRunId: string,
  prompt: string,
  pattern: Pattern,
  model: string,
  onChunk: (chunk: Buffer | string) => void,
): Promise<number> {
  const cwd = workspace();
  const child = spawn(
    "opencode",
    [
      "run",
      "--format",
      "default",
      "--dangerously-skip-permissions",
      "--model",
      model,
      prompt,
    ],
    {
      cwd,
      env: envForObserver(cwd, observedRunId, pattern),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  return new Promise((resolve) => {
    child.once("error", (err) => {
      onChunk(`\n[spawn error] ${err.message}`);
      resolve(1);
    });
    child.once("close", (code) => resolve(code ?? 0));
  });
}

function shouldTrackRun(run: WorkshopRun, serviceStartedAt: number): boolean {
  if (!run.id || run.event_name !== WATCH_EVENT_NAME) return false;
  if (run.user_id === "opencode-observer") return false;
  try {
    const metadata = run.metadata ? JSON.parse(run.metadata) : null;
    if (metadata?.role === "observer" || metadata?.observedRunId) return false;
  } catch {}
  if (!run.finished) return true;
  return (run.started_at ?? 0) >= serviceStartedAt - 1000;
}

async function getRunDetail(runId: string): Promise<WorkshopRunDetail | null> {
  try {
    const res = await fetch(`${WORKSHOP_BASE}/api/runs/detail/${encodeURIComponent(runId)}`);
    if (!res.ok) return null;
    return (await res.json()) as WorkshopRunDetail;
  } catch {
    return null;
  }
}

function textContains(value: unknown, needle: string): boolean {
  if (typeof value === "string") return value.includes(needle);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => textContains(item, needle));
  return Object.values(value as Record<string, unknown>).some((item) => textContains(item, needle));
}

function startAutoWatch(serviceStartedAt: number) {
  const firings = new Map<string, FiringRecord>();
  let stopped = false;
  let inFlight = false;

  function keyFor(scope: string, pattern: Pattern): string {
    return `${scope}::${pattern}`;
  }

  function startPass(run: WorkshopRun, facts: FiringFacts, fingerprint: string, record: FiringRecord) {
    record.inFlight = true;
    record.lastFiredAt = Date.now();
    record.fingerprint = fingerprint;
    const prompt = buildPrompt({
      observedRunId: run.id,
      workshopBase: WORKSHOP_BASE,
      controlUrl: OPENCODE_CONTROL_URL,
      facts,
    });
    const targetTag = facts.subagentSpanId ? facts.subagentSpanId.slice(0, 8) : "main";
    console.log(`[observer] firing ${facts.pattern} on ${run.id.slice(0, 8)}/${targetTag} (${facts.subagentLabel}): ${facts.summary}`);
    runObserverOnce(
      run.id,
      prompt,
      facts.pattern,
      DEFAULT_MODEL,
      (chunk) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        for (const line of text.split("\n")) {
          if (line.trim()) console.log(`[observer:${run.id.slice(0, 8)}/${targetTag}:${facts.pattern}] ${line}`);
        }
      },
    )
      .then((code) => {
        console.log(`[observer] completed ${facts.pattern} pass on ${run.id.slice(0, 8)}/${targetTag} exit=${code}`);
      })
      .catch((err) => {
        console.error(`[observer] failed ${facts.pattern} pass on ${run.id.slice(0, 8)}/${targetTag}:`, err);
      })
      .finally(() => {
        record.inFlight = false;
      });
  }

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const res = await fetch(`${WORKSHOP_BASE}/api/runs`);
      if (!res.ok) return;
      const runs = (await res.json()) as WorkshopRun[];
      const candidates = runs
        .filter((run) => shouldTrackRun(run, serviceStartedAt))
        .sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0));
      const now = Date.now();
      for (const run of candidates) {
        const detail = await getRunDetail(run.id);
        if (!detail) continue;
        const firingsForRun = runDetectors(run, detail, now, DEFAULT_THRESHOLDS);
        for (const facts of firingsForRun) {
          const key = keyFor(facts.scope, facts.pattern);
          const fingerprint = fingerprintFiring(facts);
          let record = firings.get(key);
          if (!record) {
            record = { fingerprint: "", inFlight: false, lastFiredAt: 0 };
            firings.set(key, record);
          }
          if (record.inFlight) continue;
          if (record.fingerprint === fingerprint) continue;
          if (now - record.lastFiredAt < COOLDOWN_MS) continue;
          startPass(run, facts, fingerprint, record);
        }
      }
    } catch (err) {
      console.error("[observer] watch poll failed:", err);
    } finally {
      inFlight = false;
    }
  }

  const interval = setInterval(() => {
    void tick();
  }, Math.max(500, WATCH_POLL_MS));
  void tick();
  return {
    firings,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

export function createApp(): Express {
  const serviceStartedAt = Date.now();
  const watcher = startAutoWatch(serviceStartedAt);
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "opencode-observer-agent",
      workshop: WORKSHOP_BASE,
      watchingEvent: WATCH_EVENT_NAME,
      model: DEFAULT_MODEL,
      pollMs: WATCH_POLL_MS,
      cooldownMs: COOLDOWN_MS,
      thresholds: DEFAULT_THRESHOLDS,
      firings: [...watcher.firings.entries()].map(([key, rec]) => ({
        key,
        fingerprint: rec.fingerprint,
        inFlight: rec.inFlight,
        lastFiredAt: rec.lastFiredAt,
      })),
    });
  });

  app.post("/observe", async (req, res) => {
    const body = (req.body ?? {}) as ObserveRequest;
    const runId = body.runId?.trim();
    const pattern = body.pattern;
    if (!runId) {
      res.status(400).type("text/plain").send("runId required");
      return;
    }
    const detail = await getRunDetail(runId);
    if (!detail) {
      res.status(404).type("text/plain").send("run not found in Workshop");
      return;
    }
    const firings = runDetectors({ id: runId } as WorkshopRun, detail, Date.now(), DEFAULT_THRESHOLDS);
    const facts = pattern ? firings.find((f) => f.pattern === pattern) : firings[0];
    if (!facts) {
      res
        .status(200)
        .type("text/plain")
        .send(`no detector fired for run ${runId}${pattern ? ` (pattern=${pattern})` : ""}`);
      return;
    }
    const model = body.model?.trim() || DEFAULT_MODEL;
    const prompt = buildPrompt({
      observedRunId: runId,
      workshopBase: WORKSHOP_BASE,
      controlUrl: OPENCODE_CONTROL_URL,
      facts,
    });

    res.status(200);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");

    const write = (chunk: Buffer | string) => {
      try {
        res.write(chunk);
      } catch {}
    };

    const code = await runObserverOnce(runId, prompt, facts.pattern, model, write);
    write(`\n\n[observer exited ${code ?? 0}]`);
    res.end();
  });

  app.post("/veto", (req, res) => {
    const body = (req.body ?? {}) as VetoRequest;
    if (textContains(body.args, "OBSERVER_HARD_VETO_TEST")) {
      res.json({
        decision: "deny",
        reason: "Observer hard veto: duplicate or intentionally off-task sentinel call was blocked before execution.",
        confidence: 1,
      });
      return;
    }
    res.json({ decision: "allow" });
  });

  return app;
}

export async function startServer(port = DEFAULT_PORT): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  return new Promise((resolve) => {
    const server: Server = app.listen(port, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr?.port ?? port;
      console.log(`OpenCode Observer Agent: http://localhost:${actualPort}`);
      console.log(`POST /observe with {"runId":"...", "pattern":"stall|repeat_loop|error_burst"}`);
      resolve({
        port: actualPort,
        close: () => new Promise<void>((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
