# autoresearch-observers

A closed-loop controller over a multi-agent research swarm: an **observer agent** reads live
execution traces (via Raindrop Workshop) and reactively nudges research workers toward the goal —
stop duplicate work, flag contradictions, kill stalls, refocus drift.

## 📂 Start here for context — [`docs/`](./docs/)

New here (human or agent)? Read [`docs/`](./docs/) first. It's the single source of project
context: the [project overview](./docs/PROJECT_OVERVIEW.md) (concept, locked decisions, build
plan, risks, open questions) plus pointers to everything else.

## OpenCode → Raindrop Workshop tracing

Local setup so OpenCode coding sessions stream live traces into a local
Raindrop Workshop (every message, tool call, and LLM completion).

→ See [`opencode-raindrop-tracing/`](./opencode-raindrop-tracing/) — run
`./setup.sh` and read its README. No fork or patched binaries; it's just config
glue over OpenCode + the Raindrop plugin + Workshop.
