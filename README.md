# autoresearch-observers

A closed-loop controller over a multi-agent research swarm: an **observer
agent** reads live execution traces through Raindrop Workshop and reactively
nudges research workers toward the goal. It can stop duplicate work, flag
contradictions, kill stalls, and refocus drift.

## Start here for context

New here, human or agent? Read [`docs/`](./docs/) first. It is the single
source of project context: the [project overview](./docs/PROJECT_OVERVIEW.md)
covers the concept, locked decisions, build plan, risks, and open questions.

## OpenCode to Raindrop Workshop tracing

Local setup so OpenCode coding sessions stream live traces into a local
Raindrop Workshop: every message, tool call, and LLM completion.

See [`opencode-raindrop-tracing/`](./opencode-raindrop-tracing/). Run
`./setup.sh` and read its README. No fork or patched binaries; it is config
glue over OpenCode, the Raindrop plugin, and Workshop.

## Observer agent plan

[`observer-agent-plan.html`](./observer-agent-plan.html) is a self-contained
HTML spec for the observer architecture, UI behavior, activation rules, and
mocked steering/writeback procedure.

Open it directly in a browser:

```bash
open observer-agent-plan.html
```

The proposed observer runs as a separate local OpenCode process. It watches
Raindrop Workshop traces, reads the local SQLite database, evaluates active
agent/subagent behavior, and writes corrective steering events back into the
Raindrop UI.

The nudge/control bridge can be mocked initially. The UI should still surface:

- observer activity in a dedicated Observer Debug tab,
- only high-signal corrective actions in the main Observer tab,
- compact observer inputs, outputs, and tool calls,
- no observer runs in the primary Runs list.
