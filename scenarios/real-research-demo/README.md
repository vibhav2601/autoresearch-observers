# Real Research Demo Scenario

This scenario replaces the Collatz proof toy problem with a real long-horizon
computational-biology research topic:

> Can prime editing plausibly become a clinically translatable therapy for the
> CFTR F508del cystic fibrosis mutation, either by editing airway basal stem
> cells in vivo or through an ex vivo/autologous-cell workflow?

It exercises realistic observer-recoverable failure modes, with the demo tuned
to emphasize content-level steering: conflicting claims about clinical
readiness, discovery handoffs from completed sibling scouts, unresolved airway
delivery, modality conflation between prime editing and adjacent therapies,
duplicate literature searches, repeated empty cache checks, broken
regulatory/source URLs, and stalled waits for nonexistent exports.

## Run The Demo

Start Workshop:

```bash
cd raindrop-workshop
bun install
bun run build:ui
RAINDROP_WORKSHOP_PORT=5899 bun src/index.ts workshop serve
```

Start the observer:

```bash
cd raindrop-workshop/examples/opencode-observer-agent
bun install
PORT=3031 \
PATH="$HOME/.opencode/bin:$PATH" \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
OPENCODE_OBSERVER_WATCH_EVENT=cftr_prime_editing_demo \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
bun server.ts
```

Run the worker:

```bash
cd scenarios/real-research-demo
PATH="$HOME/.opencode/bin:$PATH" \
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
RAINDROP_EVENT_METADATA='{"eventName":"cftr_prime_editing_demo","userId":"opencode-worker","properties":{"demo":"cftr-prime-editing","topic":"CFTR F508del prime editing"}}' \
opencode run --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-4o-mini "$(cat CFTR_PRIME_EDITING_WORKFLOW_PROMPT.md)"
```

For the content-conflict demo used in judging, set both event names to
`cftr_content_conflict_demo` and use metadata such as:

```bash
RAINDROP_EVENT_METADATA='{"eventName":"cftr_content_conflict_demo","userId":"opencode-worker","properties":{"demo":"cftr-prime-editing-content-conflict","topic":"CFTR F508del prime editing","checkout":"main"}}'
```

Open `http://localhost:5899`. The Observer tab should show high-signal
content nudges such as reconciling "no CFTR prime-editing human trials found"
with roadmap or optimism claims that imply clinical readiness. Observer Debug
should show observer runs, SQLite queries, and decision traces linked to the
CFTR worker run.
