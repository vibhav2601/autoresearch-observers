import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import type { Express } from "express";
import { loadWorkspaceEnv } from "../loadEnv.ts";

loadWorkspaceEnv(import.meta.url);

const DEFAULT_PORT = Number(process.env.PORT ?? 3032);
const WORKSHOP_BASE = process.env.RAINDROP_WORKSHOP_URL ?? "http://localhost:5899";
const OPENCODE_BASE = process.env.OPENCODE_BASE_URL ?? "http://localhost:4096";

type SteeringAction = "nudge" | "system_prompt_update" | "abort" | "stop" | "restart";
type CanonicalSteeringAction = Exclude<SteeringAction, "stop">;
type SteeringStatus = "applied" | "failed" | "resolved";

interface ApplyRequest {
  observedRunId?: string;
  observerRunId?: string;
  targetSpanId?: string;
  targetSubagentSpanId?: string;
  sessionId?: string;
  targetSessionId?: string;
  opencodeSessionId?: string;
  action?: SteeringAction;
  message?: string;
  beforePrompt?: string;
  afterPrompt?: string;
  reason?: string;
  confidence?: number;
  dryRun?: boolean;
  writeWorkshop?: boolean;
}

interface WorkshopRunDetail {
  run?: {
    id: string;
    convo_id?: string | null;
  };
  spans?: Array<{
    id: string;
    name?: string | null;
    start_time_ms?: number | null;
    end_time_ms?: number | null;
    input_payload?: string | null;
    output_payload?: string | null;
    attributes?: string | null;
  }>;
}

interface ApplyResult {
  ok: boolean;
  action: CanonicalSteeringAction;
  status: SteeringStatus;
  sessionId: string | null;
  target: {
    requestedSpanId: string | null;
    resolvedFrom: "explicit" | "targetSubagentSpanId" | "taskSpanOutput" | "opencodeChildren" | "runConvoId" | null;
  };
  opencode: {
    baseUrl: string;
    endpoint: string | null;
    status: number | null;
    response: unknown;
  };
  workshopEvent?: unknown;
  error?: string;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isSessionLike(value: string | null): boolean {
  return Boolean(value && (/^ses[_-]/.test(value) || /^session[_-]/.test(value)));
}

function extractSessionIdFromText(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const direct = value.match(/\b(?:ses|session)[_-][A-Za-z0-9_-]+\b/);
  if (direct) return direct[0];

  try {
    const parsed = JSON.parse(value) as unknown;
    return extractSessionIdFromText(parsed);
  } catch {
    return null;
  }
}

function extractSessionIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string") return extractSessionIdFromText(value);
  if (!value || typeof value !== "object") return null;

  const stack: unknown[] = [value];
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === "string") {
      const sessionId = extractSessionIdFromText(next);
      if (sessionId) return sessionId;
      continue;
    }
    if (!next || typeof next !== "object") continue;
    for (const child of Object.values(next as Record<string, unknown>)) {
      stack.push(child);
    }
  }
  return null;
}

async function fetchWorkshopRun(runId: string): Promise<WorkshopRunDetail | null> {
  const response = await fetch(`${WORKSHOP_BASE}/api/runs/detail/${encodeURIComponent(runId)}`);
  if (!response.ok) return null;
  return await response.json() as WorkshopRunDetail;
}

async function fetchOpenCodeChildren(parentSessionId: string): Promise<Array<{
  id?: string;
  title?: string;
  parentID?: string;
  time?: { created?: number; updated?: number };
}> | null> {
  const response = await fetch(`${OPENCODE_BASE}/session/${encodeURIComponent(parentSessionId)}/children`);
  if (!response.ok) return null;
  const body = await response.json() as unknown;
  return Array.isArray(body) ? body as Array<{ id?: string; title?: string; parentID?: string; time?: { created?: number; updated?: number } }> : null;
}

function parseObject(value: string | null | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveSessionIdFromSpan(detail: WorkshopRunDetail | null, spanId: string | null): string | null {
  if (!detail || !spanId) return null;
  const span = detail.spans?.find((candidate) => candidate.id === spanId);
  if (!span) return null;

  return (
    extractSessionIdFromText(span.output_payload) ??
    extractSessionIdFromText(span.attributes) ??
    extractSessionIdFromUnknown(span)
  );
}

async function resolveSessionIdFromOpenCodeChildren(detail: WorkshopRunDetail | null, spanId: string | null): Promise<string | null> {
  if (!detail || !spanId) return null;
  const parentSessionId = clean(detail.run?.convo_id);
  if (!parentSessionId) return null;
  const span = detail.spans?.find((candidate) => candidate.id === spanId);
  if (!span) return null;

  const input = parseObject(span.input_payload);
  const description = clean(input?.description);
  const children = await fetchOpenCodeChildren(parentSessionId);
  if (!children?.length) return null;

  if (description) {
    const byTitle = children.find((child) => (
      clean(child.id) &&
      clean(child.title)?.toLowerCase().includes(description.toLowerCase())
    ));
    if (byTitle?.id) return byTitle.id;
  }

  const start = typeof span.start_time_ms === "number" ? span.start_time_ms : null;
  const end = typeof span.end_time_ms === "number" ? span.end_time_ms : null;
  if (start !== null) {
    const candidates = children
      .filter((child) => {
        if (!child.id || typeof child.time?.created !== "number") return false;
        if (end !== null && child.time.created >= start - 1500 && child.time.created <= end + 1500) return true;
        return Math.abs(child.time.created - start) <= 5000;
      })
      .sort((a, b) => Math.abs((a.time?.created ?? 0) - start) - Math.abs((b.time?.created ?? 0) - start));
    if (candidates[0]?.id) return candidates[0].id;
  }

  return null;
}

async function resolveSessionId(body: ApplyRequest): Promise<{ sessionId: string | null; resolvedFrom: ApplyResult["target"]["resolvedFrom"] }> {
  const explicit = clean(body.sessionId) ?? clean(body.targetSessionId) ?? clean(body.opencodeSessionId);
  if (explicit) return { sessionId: explicit, resolvedFrom: "explicit" };

  const spanSession = clean(body.targetSubagentSpanId) ?? clean(body.targetSpanId);
  if (isSessionLike(spanSession)) return { sessionId: spanSession, resolvedFrom: "targetSubagentSpanId" };

  const runId = clean(body.observedRunId);
  if (!runId) return { sessionId: null, resolvedFrom: null };
  const detail = await fetchWorkshopRun(runId);
  const taskSession = resolveSessionIdFromSpan(detail, spanSession);
  if (taskSession) return { sessionId: taskSession, resolvedFrom: "taskSpanOutput" };

  const childSession = await resolveSessionIdFromOpenCodeChildren(detail, spanSession);
  if (childSession) return { sessionId: childSession, resolvedFrom: "opencodeChildren" };

  return { sessionId: clean(detail?.run?.convo_id), resolvedFrom: "runConvoId" };
}

function promptText(body: ApplyRequest): string {
  return clean(body.afterPrompt) ?? clean(body.message) ?? "Observer nudge: refocus on the assigned task using the trace evidence.";
}

async function callOpenCodePrompt(sessionId: string, text: string, noReply = true): Promise<ApplyResult["opencode"]> {
  const endpoint = `/session/${encodeURIComponent(sessionId)}/prompt_async`;
  const response = await fetch(`${OPENCODE_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      noReply,
      parts: [{ type: "text", text }],
    }),
  });
  const body = await readResponse(response);
  return { baseUrl: OPENCODE_BASE, endpoint, status: response.status, response: body };
}

async function callOpenCodeAbort(sessionId: string): Promise<ApplyResult["opencode"]> {
  const endpoint = `/session/${encodeURIComponent(sessionId)}/abort`;
  const response = await fetch(`${OPENCODE_BASE}${endpoint}`, { method: "POST" });
  const body = await readResponse(response);
  return { baseUrl: OPENCODE_BASE, endpoint, status: response.status, response: body };
}

async function readResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function opencodeAccepted(opencode: ApplyResult["opencode"]): boolean {
  return opencode.status !== null && opencode.status >= 200 && opencode.status < 300;
}

async function postWorkshopEvent(body: ApplyRequest & { action: CanonicalSteeringAction }, status: SteeringStatus, message: string | null, reason: string | null): Promise<unknown> {
  const observedRunId = clean(body.observedRunId);
  if (!observedRunId) return null;
  const response = await fetch(`${WORKSHOP_BASE}/api/steering/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      observedRunId,
      observerRunId: clean(body.observerRunId) ?? undefined,
      targetSpanId: clean(body.targetSpanId) ?? undefined,
      targetSubagentSpanId: clean(body.targetSubagentSpanId) ?? undefined,
      action: body.action,
      status,
      message: message ?? undefined,
      beforePrompt: clean(body.beforePrompt) ?? undefined,
      afterPrompt: clean(body.afterPrompt) ?? undefined,
      reason: reason ?? undefined,
      source: "opencode-actuator",
      confidence: typeof body.confidence === "number" ? body.confidence : undefined,
    }),
  });
  return await readResponse(response);
}

function normalizeAction(action: SteeringAction | undefined): CanonicalSteeringAction | null {
  if (action === "stop") return "abort";
  return action ?? null;
}

async function applySteering(rawBody: ApplyRequest, actionOverride?: SteeringAction): Promise<ApplyResult> {
  const action = normalizeAction(actionOverride ?? rawBody.action);
  if (!action) throw new Error("action is required");
  if (!["nudge", "system_prompt_update", "abort", "restart"].includes(action)) {
    throw new Error(`unsupported action: ${action}`);
  }
  const body = { ...rawBody, action };
  const requestedSpanId = clean(body.targetSubagentSpanId) ?? clean(body.targetSpanId);
  const { sessionId, resolvedFrom } = await resolveSessionId(body);
  if (!sessionId) {
    const reason = clean(body.reason) ?? "No OpenCode session id could be resolved from sessionId, targetSubagentSpanId, task span output, or Workshop run.convo_id.";
    const workshopEvent = body.writeWorkshop === false ? undefined : await postWorkshopEvent(body, "failed", clean(body.message), reason);
    return {
      ok: false,
      action,
      status: "failed",
      sessionId: null,
      target: { requestedSpanId, resolvedFrom },
      opencode: { baseUrl: OPENCODE_BASE, endpoint: null, status: null, response: null },
      workshopEvent,
      error: reason,
    };
  }

  if (body.dryRun) {
    return {
      ok: true,
      action,
      status: "resolved",
      sessionId,
      target: { requestedSpanId, resolvedFrom },
      opencode: {
        baseUrl: OPENCODE_BASE,
        endpoint: null,
        status: null,
        response: "dryRun: resolved target session without calling OpenCode",
      },
    };
  }

  let opencode: ApplyResult["opencode"];
  try {
    if (action === "abort") {
      opencode = await callOpenCodeAbort(sessionId);
    } else if (action === "restart") {
      const abort = await callOpenCodeAbort(sessionId);
      if (!opencodeAccepted(abort)) {
        opencode = abort;
      } else {
        opencode = await callOpenCodePrompt(sessionId, promptText(body), false);
      }
    } else {
      opencode = await callOpenCodePrompt(sessionId, promptText(body), true);
    }
  } catch (err) {
    opencode = {
      baseUrl: OPENCODE_BASE,
      endpoint: null,
      status: null,
      response: err instanceof Error ? err.message : String(err),
    };
  }

  const status: SteeringStatus = opencodeAccepted(opencode) ? "applied" : "failed";
  const message = clean(body.message) ?? (action === "abort" ? "Observer aborted this OpenCode session." : promptText(body));
  const reason = clean(body.reason) ?? (status === "applied" ? `OpenCode accepted ${action}.` : `OpenCode did not accept ${action}.`);
  const workshopEvent = body.writeWorkshop === false ? undefined : await postWorkshopEvent(body, status, message, reason);

  return {
    ok: status === "applied",
    action,
    status,
    sessionId,
    target: { requestedSpanId, resolvedFrom },
    opencode,
    workshopEvent,
    error: status === "applied" ? undefined : reason,
  };
}

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "opencode-steering-actuator",
      workshop: WORKSHOP_BASE,
      opencode: OPENCODE_BASE,
    });
  });

  async function handle(req: express.Request, res: express.Response, action?: SteeringAction) {
    try {
      const result = await applySteering((req.body ?? {}) as ApplyRequest, action);
      res.status(result.ok ? 200 : 502).json(result);
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  app.post("/apply", (req, res) => { void handle(req, res); });
  app.post("/resolve", (req, res) => {
    const body = { ...((req.body ?? {}) as ApplyRequest), dryRun: true, writeWorkshop: false };
    applySteering(body, body.action ?? "nudge")
      .then((result) => res.status(200).json(result))
      .catch((err) => res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  });
  app.post("/nudge", (req, res) => { void handle(req, res, "nudge"); });
  app.post("/system_prompt_update", (req, res) => { void handle(req, res, "system_prompt_update"); });
  app.post("/abort", (req, res) => { void handle(req, res, "abort"); });
  app.post("/stop", (req, res) => { void handle(req, res, "stop"); });
  app.post("/restart", (req, res) => { void handle(req, res, "restart"); });

  return app;
}

export async function startServer(port = DEFAULT_PORT): Promise<{ port: number; close: () => Promise<void> }> {
  const app = createApp();
  return new Promise((resolve) => {
    const server: Server = app.listen(port, () => {
      const addr = server.address() as AddressInfo;
      const actualPort = addr?.port ?? port;
      console.log(`OpenCode Steering Actuator: http://localhost:${actualPort}`);
      console.log(`OpenCode REST: ${OPENCODE_BASE}`);
      resolve({
        port: actualPort,
        close: () => new Promise<void>((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
