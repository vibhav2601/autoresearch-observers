import { describe, expect, test } from "bun:test";
import { createObserverGatePlugin } from "../src/index";

describe("ObserverGate plugin", () => {
  test("returns no hooks when disabled", async () => {
    const hooks = await createObserverGatePlugin({
      env: {},
      configPath: "/missing/steer.json",
      fetch: async () => Response.json({ decision: "deny" }),
    });

    expect(hooks).toEqual({});
  });

  test("skips observer round-trips for ungated tools", async () => {
    let calls = 0;
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_URL: "http://observer.test/veto",
        OBSERVER_GATE_TOOLS: "websearch",
      },
      configPath: "/missing/steer.json",
      fetch: async () => {
        calls += 1;
        return Response.json({ decision: "deny" });
      },
    });

    await hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "ses", callID: "call" },
      { args: { command: "echo ok" } },
    );

    expect(calls).toBe(0);
  });

  test("throws a useful hard-veto error when the observer denies", async () => {
    const workshopEvents: unknown[] = [];
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_URL: "http://observer.test/veto",
        OBSERVER_GATE_WORKSHOP_URL: "http://workshop.test",
        OBSERVER_GATE_TOOLS: "websearch",
      },
      configPath: "/missing/steer.json",
      now: () => 999,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/api/steering/events")) {
          workshopEvents.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        return Response.json({ decision: "deny", reason: "Searcher 1 already retrieved this.", confidence: 0.94 });
      },
    });

    await expect(hooks["tool.execute.before"]?.(
      { tool: "websearch", sessionID: "ses", callID: "call" },
      { args: { query: "same paper" } },
    )).rejects.toThrow("[observer veto] Searcher 1 already retrieved this.");
    expect(workshopEvents).toEqual([{
      observedConvoId: "ses",
      action: "hard_veto",
      status: "applied",
      message: "Searcher 1 already retrieved this.",
      reason: "Searcher 1 already retrieved this.",
      source: "opencode-observer-gate",
      confidence: 0.94,
    }]);
  });

  test("fails open when the observer is unavailable", async () => {
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_URL: "http://observer.test/veto",
        OBSERVER_GATE_TOOLS: "websearch",
      },
      configPath: "/missing/steer.json",
      fetch: async () => { throw new Error("offline"); },
    });

    await expect(hooks["tool.execute.before"]?.(
      { tool: "websearch", sessionID: "ses", callID: "call" },
      { args: { query: "maybe duplicate" } },
    )).resolves.toBeUndefined();
  });

  test("enforces local denyTool guardrails before asking the observer", async () => {
    let calls = 0;
    const workshopEvents: unknown[] = [];
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_URL: "http://observer.test/veto",
        OBSERVER_GATE_WORKSHOP_URL: "http://workshop.test",
        OBSERVER_GATE_DENY_TOOLS: "bash:rm*",
      },
      configPath: "/missing/steer.json",
      fetch: async (input, init) => {
        if (String(input).endsWith("/api/steering/events")) {
          workshopEvents.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        calls += 1;
        return Response.json({ decision: "allow" });
      },
    });

    await expect(hooks["tool.execute.before"]?.(
      { tool: "bash", sessionID: "ses", callID: "call" },
      { args: { command: "rm -rf scratch" } },
    )).rejects.toThrow("[observer guardrail] blocked bash command");
    expect(calls).toBe(0);
    expect(workshopEvents).toEqual([{
      observedConvoId: "ses",
      action: "local_guardrail",
      status: "applied",
      message: "[observer guardrail] blocked bash command",
      reason: "[observer guardrail] blocked bash command",
      source: "opencode-observer-gate",
    }]);
  });

  test("appends local max-tool-call guidance after the configured cap", async () => {
    const workshopEvents: unknown[] = [];
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_WORKSHOP_URL: "http://workshop.test",
        OBSERVER_GATE_MAX_TOOL_CALLS: "websearch=1",
      },
      configPath: "/missing/steer.json",
      fetch: async (input, init) => {
        if (String(input).endsWith("/api/steering/events")) {
          workshopEvents.push(JSON.parse(String(init?.body)));
          return Response.json({ ok: true });
        }
        return Response.json({ decision: "allow" });
      },
    });
    const first = { title: "result", output: "first", metadata: {} };
    const second = { title: "result", output: "second", metadata: {} };

    await hooks["tool.execute.after"]?.(
      { tool: "websearch", sessionID: "ses", callID: "call-1", args: { query: "a" } },
      first,
    );
    await hooks["tool.execute.after"]?.(
      { tool: "websearch", sessionID: "ses", callID: "call-2", args: { query: "b" } },
      second,
    );

    expect(first.output).toBe("first");
    expect(second.output).toContain("Observer guidance");
    expect(second.output).toContain("websearch has been used 2 times");
    expect(workshopEvents).toHaveLength(1);
    expect(workshopEvents[0]).toMatchObject({
      observedConvoId: "ses",
      action: "tool_cap",
      status: "applied",
      reason: "websearch exceeded the configured maxToolCalls limit.",
      source: "opencode-observer-gate",
    });
    expect((workshopEvents[0] as { message: string }).message).toContain("websearch has been used 2 times");
  });

  test("adds standing system guidance to worker turns", async () => {
    const hooks = await createObserverGatePlugin({
      env: {
        OBSERVER_GATE_ENABLED: "true",
        OBSERVER_GATE_STANDING_SYSTEM: "Stay on your assigned subquestion.",
      },
      configPath: "/missing/steer.json",
      fetch: async () => Response.json({ decision: "allow" }),
    });
    const output = { system: ["Existing system."] };

    await hooks["experimental.chat.system.transform"]?.(
      { sessionID: "ses", model: {} as never },
      output,
    );

    expect(output.system).toEqual(["Existing system.", "Stay on your assigned subquestion."]);
  });
});
