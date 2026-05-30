import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { closeDb, findTaskSpanBySessionId, insertSpan, upsertRun } from "../src/db";
import { createServer } from "../src/server";
import {
  createPendingSteeringEvent,
  createSteeringEvent,
  listPendingSteeringEvents,
  listSteeringEventsForRun,
  resolvePendingSteeringEventsForTaskSpan,
} from "../src/steering";

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

describe("pending steering event resolution", () => {
  test("attaches a child-session writeback when the parent task span arrives later", () => {
    createPendingSteeringEvent({
      observed_convo_id: "ses_child",
      action: "hard_veto",
      status: "applied",
      message: "blocked duplicate evidence probe",
      reason: "observer veto",
      source: "opencode-observer-gate",
      confidence: 1,
    });
    expect(listPendingSteeringEvents()).toHaveLength(1);

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
      output_payload: '<task id="ses_child" state="completed">probe</task>',
      start_time_ms: 2,
      end_time_ms: 9,
      duration_ms: 7,
    });

    const resolved = resolvePendingSteeringEventsForTaskSpan("task-span");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      observed_run_id: "parent-run",
      target_subagent_span_id: "task-span",
      action: "hard_veto",
      source: "opencode-observer-gate",
    });
    expect(listPendingSteeringEvents()).toHaveLength(0);
    expect(listSteeringEventsForRun("parent-run")).toHaveLength(1);
  });

  test("API stores unresolved child-session events and import-run resolves them without manual seeding", async () => {
    const previousDebuggerDev = process.env.DEBUGGER_DEV;
    process.env.DEBUGGER_DEV = "1";
    try {
      const { app } = await createServer(0);

      await request(app)
        .post("/api/steering/events")
        .send({
          observedConvoId: "ses_child_api",
          action: "local_guardrail",
          status: "applied",
          message: "blocked cleanup probe",
          reason: "local guardrail matched",
          source: "opencode-observer-gate",
        })
        .expect(202);

      expect(listPendingSteeringEvents()).toHaveLength(1);

      await request(app)
        .post("/api/import-run")
        .send({
          run: {
            id: "parent-api-run",
            name: "opencode session",
            event_name: "opencode_session",
            user_id: "ses_parent_api",
            convo_id: "ses_parent_api",
            started_at: 1,
            last_updated_at: 10,
          },
          spans: [
            {
              id: "task-api-span",
              run_id: "parent-api-run",
              parent_span_id: "llm-parent",
              name: "task",
              span_type: "TOOL_CALL",
              status: "OK",
              input_payload: JSON.stringify({ subagent_type: "general" }),
              output_payload: '<task id="ses_child_api" state="completed">probe</task>',
              start_time_ms: 2,
              end_time_ms: 9,
              duration_ms: 7,
            },
          ],
        })
        .expect(200);

      expect(listPendingSteeringEvents()).toHaveLength(0);
      expect(listSteeringEventsForRun("parent-api-run")).toMatchObject([
        {
          observed_run_id: "parent-api-run",
          target_subagent_span_id: "task-api-span",
          action: "local_guardrail",
          source: "opencode-observer-gate",
        },
      ]);
    } finally {
      if (previousDebuggerDev === undefined) delete process.env.DEBUGGER_DEV;
      else process.env.DEBUGGER_DEV = previousDebuggerDev;
    }
  });
});
