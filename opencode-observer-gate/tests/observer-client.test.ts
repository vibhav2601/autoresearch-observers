import { describe, expect, test } from "bun:test";
import { askObserver, type FetchLike, type ObserverGateRequest } from "../src/observer-client";
import type { ObserverGateConfig } from "../src/config";

function cfg(overrides: Partial<ObserverGateConfig> = {}): ObserverGateConfig {
  return {
    enabled: true,
    observerUrl: "http://observer.test/veto",
    workshopUrl: null,
    timeoutMs: 100,
    tools: new Set(["websearch"]),
    guardrails: { denyTools: [], maxToolCalls: {} },
    guidance: { standingSystem: [] },
    ...overrides,
  };
}

const request: ObserverGateRequest = {
  sessionID: "ses_123",
  callID: "call_456",
  tool: "websearch",
  args: { query: "duplicate topic" },
  ts: 123,
};

describe("askObserver", () => {
  test("posts the veto request and returns a well-formed deny", async () => {
    const calls: unknown[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ decision: "deny", reason: "already covered", confidence: 0.91 });
    };

    const decision = await askObserver(cfg(), request, fetchImpl);

    expect(decision).toEqual({ decision: "deny", reason: "already covered", confidence: 0.91 });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { url: string }).url).toBe("http://observer.test/veto");
    const init = (calls[0] as { init: RequestInit }).init;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual(request);
  });

  test("returns allow when the observer explicitly allows", async () => {
    const decision = await askObserver(cfg(), request, async () => Response.json({ decision: "allow" }));

    expect(decision).toEqual({ decision: "allow" });
  });

  test("fails open on non-200, malformed decisions, thrown errors, and missing URLs", async () => {
    expect(await askObserver(cfg(), request, async () => new Response("no", { status: 500 }))).toBe(null);
    expect(await askObserver(cfg(), request, async () => Response.json({ decision: "maybe" }))).toBe(null);
    expect(await askObserver(cfg(), request, async () => { throw new Error("offline"); })).toBe(null);
    expect(await askObserver(cfg({ observerUrl: null }), request, async () => Response.json({ decision: "deny" }))).toBe(null);
  });

  test("aborts the observer request at the configured timeout", async () => {
    let aborted = false;
    const fetchImpl: FetchLike = async (_url, init) => {
      const signal = init?.signal as AbortSignal;
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      throw new DOMException("aborted", "AbortError");
    };

    const decision = await askObserver(cfg({ timeoutMs: 5 }), request, fetchImpl);

    expect(decision).toBe(null);
    expect(aborted).toBe(true);
  });
});
