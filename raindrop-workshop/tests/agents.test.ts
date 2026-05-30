import { describe, expect, test } from "bun:test";
import { detectSubAgents } from "../src/agents";

const baseSpan = {
  run_id: "run-1",
  status: "OK",
  start_time_ms: 0,
  end_time_ms: 10,
  duration_ms: 10,
  model: null,
  input_tokens: null,
  output_tokens: null,
};

describe("detectSubAgents", () => {
  test("detects OpenCode task spans with Subagent children", () => {
    const agents = detectSubAgents([
      {
        ...baseSpan,
        id: "task-1",
        parent_span_id: "llm-1",
        name: "task",
        span_type: "TOOL_CALL",
      },
      {
        ...baseSpan,
        id: "subagent-1",
        parent_span_id: "task-1",
        name: "Subagent",
        span_type: "INTERNAL",
      },
      {
        ...baseSpan,
        id: "child-llm-1",
        parent_span_id: "subagent-1",
        name: "openai/gpt-4o-mini",
        span_type: "LLM_GENERATION",
        model: "gpt-4o-mini",
        input_tokens: 10,
        output_tokens: 5,
      },
    ]);

    expect(agents).toHaveLength(1);
    expect(agents[0].root_span_id).toBe("task-1");
    expect(agents[0].span_ids).toEqual(["task-1", "subagent-1", "child-llm-1"]);
    expect(agents[0].model).toBe("gpt-4o-mini");
  });
});
