import type { WorkshopRun, WorkshopRunDetail, WorkshopSpan } from "./types.ts";

export type Pattern = "stall" | "repeat_loop" | "error_burst";

export interface FiringFacts {
  pattern: Pattern;
  scope: string;
  evidence: Record<string, unknown>;
  summary: string;
}

export interface DetectorThresholds {
  stallMs: number;
  repeatMin: number;
  errorBurstMin: number;
  errorBurstWindowMs: number;
}

export const DEFAULT_THRESHOLDS: DetectorThresholds = {
  stallMs: 60_000,
  repeatMin: 3,
  errorBurstMin: 3,
  errorBurstWindowMs: 30_000,
};

const TOOL_TYPE = "TOOL_CALL";

function spanEnded(span: WorkshopSpan): boolean {
  return Boolean(span.end_time_ms || (span.status && span.status !== "UNSET" && span.status !== "RUNNING"));
}

function lastActivityMs(spans: WorkshopSpan[]): number {
  let max = 0;
  for (const span of spans) {
    const t = span.end_time_ms ?? span.start_time_ms ?? 0;
    if (t > max) max = t;
  }
  return max;
}

function extractToolKey(span: WorkshopSpan): string {
  const name = span.name ?? "tool";
  const input = span.input_payload ?? "";
  const trimmed = input.length > 200 ? input.slice(0, 200) : input;
  return `${name}::${trimmed.replace(/\s+/g, " ").trim()}`;
}

export function detectStall(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  now: number,
  thresholds: DetectorThresholds,
): FiringFacts | null {
  if (run.finished) return null;
  const spans = detail.spans ?? [];
  if (spans.length === 0) return null;
  const openSpans = spans.filter((s) => !spanEnded(s));
  if (openSpans.length === 0) return null;
  const lastActivity = lastActivityMs(spans);
  const idleMs = now - lastActivity;
  if (idleMs < thresholds.stallMs) return null;
  const oldestOpen = openSpans
    .filter((s) => s.start_time_ms)
    .sort((a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0))[0];
  return {
    pattern: "stall",
    scope: run.id,
    evidence: {
      idleMs,
      lastActivityAt: lastActivity,
      openSpanCount: openSpans.length,
      oldestOpenSpan: oldestOpen
        ? { name: oldestOpen.name, type: oldestOpen.span_type, startedAt: oldestOpen.start_time_ms }
        : null,
    },
    summary: `Run idle ${Math.round(idleMs / 1000)}s with ${openSpans.length} open span(s); last activity at ${new Date(lastActivity).toISOString()}.`,
  };
}

export function detectRepeatLoop(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  thresholds: DetectorThresholds,
): FiringFacts | null {
  const spans = detail.spans ?? [];
  const tools = spans.filter((s) => s.span_type === TOOL_TYPE);
  if (tools.length < thresholds.repeatMin) return null;
  const counts = new Map<string, { count: number; sample: WorkshopSpan }>();
  for (const span of tools) {
    const key = extractToolKey(span);
    const cur = counts.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      counts.set(key, { count: 1, sample: span });
    }
  }
  let worst: { key: string; count: number; sample: WorkshopSpan } | null = null;
  for (const [key, value] of counts) {
    if (value.count >= thresholds.repeatMin && (!worst || value.count > worst.count)) {
      worst = { key, count: value.count, sample: value.sample };
    }
  }
  if (!worst) return null;
  return {
    pattern: "repeat_loop",
    scope: `${run.id}::${worst.sample.name ?? "tool"}`,
    evidence: {
      toolName: worst.sample.name,
      count: worst.count,
      sampleInput: worst.sample.input_payload?.slice(0, 300) ?? null,
    },
    summary: `Tool '${worst.sample.name}' invoked ${worst.count} times with the same arguments.`,
  };
}

export function detectErrorBurst(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  now: number,
  thresholds: DetectorThresholds,
): FiringFacts | null {
  const spans = detail.spans ?? [];
  const errors = spans
    .filter((s) => s.status === "ERROR" && (s.end_time_ms ?? s.start_time_ms ?? 0) > now - thresholds.errorBurstWindowMs)
    .sort((a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0));
  if (errors.length < thresholds.errorBurstMin) return null;
  return {
    pattern: "error_burst",
    scope: run.id,
    evidence: {
      count: errors.length,
      windowMs: thresholds.errorBurstWindowMs,
      errors: errors.slice(0, 5).map((s) => ({
        name: s.name,
        type: s.span_type,
        output: s.output_payload?.slice(0, 200) ?? null,
      })),
    },
    summary: `${errors.length} ERROR spans in the last ${Math.round(thresholds.errorBurstWindowMs / 1000)}s.`,
  };
}

export function runDetectors(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  now: number,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): FiringFacts[] {
  const out: FiringFacts[] = [];
  const stall = detectStall(run, detail, now, thresholds);
  if (stall) out.push(stall);
  const repeat = detectRepeatLoop(run, detail, thresholds);
  if (repeat) out.push(repeat);
  const burst = detectErrorBurst(run, detail, now, thresholds);
  if (burst) out.push(burst);
  return out;
}
