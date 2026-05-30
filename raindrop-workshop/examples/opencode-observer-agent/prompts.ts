import type { FiringFacts, Pattern } from "./detection.ts";

export interface PromptInputs {
  observedRunId: string;
  workshopBase: string;
  controlUrl: string;
  facts: FiringFacts;
}

const COMMON_RULES = `You are Raindrop Observer. The harness has already detected a coordination-failure pattern using deterministic features. Your job is narrow:

- Confirm the pattern from the evidence the harness extracted.
- Decide on one corrective action: nudge, system_prompt_update, stop, or restart.
- Post exactly one steering event to Workshop, or no event at all if the evidence is weak.

Hard rules:
- Use only the evidence in this prompt. Do NOT run sqlite, fetch additional spans, or invent facts.
- A nudge must be one actionable sentence.
- Use restart only when the run is clearly on the wrong path.
- Use stop only when continuing is wasteful or harmful.
- If evidence is thin, do nothing and explain why.
- Status is always "mock_applied" unless the control bridge call succeeds (it likely won't; assume mock).

Allowed corrective actions: nudge, system_prompt_update, stop, restart.
Allowed statuses: proposed, mock_applied, applied, acknowledged, dismissed, failed.`;

function writebackBlock(workshopBase: string, observedRunId: string, source: string): string {
  return `Writeback (only if a corrective action is warranted):
\`\`\`bash
curl -sS -X POST "${workshopBase}/api/steering/events" \\
  -H 'Content-Type: application/json' \\
  -d '{
    "observedRunId": "${observedRunId}",
    "action": "<nudge|system_prompt_update|stop|restart>",
    "status": "mock_applied",
    "message": "<one actionable sentence>",
    "reason": "<why, citing the evidence>",
    "source": "${source}",
    "confidence": <0.0-1.0>
  }'
\`\`\`

Do not include placeholders such as "<RUN_ID>" or "<TASK_SPAN_ID>". Omit fields you cannot fill from the evidence.`;
}

function stallPrompt(p: PromptInputs): string {
  const e = p.facts.evidence as {
    idleMs: number;
    openSpanCount: number;
    oldestOpenSpan: { name?: string | null; type?: string | null; startedAt?: number | null } | null;
  };
  const oldest = e.oldestOpenSpan
    ? `${e.oldestOpenSpan.type ?? "?"} '${e.oldestOpenSpan.name ?? "?"}' open since ${e.oldestOpenSpan.startedAt ? new Date(e.oldestOpenSpan.startedAt).toISOString() : "?"}`
    : "no specific open span";
  return `${COMMON_RULES}

Pattern: STALL on run ${p.observedRunId}.
Detector evidence:
- Idle for ${Math.round(e.idleMs / 1000)}s.
- Open spans: ${e.openSpanCount}.
- Oldest open span: ${oldest}.

Decide:
1. If the run looks stuck and the open span is on a known dead-end (e.g. waiting on a hung tool), emit a "stop" or "restart".
2. If progress could resume with a hint, emit a "nudge" telling the worker to abandon the open thread and continue.
3. If the idle is plausibly normal (e.g. waiting on an LLM completion), do nothing.

${writebackBlock(p.workshopBase, p.observedRunId, "harness:stall")}`;
}

function repeatLoopPrompt(p: PromptInputs): string {
  const e = p.facts.evidence as { toolName?: string | null; count: number; sampleInput?: string | null };
  return `${COMMON_RULES}

Pattern: REPEAT_LOOP on run ${p.observedRunId}.
Detector evidence:
- Tool: '${e.toolName ?? "?"}'.
- Repeated invocation count with identical arguments: ${e.count}.
- Sample input (truncated): ${e.sampleInput ?? "<none>"}.

Decide:
1. If the worker is clearly thrashing on the same call, emit a "nudge" instructing it to change strategy or verify a precondition (e.g. "verify the path before re-running glob").
2. If the repetition is across legitimately different work but happens to share a prefix, do nothing.
3. Use "restart" only if the loop indicates the worker is on the wrong overall path.

${writebackBlock(p.workshopBase, p.observedRunId, "harness:repeat_loop")}`;
}

function errorBurstPrompt(p: PromptInputs): string {
  const e = p.facts.evidence as {
    count: number;
    windowMs: number;
    errors: { name?: string | null; type?: string | null; output?: string | null }[];
  };
  const lines = e.errors
    .map((err, i) => `  ${i + 1}. ${err.type ?? "?"} '${err.name ?? "?"}' :: ${err.output ?? "<no output>"}`)
    .join("\n");
  return `${COMMON_RULES}

Pattern: ERROR_BURST on run ${p.observedRunId}.
Detector evidence:
- ${e.count} ERROR spans in the last ${Math.round(e.windowMs / 1000)}s.
- Sample errors:
${lines}

Decide:
1. If the errors all point at the same root cause (bad path, missing dep, auth failure), emit a "nudge" or "system_prompt_update" that fixes the misunderstanding.
2. If the errors are unrelated transient failures, do nothing.
3. Use "stop" only if continuing will keep producing the same errors.

${writebackBlock(p.workshopBase, p.observedRunId, "harness:error_burst")}`;
}

const BUILDERS: Record<Pattern, (p: PromptInputs) => string> = {
  stall: stallPrompt,
  repeat_loop: repeatLoopPrompt,
  error_burst: errorBurstPrompt,
};

export function buildPrompt(inputs: PromptInputs): string {
  return BUILDERS[inputs.facts.pattern](inputs);
}
