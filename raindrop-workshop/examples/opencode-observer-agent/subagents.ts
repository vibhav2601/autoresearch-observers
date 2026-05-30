import type { WorkshopRun, WorkshopRunDetail, WorkshopSpan } from "./types.ts";

export interface SubagentView {
  /** Stable identifier — "main" for the run-level view, otherwise the subagent root span id. */
  id: string;
  /** Human-readable label for prompts: "main agent" or `task: <description>`. */
  label: string;
  /** Span id the harness should target when steering this subagent (null for "main"). */
  spanId: string | null;
  /** The subagent root span itself (null for "main"). */
  rootSpan: WorkshopSpan | null;
  /** All descendants of the root, plus the root itself. For "main", every span not inside a subagent. */
  spans: WorkshopSpan[];
  /** Equivalent of WorkshopRunDetail.spans for this view, used by detectors. */
  detail: WorkshopRunDetail;
}

const TASK_NAMES = new Set(["task", "subagent", "agent"]);

function isSubagentRoot(span: WorkshopSpan): boolean {
  if ((span.span_type ?? "") !== "TOOL_CALL") return false;
  const name = (span.name ?? "").toLowerCase();
  if (TASK_NAMES.has(name)) return true;
  return name.startsWith("task:") || name.includes("subagent");
}

function buildChildIndex(spans: WorkshopSpan[]): Map<string, WorkshopSpan[]> {
  const index = new Map<string, WorkshopSpan[]>();
  for (const span of spans) {
    const parent = span.parent_span_id ?? "";
    if (!parent) continue;
    const list = index.get(parent);
    if (list) list.push(span);
    else index.set(parent, [span]);
  }
  return index;
}

function collectDescendants(rootId: string, childIndex: Map<string, WorkshopSpan[]>): WorkshopSpan[] {
  const out: WorkshopSpan[] = [];
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const children = childIndex.get(id) ?? [];
    for (const child of children) {
      out.push(child);
      stack.push(child.id);
    }
  }
  return out;
}

function describeSubagentRoot(root: WorkshopSpan): string {
  const baseName = root.name ?? "task";
  const parsed = (() => {
    if (!root.input_payload) return null;
    try {
      const value = JSON.parse(root.input_payload);
      return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();
  if (parsed) {
    const desc = parsed.description ?? parsed.subagent_type ?? parsed.title;
    if (typeof desc === "string" && desc.trim().length > 0) {
      return `${baseName}: ${desc.slice(0, 80)}`;
    }
  }
  return baseName;
}

export function partitionByAgent(_run: WorkshopRun, detail: WorkshopRunDetail): SubagentView[] {
  const spans = detail.spans ?? [];
  if (spans.length === 0) {
    return [
      {
        id: "main",
        label: "main agent",
        spanId: null,
        rootSpan: null,
        spans: [],
        detail: { spans: [], liveEvents: detail.liveEvents ?? [] },
      },
    ];
  }
  const childIndex = buildChildIndex(spans);
  const subagentRoots = spans.filter(isSubagentRoot);
  const claimedIds = new Set<string>();
  const views: SubagentView[] = [];

  for (const root of subagentRoots) {
    const descendants = collectDescendants(root.id, childIndex);
    const subagentSpans = [root, ...descendants];
    for (const span of subagentSpans) claimedIds.add(span.id);
    views.push({
      id: root.id,
      label: describeSubagentRoot(root),
      spanId: root.id,
      rootSpan: root,
      spans: subagentSpans,
      detail: { spans: subagentSpans, liveEvents: [] },
    });
  }

  const mainSpans = spans.filter((span) => !claimedIds.has(span.id));
  views.unshift({
    id: "main",
    label: "main agent",
    spanId: null,
    rootSpan: null,
    spans: mainSpans,
    detail: { spans: mainSpans, liveEvents: detail.liveEvents ?? [] },
  });

  return views;
}
