import { apiJson, jsonInit } from "./request";

export type BenchObserverMode = "off" | "on";

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
  runId?: string | null;
  totals?: BenchTotals;
  durationMs?: number;
  exitCode?: number;
  message?: string;
}

export async function postBenchRun(input: {
  prompt: string;
  observer: BenchObserverMode;
  cwd?: string;
  model?: string;
  runs?: number;
}): Promise<{ ok: true; benchIds: string[]; observer: BenchObserverMode; runs: number }> {
  return apiJson<{ ok: true; benchIds: string[]; observer: BenchObserverMode; runs: number }>(
    "/api/bench/run",
    jsonInit("POST", input),
  );
}
