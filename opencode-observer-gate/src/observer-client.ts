import type { ObserverGateConfig } from "./config";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ObserverGateRequest {
  sessionID: string;
  callID: string;
  tool: string;
  args: unknown;
  ts: number;
}

export type ObserverGateDecision =
  | { decision: "allow" }
  | { decision: "deny"; reason?: string; confidence?: number };

function normalizeDecision(value: unknown): ObserverGateDecision | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (body.decision === "allow") return { decision: "allow" };
  if (body.decision !== "deny") return null;

  const decision: ObserverGateDecision = { decision: "deny" };
  if (typeof body.reason === "string" && body.reason.trim()) decision.reason = body.reason.trim();
  if (typeof body.confidence === "number" && Number.isFinite(body.confidence)) {
    decision.confidence = Math.max(0, Math.min(1, body.confidence));
  }
  return decision;
}

export async function askObserver(
  cfg: ObserverGateConfig,
  request: ObserverGateRequest,
  fetchImpl: FetchLike = fetch,
): Promise<ObserverGateDecision | null> {
  if (!cfg.observerUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const response = await fetchImpl(cfg.observerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return normalizeDecision(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
