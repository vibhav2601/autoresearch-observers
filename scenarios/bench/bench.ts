#!/usr/bin/env bun
/**
 * One-shot benchmark for an OpenCode worker prompt.
 *
 * Spawns `opencode run --format json` with the given prompt and accumulates
 * tokens + cost from the JSON event stream, plus wall-clock from
 * spawn-to-exit. Run it twice (once with the observer running, once without)
 * to A/B compare. The script does NOT manage the observer process — start
 * the observer with OBSERVER_DISABLED=1 to pre-stage the "off" condition,
 * and unset (or =0) to pre-stage "on".
 *
 * Usage:
 *   bun scenarios/bench/bench.ts \
 *     --prompt-file scenarios/hallucinating-subagents/PROMPT.md \
 *     --cwd scenarios/hallucinating-subagents/fixture-repo \
 *     --model openai/gpt-4o-mini \
 *     --label "off"
 *
 * Flags:
 *   --prompt <text>          inline prompt (mutually exclusive with --prompt-file)
 *   --prompt-file <path>     read the prompt from a file
 *   --cwd <path>             working directory for the worker (default: process cwd)
 *   --model <id>             worker model (default: openai/gpt-4o-mini)
 *   --label <name>           label printed in the output table (default: "run")
 *   --output <path>          append a JSON line per run to this file
 */

import { spawn } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";

interface Args {
  prompt: string | null;
  promptFile: string | null;
  cwd: string;
  model: string;
  label: string;
  output: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    prompt: null,
    promptFile: null,
    cwd: process.cwd(),
    model: "openai/gpt-4o-mini",
    label: "run",
    output: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--prompt": out.prompt = next(); break;
      case "--prompt-file": out.promptFile = next(); break;
      case "--cwd": out.cwd = next(); break;
      case "--model": out.model = next(); break;
      case "--label": out.label = next(); break;
      case "--output": out.output = next(); break;
      case "-h":
      case "--help":
        console.log(usage()); process.exit(0);
      default:
        console.error(`unknown arg: ${arg}`);
        console.error(usage());
        process.exit(2);
    }
  }
  if (!out.prompt && !out.promptFile) {
    console.error("error: --prompt or --prompt-file is required");
    console.error(usage());
    process.exit(2);
  }
  if (out.prompt && out.promptFile) {
    console.error("error: --prompt and --prompt-file are mutually exclusive");
    process.exit(2);
  }
  return out;
}

function usage(): string {
  return `usage: bun bench.ts [--prompt <text> | --prompt-file <path>] [--cwd <path>] [--model <id>] [--label <name>] [--output <path>]`;
}

interface StepFinish {
  type: "step_finish";
  sessionID?: string;
  part?: {
    tokens?: { total?: number; input?: number; output?: number; reasoning?: number };
    cost?: number;
  };
}

interface BenchResult {
  label: string;
  sessionId: string | null;
  durationMs: number;
  exitCode: number;
  totals: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    costUsd: number;
    steps: number;
  };
  observerActive: boolean | null;
  startedAt: number;
  endedAt: number;
}

async function probeObserverActive(): Promise<boolean | null> {
  try {
    const res = await fetch("http://localhost:3031/health", { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const body = (await res.json()) as { disabled?: boolean };
    return body.disabled === false || body.disabled === undefined;
  } catch {
    return null;
  }
}

async function runWorker(args: Args): Promise<BenchResult> {
  const promptText = args.prompt ?? readFileSync(args.promptFile!, "utf8");
  const observerActive = await probeObserverActive();

  let sessionId: string | null = null;
  const totals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, costUsd: 0, steps: 0 };
  const startedAt = Date.now();

  const child = spawn(
    "opencode",
    ["run", "--format", "json", "--model", args.model, "--dangerously-skip-permissions", promptText],
    { cwd: args.cwd, stdio: ["ignore", "pipe", "inherit"] },
  );

  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let event: unknown;
      try { event = JSON.parse(trimmed); } catch { continue; }
      ingest(event, totals, (sid) => { if (!sessionId) sessionId = sid; });
    }
  });

  const exitCode: number = await new Promise((resolve) => {
    child.once("error", () => resolve(1));
    child.once("close", (code) => resolve(code ?? 0));
  });

  const endedAt = Date.now();
  return {
    label: args.label,
    sessionId,
    durationMs: endedAt - startedAt,
    exitCode,
    totals,
    observerActive,
    startedAt,
    endedAt,
  };
}

function ingest(
  event: unknown,
  totals: BenchResult["totals"],
  onSession: (sid: string) => void,
): void {
  if (!event || typeof event !== "object") return;
  const e = event as { type?: string; sessionID?: string; part?: StepFinish["part"] };
  const sid = e.sessionID;
  if (typeof sid === "string") onSession(sid);
  if (e.type !== "step_finish" || !e.part) return;
  const t = e.part.tokens ?? {};
  totals.inputTokens += t.input ?? 0;
  totals.outputTokens += t.output ?? 0;
  totals.reasoningTokens += t.reasoning ?? 0;
  totals.totalTokens += t.total ?? ((t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0));
  totals.costUsd += e.part.cost ?? 0;
  totals.steps += 1;
}

function formatResult(r: BenchResult): string {
  const seconds = (r.durationMs / 1000).toFixed(1);
  const observerTag =
    r.observerActive === null ? "?"
    : r.observerActive ? "ON" : "OFF";
  return [
    `label:        ${r.label}`,
    `observer:     ${observerTag}`,
    `session:      ${r.sessionId ?? "<not seen>"}`,
    `exit:         ${r.exitCode}`,
    `wall-clock:   ${seconds}s`,
    `tokens:       in=${r.totals.inputTokens}  out=${r.totals.outputTokens}  reasoning=${r.totals.reasoningTokens}  total=${r.totals.totalTokens}`,
    `cost:         $${r.totals.costUsd.toFixed(4)}`,
    `steps:        ${r.totals.steps}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.error(`[bench] running label=${args.label} model=${args.model} cwd=${args.cwd}`);
  const result = await runWorker(args);
  console.log("\n" + formatResult(result));
  if (args.output) {
    appendFileSync(args.output, JSON.stringify(result) + "\n");
    console.error(`[bench] appended to ${args.output}`);
  }
}

await main();
