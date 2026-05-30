import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, findTaskSpanBySessionId, insertSpan, upsertRun } from "../src/db";
import { createSteeringEvent } from "../src/steering";

let dbDir: string | null = null;

beforeEach(() => {
  dbDir = mkdtempSync(path.join(tmpdir(), "rd-steering-test-"));
  process.env.RAINDROP_WORKSHOP_DB_PATH = path.join(dbDir, "workshop.db");
});

afterEach(() => {
  closeDb();
  delete process.env.RAINDROP_WORKSHOP_DB_PATH;
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
  dbDir = null;
});

describe("createSteeringEvent", () => {
  test("accepts all first-class plugin and actuator action types", () => {
    const actions = [
      "nudge",
      "system_prompt_update",
      "abort",
      "stop",
      "restart",
      "hard_veto",
      "tool_cap",
      "local_guardrail",
    ] as const;

    for (const action of actions) {
      const event = createSteeringEvent({
        observed_run_id: `run-${action}`,
        action,
        status: "applied",
        message: `${action} message`,
        source: "test",
      });

      expect(event.action).toBe(action);
      expect(event.status).toBe("applied");
    }
  });
});

describe("findTaskSpanBySessionId", () => {
  test("maps a child OpenCode session back to the parent task span", () => {
    upsertRun({
      id: "parent-run",
      event_id: "event-parent-run",
      name: "opencode session",
      event_name: "opencode_session",
      user_id: "ses_parent",
      convo_id: "ses_parent",
      started_at: 1,
      last_updated_at: 10,
    });

    insertSpan({
      id: "task-span",
      run_id: "parent-run",
      parent_span_id: "llm-parent",
      name: "task",
      span_type: "TOOL_CALL",
      status: "OK",
      input_payload: JSON.stringify({ subagent_type: "general" }),
      output_payload: '<task id="ses_child" state="running">probe</task>',
      start_time_ms: 2,
      end_time_ms: 9,
      duration_ms: 7,
    });

    expect(findTaskSpanBySessionId("ses_child")).toEqual({
      id: "task-span",
      run_id: "parent-run",
    });
  });
});
