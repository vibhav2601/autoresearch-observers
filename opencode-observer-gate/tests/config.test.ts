import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempConfig(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "observer-gate-"));
  tempDirs.push(dir);
  const file = path.join(dir, "steer.json");
  writeFileSync(file, contents);
  return file;
}

describe("loadConfig", () => {
  test("defaults to disabled fail-open mode when no observer URL is configured", () => {
    const cfg = loadConfig({ env: {}, configPath: "/missing/steer.json" });

    expect(cfg.enabled).toBe(false);
    expect(cfg.observerUrl).toBe(null);
    expect(cfg.workshopUrl).toBe(null);
    expect(cfg.timeoutMs).toBe(100);
    expect([...cfg.tools]).toEqual(["websearch", "webfetch"]);
    expect(cfg.guardrails.denyTools).toEqual([]);
    expect(cfg.guidance.standingSystem).toEqual([]);
  });

  test("parses observer env and normalizes tool allowlist", () => {
    const cfg = loadConfig({
      env: {
        OBSERVER_GATE_URL: "http://localhost:3031/veto",
        OBSERVER_GATE_WORKSHOP_URL: "http://localhost:5899",
        OBSERVER_GATE_TIMEOUT_MS: "250",
        OBSERVER_GATE_TOOLS: " websearch, bash , websearch ",
      },
      configPath: "/missing/steer.json",
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.observerUrl).toBe("http://localhost:3031/veto");
    expect(cfg.workshopUrl).toBe("http://localhost:5899");
    expect(cfg.timeoutMs).toBe(250);
    expect([...cfg.tools]).toEqual(["websearch", "bash"]);
  });

  test("uses the kill switch even when an observer URL is configured", () => {
    const cfg = loadConfig({
      env: {
        OBSERVER_GATE_URL: "http://localhost:3031/veto",
        OBSERVER_GATE_ENABLED: "false",
      },
      configPath: "/missing/steer.json",
    });

    expect(cfg.enabled).toBe(false);
  });

  test("loads local guardrails and standing guidance from steer.json", () => {
    const configPath = tempConfig(JSON.stringify({
      guardrails: {
        denyTools: ["bash:rm*", "write"],
        maxToolCalls: { websearch: 2 },
      },
      guidance: {
        standingSystem: ["Stay on the assigned subquestion."],
      },
    }));

    const cfg = loadConfig({
      env: { OBSERVER_GATE_ENABLED: "true" },
      configPath,
    });

    expect(cfg.guardrails.denyTools).toEqual(["bash:rm*", "write"]);
    expect(cfg.guardrails.maxToolCalls).toEqual({ websearch: 2 });
    expect(cfg.guidance.standingSystem).toEqual(["Stay on the assigned subquestion."]);
  });

  test("loads observer connection settings from steer.json", () => {
    const configPath = tempConfig(JSON.stringify({
      observer: {
        url: "http://127.0.0.1:4555/veto",
        workshopUrl: "http://127.0.0.1:5899",
        timeoutMs: 250,
        tools: ["read", "bash"],
      },
    }));

    const cfg = loadConfig({ env: {}, configPath });

    expect(cfg.enabled).toBe(true);
    expect(cfg.observerUrl).toBe("http://127.0.0.1:4555/veto");
    expect(cfg.workshopUrl).toBe("http://127.0.0.1:5899");
    expect(cfg.timeoutMs).toBe(250);
    expect([...cfg.tools]).toEqual(["read", "bash"]);
  });

  test("env observer settings override steer.json", () => {
    const configPath = tempConfig(JSON.stringify({
      observer: {
        url: "http://config.test/veto",
        timeoutMs: 250,
        tools: ["read"],
      },
    }));

    const cfg = loadConfig({
      env: {
        OBSERVER_GATE_URL: "http://env.test/veto",
        OBSERVER_GATE_TIMEOUT_MS: "500",
        OBSERVER_GATE_TOOLS: "websearch",
      },
      configPath,
    });

    expect(cfg.observerUrl).toBe("http://env.test/veto");
    expect(cfg.timeoutMs).toBe(500);
    expect([...cfg.tools]).toEqual(["websearch"]);
  });
});
