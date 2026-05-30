import { partitionByAgent } from "./subagents.ts";
import type { WorkshopRun, WorkshopRunDetail, WorkshopSpan } from "./types.ts";

export type Pattern =
  | "stall"
  | "repeat_loop"
  | "error_burst"
  | "empty_search"
  | "wrong_path"
  | "prompt_drift";

export interface FiringFacts {
  pattern: Pattern;
  scope: string;
  evidence: Record<string, unknown>;
  summary: string;
  /** Span id of the subagent the firing applies to. null = main agent / run-level. */
  subagentSpanId: string | null;
  /** Human-readable label for the subagent or "main agent". */
  subagentLabel: string;
}

export interface DetectorThresholds {
  stallMs: number;
  repeatMin: number;
  errorBurstMin: number;
  errorBurstWindowMs: number;
  emptySearchMin: number;
  wrongPathMin: number;
  driftMin: number;
}

export const DEFAULT_THRESHOLDS: DetectorThresholds = {
  stallMs: 60_000,
  repeatMin: 3,
  errorBurstMin: 3,
  errorBurstWindowMs: 30_000,
  emptySearchMin: 3,
  wrongPathMin: 2,
  driftMin: 4,
};

const TOOL_TYPE = "TOOL_CALL";
const SEARCH_TOOL_NAMES = new Set(["glob", "grep", "search", "websearch", "web_search", "find"]);
const READ_TOOL_NAMES = new Set(["read", "view", "open", "cat"]);

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

function safeParse(payload: string | null | undefined): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function lowerName(span: WorkshopSpan): string {
  return (span.name ?? "").toLowerCase();
}

function isSearchTool(span: WorkshopSpan): boolean {
  if (span.span_type !== TOOL_TYPE) return false;
  return SEARCH_TOOL_NAMES.has(lowerName(span));
}

function isReadTool(span: WorkshopSpan): boolean {
  if (span.span_type !== TOOL_TYPE) return false;
  return READ_TOOL_NAMES.has(lowerName(span));
}

function isLlmSpan(span: WorkshopSpan): boolean {
  return (span.span_type ?? "").toUpperCase().includes("LLM");
}

function emptySearchOutput(span: WorkshopSpan): boolean {
  const output = span.output_payload ?? "";
  if (!output.trim()) return true;
  const lower = output.toLowerCase();
  if (
    lower.includes("no files found") ||
    lower.includes("no results") ||
    lower.includes("no matches") ||
    lower.includes("0 results") ||
    lower.includes("\"results\":[]") ||
    lower.includes("\"matches\":[]")
  ) {
    return true;
  }
  const parsed = safeParse(output);
  if (parsed) {
    for (const key of ["results", "matches", "files", "items"]) {
      const value = parsed[key];
      if (Array.isArray(value) && value.length === 0) return true;
    }
  }
  return false;
}

function isPathErrorOutput(span: WorkshopSpan): boolean {
  const output = (span.output_payload ?? "").toLowerCase();
  if (!output) return false;
  return (
    output.includes("no such file") ||
    output.includes("not found") ||
    output.includes("enoent") ||
    output.includes("does not exist") ||
    output.includes("file not found")
  );
}

function extractPathFromInput(span: WorkshopSpan): string | null {
  const parsed = safeParse(span.input_payload);
  if (!parsed) return null;
  for (const key of ["path", "filePath", "file", "file_path", "target", "directory"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect += 1;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

type RawFiring = Omit<FiringFacts, "subagentSpanId" | "subagentLabel">;

export function detectStall(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  now: number,
  thresholds: DetectorThresholds,
): RawFiring | null {
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
): RawFiring | null {
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
  for (const [, value] of counts) {
    if (value.count >= thresholds.repeatMin && (!worst || value.count > worst.count)) {
      worst = { key: "", count: value.count, sample: value.sample };
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
): RawFiring | null {
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

export function detectEmptySearch(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  thresholds: DetectorThresholds,
): RawFiring | null {
  const spans = detail.spans ?? [];
  const searches = spans.filter(isSearchTool);
  if (searches.length < thresholds.emptySearchMin) return null;
  const empties = searches.filter(emptySearchOutput);
  if (empties.length < thresholds.emptySearchMin) return null;
  const recent = empties.slice(-thresholds.emptySearchMin);
  const sample = recent[recent.length - 1];
  return {
    pattern: "empty_search",
    scope: `${run.id}::${sample?.name ?? "search"}`,
    evidence: {
      toolName: sample?.name ?? null,
      emptyCount: empties.length,
      totalSearches: searches.length,
      sampleInputs: recent.map((s) => s.input_payload?.slice(0, 200) ?? null),
    },
    summary: `${empties.length}/${searches.length} ${sample?.name ?? "search"} calls returned no results.`,
  };
}

export function detectWrongPath(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  thresholds: DetectorThresholds,
): RawFiring | null {
  const spans = detail.spans ?? [];
  const reads = spans.filter(isReadTool);
  if (reads.length < thresholds.wrongPathMin) return null;
  const failed = reads.filter(
    (s) => s.status === "ERROR" || isPathErrorOutput(s),
  );
  if (failed.length < thresholds.wrongPathMin) return null;
  const paths = failed
    .map((s) => extractPathFromInput(s))
    .filter((p): p is string => Boolean(p));
  const sample = failed[failed.length - 1];
  return {
    pattern: "wrong_path",
    scope: `${run.id}::${sample?.name ?? "read"}`,
    evidence: {
      toolName: sample?.name ?? null,
      failedCount: failed.length,
      totalReads: reads.length,
      paths: paths.slice(-5),
      sampleOutput: sample?.output_payload?.slice(0, 200) ?? null,
    },
    summary: `${failed.length}/${reads.length} ${sample?.name ?? "read"} calls failed with path/not-found errors.`,
  };
}

export function detectPromptDrift(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  thresholds: DetectorThresholds,
): RawFiring | null {
  const spans = detail.spans ?? [];
  const llms = spans
    .filter(isLlmSpan)
    .filter((s) => s.input_payload || s.output_payload)
    .sort((a, b) => (a.start_time_ms ?? 0) - (b.start_time_ms ?? 0));
  if (llms.length < thresholds.driftMin) return null;
  const root = llms[0];
  const rootText = `${root.input_payload ?? ""} ${root.output_payload ?? ""}`;
  const rootTokens = tokenize(rootText);
  if (rootTokens.size < 5) return null;
  const recent = llms.slice(-thresholds.driftMin);
  let consecutiveLow = 0;
  let worstSim = 1;
  for (const span of recent) {
    const text = `${span.input_payload ?? ""} ${span.output_payload ?? ""}`;
    const sim = jaccard(rootTokens, tokenize(text));
    if (sim < 0.1) {
      consecutiveLow += 1;
      if (sim < worstSim) worstSim = sim;
    } else {
      consecutiveLow = 0;
    }
  }
  if (consecutiveLow < thresholds.driftMin) return null;
  return {
    pattern: "prompt_drift",
    scope: run.id,
    evidence: {
      consecutiveLow,
      worstSimilarity: Number(worstSim.toFixed(3)),
      rootInput: root.input_payload?.slice(0, 200) ?? null,
      recentInput: recent[recent.length - 1]?.input_payload?.slice(0, 200) ?? null,
    },
    summary: `${consecutiveLow} consecutive LLM turns with <0.1 token overlap to the original prompt (worst=${worstSim.toFixed(2)}).`,
  };
}

export function runDetectors(
  run: WorkshopRun,
  detail: WorkshopRunDetail,
  now: number,
  thresholds: DetectorThresholds = DEFAULT_THRESHOLDS,
): FiringFacts[] {
  const views = partitionByAgent(run, detail);
  const out: FiringFacts[] = [];
  for (const view of views) {
    const scopeSuffix = view.spanId ? `:sub:${view.spanId}` : "";
    const stamp = (facts: RawFiring | null): FiringFacts | null => {
      if (!facts) return null;
      return {
        ...facts,
        scope: `${facts.scope}${scopeSuffix}`,
        subagentSpanId: view.spanId,
        subagentLabel: view.label,
      };
    };
    const stall = stamp(detectStall(run, view.detail, now, thresholds));
    if (stall) out.push(stall);
    const repeat = stamp(detectRepeatLoop(run, view.detail, thresholds));
    if (repeat) out.push(repeat);
    const burst = stamp(detectErrorBurst(run, view.detail, now, thresholds));
    if (burst) out.push(burst);
    const empty = stamp(detectEmptySearch(run, view.detail, thresholds));
    if (empty) out.push(empty);
    const wrongPath = stamp(detectWrongPath(run, view.detail, thresholds));
    if (wrongPath) out.push(wrongPath);
    const drift = stamp(detectPromptDrift(run, view.detail, thresholds));
    if (drift) out.push(drift);
  }
  return out;
}
