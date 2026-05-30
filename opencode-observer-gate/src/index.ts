import { askObserver, type FetchLike } from "./observer-client";
import { loadConfig, type ObserverGateConfig } from "./config";
import type { Hooks, Plugin } from "@opencode-ai/plugin";

type HookInput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[0];
type ToolBeforeOutput = Parameters<NonNullable<Hooks["tool.execute.before"]>>[1];
type ToolAfterInput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[0];
type ToolAfterOutput = Parameters<NonNullable<Hooks["tool.execute.after"]>>[1];
type SystemTransformOutput = Parameters<NonNullable<Hooks["experimental.chat.system.transform"]>>[1];

type MinimalHookInput = {
  tool: string;
  sessionID: string;
  callID: string;
};
type SteeringAction = "hard_veto" | "local_guardrail" | "tool_cap";

type ObserverGateHooks = Pick<Hooks, "tool.execute.before" | "tool.execute.after" | "experimental.chat.system.transform">;

export interface CreateObserverGatePluginOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  configPath?: string;
  fetch?: FetchLike;
  now?: () => number;
}

const FALLBACK_VETO_REASON = "Redundant or off-task - blocked by the observer.";

function valueAtPath(value: unknown, keys: string[]): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

function localDenyReason(pattern: string, tool: string, args: unknown): string | null {
  const [toolPattern, commandPattern] = pattern.split(":", 2);
  if (!toolPattern || !matchesGlob(toolPattern, tool)) return null;
  if (!commandPattern) return `[observer guardrail] blocked ${tool}`;

  const command = valueAtPath(args, ["command", "cmd", "script", "query", "path"]);
  if (!command || !matchesGlob(commandPattern, command)) return null;
  return `[observer guardrail] blocked ${tool} command`;
}

function enforceLocalBefore(cfg: ObserverGateConfig, input: MinimalHookInput, output: ToolBeforeOutput): void {
  for (const pattern of cfg.guardrails.denyTools) {
    const reason = localDenyReason(pattern, input.tool, output.args);
    if (reason) throw new Error(reason);
  }
}

function createToolCounter(): (cfg: ObserverGateConfig, input: ToolAfterInput, output: ToolAfterOutput) => string | null {
  const counts = new Map<string, number>();
  return (cfg, input, output) => {
    const limit = cfg.guardrails.maxToolCalls[input.tool];
    if (!limit) return null;
    const key = `${input.sessionID}:${input.tool}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count <= limit) return null;

    const guidance = `Observer guidance: ${input.tool} has been used ${count} times in this worker session. Synthesize what you have, report coverage gaps, or switch to the next open subquestion before calling it again.`;
    output.output = output.output ? `${output.output}\n\n${guidance}` : guidance;
    return guidance;
  };
}

function appendStandingGuidance(cfg: ObserverGateConfig, output: SystemTransformOutput): void {
  for (const guidance of cfg.guidance.standingSystem) {
    if (!output.system.includes(guidance)) output.system.push(guidance);
  }
}

async function recordSteeringEvent(
  cfg: ObserverGateConfig,
  input: MinimalHookInput,
  action: SteeringAction,
  message: string,
  reason: string,
  confidence: number | undefined,
  fetchImpl: FetchLike,
): Promise<void> {
  if (!cfg.workshopUrl) return;
  try {
    await fetchImpl(`${cfg.workshopUrl.replace(/\/+$/, "")}/api/steering/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        observedConvoId: input.sessionID,
        action,
        status: "applied",
        message,
        reason,
        source: "opencode-observer-gate",
        confidence,
      }),
    });
  } catch {
    // Steering writeback should never make the gate fail closed.
  }
}

export async function createObserverGatePlugin(options: CreateObserverGatePluginOptions = {}): Promise<ObserverGateHooks> {
  const cfg = loadConfig({ env: options.env, cwd: options.cwd, configPath: options.configPath });
  if (!cfg.enabled) return {};

  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const applyToolCounter = createToolCounter();

  return {
    "tool.execute.before": async (input, output) => {
      try {
        enforceLocalBefore(cfg, input, output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await recordSteeringEvent(cfg, input, "local_guardrail", message, message, undefined, fetchImpl);
        throw err;
      }
      if (!cfg.observerUrl || !cfg.tools.has(input.tool)) return;

      const verdict = await askObserver(cfg, {
        sessionID: input.sessionID,
        callID: input.callID,
        tool: input.tool,
        args: output.args,
        ts: now(),
      }, fetchImpl);

      if (verdict?.decision === "deny") {
        const reason = verdict.reason ?? FALLBACK_VETO_REASON;
        await recordSteeringEvent(cfg, input, "hard_veto", reason, reason, verdict.confidence, fetchImpl);
        throw new Error(`[observer veto] ${reason}`);
      }
    },
    "tool.execute.after": async (input, output) => {
      const guidance = applyToolCounter(cfg, input, output);
      if (guidance) {
        await recordSteeringEvent(cfg, input, "tool_cap", guidance, `${input.tool} exceeded the configured maxToolCalls limit.`, undefined, fetchImpl);
      }
    },
    "experimental.chat.system.transform": async (_input, output) => {
      appendStandingGuidance(cfg, output);
    },
  };
}

export const ObserverGate: Plugin = async () => {
  return createObserverGatePlugin();
};

export const server = ObserverGate;
export default server;
