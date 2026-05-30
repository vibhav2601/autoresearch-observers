import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface ObserverGateGuardrails {
  denyTools: string[];
  maxToolCalls: Record<string, number>;
}

export interface ObserverGateGuidance {
  standingSystem: string[];
}

export interface ObserverGateConfig {
  enabled: boolean;
  observerUrl: string | null;
  workshopUrl: string | null;
  timeoutMs: number;
  tools: Set<string>;
  guardrails: ObserverGateGuardrails;
  guidance: ObserverGateGuidance;
}

export interface LoadConfigOptions {
  env?: Record<string, string | undefined>;
  configPath?: string;
  cwd?: string;
}

interface SteerJson {
  enabled?: unknown;
  observerUrl?: unknown;
  timeoutMs?: unknown;
  tools?: unknown;
  observer?: {
    enabled?: unknown;
    url?: unknown;
    workshopUrl?: unknown;
    timeoutMs?: unknown;
    tools?: unknown;
  };
  workshopUrl?: unknown;
  guardrails?: {
    denyTools?: unknown;
    maxToolCalls?: unknown;
  };
  guidance?: {
    standingSystem?: unknown;
  };
}

const DEFAULT_TOOLS = ["websearch", "webfetch"];
const DEFAULT_TIMEOUT_MS = 100;

function optionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function optionalUnknownString(value: unknown): string | null {
  return typeof value === "string" ? optionalString(value) : null;
}

function parseBoolean(value: unknown): boolean | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (typeof value === "boolean") return value;
  if (!normalized) return null;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function parseStringList(value: unknown): string[] {
  if (typeof value === "string") return parseCsv(value);
  return parseStringArray(value);
}

function parseMaxToolCalls(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [tool, rawLimit] of Object.entries(value)) {
    const name = tool.trim();
    const limit = typeof rawLimit === "number" ? rawLimit : Number.parseInt(String(rawLimit), 10);
    if (name && Number.isFinite(limit) && limit > 0) out[name] = Math.floor(limit);
  }
  return out;
}

function parseMaxToolCallsEnv(value: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of parseCsv(value)) {
    const [rawTool, rawLimit] = pair.split("=");
    const tool = rawTool?.trim();
    const limit = Number.parseInt(rawLimit ?? "", 10);
    if (tool && Number.isFinite(limit) && limit > 0) out[tool] = limit;
  }
  return out;
}

function readSteerJson(configPath: string): SteerJson {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as SteerJson;
  } catch {
    return {};
  }
}

function mergeRecords(first: Record<string, number>, second: Record<string, number>): Record<string, number> {
  return { ...first, ...second };
}

export function loadConfig(options: LoadConfigOptions = {}): ObserverGateConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? optionalString(env.OBSERVER_GATE_CONFIG) ?? path.join(cwd, "steer.json");
  const steer = readSteerJson(configPath);

  const observerUrl = optionalString(env.OBSERVER_GATE_URL) ??
    optionalUnknownString(steer.observer?.url) ??
    optionalUnknownString(steer.observerUrl);
  const workshopUrl = optionalString(env.OBSERVER_GATE_WORKSHOP_URL) ??
    optionalString(env.RAINDROP_WORKSHOP_URL) ??
    optionalUnknownString(steer.observer?.workshopUrl) ??
    optionalUnknownString(steer.workshopUrl);
  const enabledOverride = parseBoolean(env.OBSERVER_GATE_ENABLED) ??
    parseBoolean(steer.observer?.enabled) ??
    parseBoolean(steer.enabled);
  const localConfigPresent = Boolean(
    optionalUnknownString(steer.observer?.url) ||
    optionalUnknownString(steer.observerUrl) ||
    steer.observer?.tools ||
    steer.tools ||
    steer.observer?.timeoutMs ||
    steer.timeoutMs ||
    steer.guardrails?.denyTools ||
    steer.guardrails?.maxToolCalls ||
    steer.guidance?.standingSystem ||
    optionalString(env.OBSERVER_GATE_DENY_TOOLS) ||
    optionalString(env.OBSERVER_GATE_MAX_TOOL_CALLS) ||
    optionalString(env.OBSERVER_GATE_STANDING_SYSTEM),
  );
  const enabled = enabledOverride ?? Boolean(observerUrl || localConfigPresent);

  const envTools = parseCsv(env.OBSERVER_GATE_TOOLS);
  const configTools = parseStringList(steer.observer?.tools ?? steer.tools);
  const tools = new Set(envTools.length > 0 ? envTools : configTools.length > 0 ? configTools : DEFAULT_TOOLS);
  const denyTools = [
    ...parseStringArray(steer.guardrails?.denyTools),
    ...parseCsv(env.OBSERVER_GATE_DENY_TOOLS),
  ];
  const maxToolCalls = mergeRecords(
    parseMaxToolCalls(steer.guardrails?.maxToolCalls),
    parseMaxToolCallsEnv(env.OBSERVER_GATE_MAX_TOOL_CALLS),
  );
  const standingSystem = [
    ...parseStringArray(steer.guidance?.standingSystem),
    ...parseCsv(env.OBSERVER_GATE_STANDING_SYSTEM),
  ];

  return {
    enabled,
    observerUrl,
    workshopUrl,
    timeoutMs: parsePositiveInt(env.OBSERVER_GATE_TIMEOUT_MS ?? steer.observer?.timeoutMs ?? steer.timeoutMs, DEFAULT_TIMEOUT_MS),
    tools,
    guardrails: {
      denyTools,
      maxToolCalls,
    },
    guidance: {
      standingSystem,
    },
  };
}
