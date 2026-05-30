import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type BenchObserverMode = "off" | "on";

export interface BenchRunInput {
  prompt: string;
  cwd?: string;
  model?: string;
  observer: BenchObserverMode;
}

export interface BenchTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
  steps: number;
}

export interface BenchProgressEvent {
  type: "started" | "progress" | "session" | "done" | "error";
  benchId: string;
  observer: BenchObserverMode;
  /** Workshop run id once known. Plugin maps the OpenCode session 1:1, so this equals the session id. */
  runId?: string | null;
  totals?: BenchTotals;
  durationMs?: number;
  exitCode?: number;
  message?: string;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

/** True only after we've started a bench run and not heard "done" or "error" yet. */
const inFlight = new Set<string>();

function emptyTotals(): BenchTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    steps: 0,
  };
}

function ingest(event: unknown, totals: BenchTotals, onSession: (sid: string) => void): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as {
    type?: string;
    sessionID?: string;
    part?: {
      tokens?: { total?: number; input?: number; output?: number; reasoning?: number };
      cost?: number;
    };
  };
  if (typeof e.sessionID === "string") onSession(e.sessionID);
  if (e.type !== "step_finish" || !e.part) return false;
  const t = e.part.tokens ?? {};
  totals.inputTokens += t.input ?? 0;
  totals.outputTokens += t.output ?? 0;
  totals.reasoningTokens += t.reasoning ?? 0;
  totals.totalTokens += t.total ?? ((t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0));
  totals.costUsd += e.part.cost ?? 0;
  totals.steps += 1;
  return true;
}

export interface StartBenchOptions {
  /** Receives WS-broadcastable progress events. */
  emit: (event: BenchProgressEvent) => void;
  /** Where to look for the @raindrop-ai/opencode-plugin install (defaults to the workshop install). */
  pluginDir?: string;
  /** Workshop daemon URL the spawned plugin should POST to. */
  workshopBase?: string;
}

export function startBenchRun(input: BenchRunInput, options: StartBenchOptions): { benchId: string } {
  const benchId = randomUUID();
  const totals = emptyTotals();
  const startedAt = Date.now();
  const rawCwd = input.cwd?.trim() || process.cwd();
  // Workshop daemon's cwd is `raindrop-workshop/`. Resolve relative paths
  // against the repo root so the UI default `scenarios/...` works the same
  // whether the user typed it relative or absolute.
  const cwd = path.isAbsolute(rawCwd) ? rawCwd : path.resolve(process.cwd(), "..", rawCwd);
  const model = input.model?.trim() || DEFAULT_MODEL;
  const workshopBase = options.workshopBase ?? "http://localhost:5899";
  const userId = input.observer === "off" ? "bench-off" : "bench-on";

  const eventMetadata = JSON.stringify({
    eventName: "opencode_session",
    userId,
    convoId: `bench:${benchId}`,
    properties: {
      role: "bench-worker",
      benchObserver: input.observer,
      benchId,
    },
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: process.env.HOME ?? homedir(),
    RAINDROP_LOCAL_DEBUGGER: process.env.RAINDROP_LOCAL_DEBUGGER ?? `${workshopBase}/v1/`,
    RAINDROP_EVENT_METADATA: eventMetadata,
  };
  const observerService = process.env.OPENCODE_OBSERVER_BASE ?? "http://localhost:3031";

  const baseEvent = (extra: Partial<BenchProgressEvent>): BenchProgressEvent => ({
    type: "progress",
    benchId,
    observer: input.observer,
    ...extra,
  });

  options.emit(baseEvent({ type: "started", message: `worker spawn (observer=${input.observer})` }));
  inFlight.add(benchId);

  let sessionEmitted = false;
  let buffer = "";
  let runId: string | null = null;

  const child = spawn(
    "opencode",
    [
      "run",
      "--format",
      "json",
      "--model",
      model,
      "--dangerously-skip-permissions",
      input.prompt,
    ],
    {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let progressed = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch { continue; }
      const advanced = ingest(parsed, totals, (sid) => {
        if (sessionEmitted || !sid) return;
        sessionEmitted = true;
        runId = sid;
        options.emit(baseEvent({ type: "session", runId: sid }));
      });
      if (advanced) progressed = true;
    }
    if (progressed) {
      options.emit(baseEvent({ type: "progress", runId, totals: { ...totals } }));
    }
  });

  child.stderr.on("data", () => {
    /* ignored — Raindrop plugin warnings are noisy and not relevant to the bench numbers */
  });

  child.once("error", (err) => {
    inFlight.delete(benchId);
    options.emit(baseEvent({ type: "error", message: err.message, runId, totals: { ...totals }, durationMs: Date.now() - startedAt }));
  });

  child.once("close", (code) => {
    inFlight.delete(benchId);
    options.emit(baseEvent({
      type: "done",
      runId,
      totals: { ...totals },
      durationMs: Date.now() - startedAt,
      exitCode: code ?? 0,
    }));
    void touchObserverIfNeeded(observerService, input.observer);
  });

  // Fire-and-forget; just report we started and let the stream do the rest.
  return { benchId };
}

/**
 * Best-effort "is the observer up?" probe so the UI can warn the user when
 * the ON condition won't actually do anything. Doesn't affect bench results.
 */
async function touchObserverIfNeeded(_url: string, _mode: BenchObserverMode): Promise<void> {
  /* no-op; reserved for future use */
}

export function isBenchInFlight(): number {
  return inFlight.size;
}

/** Resolved at module load so the server can advertise it on /api/bench/health. */
export const BENCH_DEFAULT_CWD = process.cwd();
export const BENCH_DEFAULT_MODEL = DEFAULT_MODEL;
export const BENCH_PLUGIN_HINT_PATH = path.join(homedir(), ".opencode");
