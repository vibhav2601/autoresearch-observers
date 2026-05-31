# Local Setup

This is the fastest path for any engineer to run the project locally and
smoke-test the full loop: trace capture, observer judgment, Workshop UI
writeback, and live OpenCode steering.

## Prerequisites

- `bun`
- `opencode`
- model/provider credentials available to OpenCode
- a shell where `RAINDROP_LOCAL_DEBUGGER` can be set for worker runs

## What To Look For

- The worker run appears in Workshop with normal OpenCode spans.
- Observer runs are hidden from the main Runs list so they do not clutter the
  worker timeline.
- The **Observer Debug** tab shows compact observer inputs, decisions, and
  SQLite/tool activity.
- The **Observer** tab shows only high-signal corrective steering events.
- When the actuator is running, applied nudges are injected into the target
  OpenCode session and written back to Workshop as `applied` events.

## 1. Start Workshop

```bash
cd raindrop-workshop
bun install
bun run build:ui
RAINDROP_WORKSHOP_PORT=5899 bun src/index.ts workshop serve
```

Open `http://localhost:5899`.

## 2. Start The Observer

Use a fast observer model for live demos so decisions finish while the worker
is still active.

```bash
cd raindrop-workshop/examples/opencode-observer-agent
bun install
PORT=3031 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
bun run dev
```

Health check:

```bash
curl -sS http://localhost:3031/health
```

## 3. Start OpenCode Server

The actuator needs a controllable OpenCode server.

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

## 4. Start The Steering Actuator

```bash
cd raindrop-workshop/examples/opencode-steering-actuator
bun install
PORT=3032 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
OPENCODE_BASE_URL=http://localhost:4096 \
bun run dev
```

## 5. Run The Main Scenario

The most complete demo is the complex hallucinating-subagents prompt. It
creates a parent coordinator, several disagreeing subagents, stale local notes,
authoritative local facts, and enough runtime for the observer to intervene.

```bash
cd scenarios/hallucinating-subagents/fixture-repo
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --attach http://localhost:4096 \
  --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-4o-mini \
  "$(cat ../COMPLEX_DYNAMIC_WORKFLOW_PROMPT.md)"
```

If the run finishes too quickly for a live nudge, use a slower worker model or
the longer prompt variants documented in
[`scenarios/hallucinating-subagents/README.md`](../scenarios/hallucinating-subagents/README.md).

## 6. Inspect The Result

In Workshop, open the worker run and check:

- **Spans:** parent LLM activity plus `task` spans for child subagents.
- **Observer Debug:** observer activation reason, compact trace inputs,
  decisions, and tool activity.
- **Observer:** corrective actions only, with reason, confidence, target, and
  status.

For a healthy run, the observer may stay quiet. For a drift, loop, stale-source
expansion, or contradiction, it should post a steering event and, when the
actuator can resolve the OpenCode session, apply the nudge to the active worker.

## Optional: OFF vs. ON Benchmark

Use the benchmark harness to compare one prompt with the observer disabled and
enabled. It records wall-clock time, tokens, cost, and step count from the
worker's JSON stream.

```bash
bun scenarios/bench/bench.ts \
  --prompt-file scenarios/hallucinating-subagents/PROMPT.md \
  --cwd scenarios/hallucinating-subagents/fixture-repo \
  --model openai/gpt-4o-mini \
  --label on \
  --output scenarios/bench/results.jsonl
```

See [`scenarios/bench/README.md`](../scenarios/bench/README.md) for the full
OFF vs. ON workflow.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No worker trace appears | Confirm `RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/` is set in the worker shell. |
| Observer tab is empty | Check `curl -sS http://localhost:3031/health` and wait for new worker activity. |
| Steering event is `failed` | Confirm the actuator is running on `:3032` and `opencode serve` is running on `:4096`. |
| Nudge records but worker does not react | The target child session may already have completed; inspect the event target and try a slower prompt or parent-session nudge. |
