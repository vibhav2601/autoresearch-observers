import {
  Ban,
  Gauge,
  MessageSquareWarning,
  OctagonX,
  PencilLine,
  Play,
  RefreshCcw,
  ShieldX,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import type { SteeringAction, SteeringEvent } from "../api/steering";
import { C } from "../utils/colors";

type SteeringActionDetails = {
  label: string;
  shortLabel: string;
  title: string;
  wrongLabel: string;
  rightLabel: string;
  fallbackWrong: string;
  fallbackRight: string;
  color: string;
  bg: string;
  border: string;
  Icon: LucideIcon;
};

const ABORT_DETAILS: SteeringActionDetails = {
  label: "Abort",
  shortLabel: "abort",
  title: "Observer abort",
  wrongLabel: "Abort reason",
  rightLabel: "Abort effect",
  fallbackWrong: "Observer decided this worker should stop.",
  fallbackRight: "The actuator aborted the target OpenCode session.",
  color: C.red,
  bg: "rgba(235,20,20,0.08)",
  border: "rgba(235,20,20,0.28)",
  Icon: Ban,
};

export const STEERING_ACTION_DETAILS: Record<SteeringAction, SteeringActionDetails> = {
  nudge: {
    label: "Nudge",
    shortLabel: "nudge",
    title: "Observer nudge",
    wrongLabel: "Wrong direction",
    rightLabel: "Corrected direction",
    fallbackWrong: "Observer detected wrong-direction work.",
    fallbackRight: "Observer injected corrective guidance into this worker.",
    color: C.green,
    bg: "rgba(102,170,187,0.08)",
    border: "rgba(102,170,187,0.26)",
    Icon: MessageSquareWarning,
  },
  system_prompt_update: {
    label: "Prompt update",
    shortLabel: "prompt",
    title: "System prompt update",
    wrongLabel: "Prompt gap",
    rightLabel: "Updated guidance",
    fallbackWrong: "Observer found missing or stale steering context.",
    fallbackRight: "Observer updated the worker's steering prompt.",
    color: C.accent,
    bg: "rgba(91,141,239,0.09)",
    border: "rgba(91,141,239,0.28)",
    Icon: PencilLine,
  },
  abort: ABORT_DETAILS,
  stop: ABORT_DETAILS,
  restart: {
    label: "Restart",
    shortLabel: "restart",
    title: "Observer restart",
    wrongLabel: "Restart reason",
    rightLabel: "Restart instruction",
    fallbackWrong: "Observer decided this worker should be abandoned and reassigned.",
    fallbackRight: "The actuator aborted the worker and submitted the replacement instruction.",
    color: C.orange,
    bg: "rgba(240,173,78,0.1)",
    border: "rgba(240,173,78,0.3)",
    Icon: RefreshCcw,
  },
  hard_veto: {
    label: "Hard veto",
    shortLabel: "veto",
    title: "Synchronous hard veto",
    wrongLabel: "Blocked call",
    rightLabel: "Veto reason",
    fallbackWrong: "Observer blocked a redundant or off-task tool call before execution.",
    fallbackRight: "The gate plugin threw in tool.execute.before so the call did not run.",
    color: C.purple,
    bg: "rgba(165,124,245,0.1)",
    border: "rgba(165,124,245,0.32)",
    Icon: OctagonX,
  },
  tool_cap: {
    label: "Tool cap",
    shortLabel: "cap",
    title: "Tool cap guidance",
    wrongLabel: "Tool overuse",
    rightLabel: "Cap guidance",
    fallbackWrong: "Observer detected repeated tool use past the configured cap.",
    fallbackRight: "The gate plugin appended guidance to synthesize or switch strategy.",
    color: C.cyan,
    bg: "rgba(79,202,227,0.09)",
    border: "rgba(79,202,227,0.28)",
    Icon: Gauge,
  },
  local_guardrail: {
    label: "Guardrail",
    shortLabel: "guard",
    title: "Local guardrail",
    wrongLabel: "Guardrail match",
    rightLabel: "Blocked locally",
    fallbackWrong: "A configured local guardrail matched this tool call.",
    fallbackRight: "The gate plugin blocked the call without an observer round-trip.",
    color: C.orange,
    bg: "rgba(240,173,78,0.1)",
    border: "rgba(240,173,78,0.3)",
    Icon: ShieldX,
  },
  continue: {
    label: "Continue",
    shortLabel: "continue",
    title: "Continue",
    wrongLabel: "Observer note",
    rightLabel: "Continue instruction",
    fallbackWrong: "Observer reviewed the worker state.",
    fallbackRight: "Observer allowed the worker to continue.",
    color: C.fg2,
    bg: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.12)",
    Icon: Play,
  },
  note: {
    label: "Note",
    shortLabel: "note",
    title: "Observer note",
    wrongLabel: "Context",
    rightLabel: "Note",
    fallbackWrong: "Observer recorded context for this run.",
    fallbackRight: "Observer left an informational note.",
    color: C.fg2,
    bg: "rgba(255,255,255,0.05)",
    border: "rgba(255,255,255,0.12)",
    Icon: StickyNote,
  },
};

export function steeringActionDetails(action: SteeringAction): SteeringActionDetails {
  return STEERING_ACTION_DETAILS[action];
}

export function steeringActionLabel(event: SteeringEvent, nudgeNumber?: number): string {
  if (event.action === "nudge" && nudgeNumber) return `Nudge ${nudgeNumber}`;
  return steeringActionDetails(event.action).label;
}

export function steeringWrongDirection(event: SteeringEvent): string {
  return event.reason ?? event.message ?? steeringActionDetails(event.action).fallbackWrong;
}

export function steeringCorrectedDirection(event: SteeringEvent): string {
  return event.after_prompt ?? event.message ?? steeringActionDetails(event.action).fallbackRight;
}

export function SteeringActionBadge({ event, nudgeNumber, compact = false }: { event: SteeringEvent; nudgeNumber?: number; compact?: boolean }) {
  const details = steeringActionDetails(event.action);
  const Icon = details.Icon;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide ${compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[10px]"}`}
      style={{ color: details.color, background: details.bg, border: `1px solid ${details.border}` }}
      title={details.title}
    >
      <Icon size={compact ? 10 : 12} strokeWidth={2.2} />
      {compact ? details.shortLabel : steeringActionLabel(event, nudgeNumber)}
    </span>
  );
}
