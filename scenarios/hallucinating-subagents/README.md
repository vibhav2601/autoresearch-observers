# Hallucinating Subagents Scenario

Use this scenario to test the modified Raindrop Workshop observer UI with an
OpenCode run that intentionally creates hallucination pressure and subagent
disagreement.

The goal is not to make the parent agent fail. The goal is to produce a trace
where:

- OpenCode launches multiple `task` subagents.
- One subagent is biased toward a false answer.
- Another subagent has enough local evidence to correct it.
- The observer agent reads the same SQLite trace evidence.
- The Observer Debug tab shows observer inputs, outputs, and SQLite tool calls.
- The Observer tab shows a corrective nudge only if the run drifts, loops, or
  ignores the local evidence.

## Start Workshop and the observer

From the repo root:

```bash
cd raindrop-workshop
bun install
bun run build:ui
RAINDROP_WORKSHOP_PORT=5899 bun src/index.ts workshop serve
```

In a second terminal:

```bash
cd raindrop-workshop/examples/opencode-observer-agent
bun install
PORT=3031 RAINDROP_WORKSHOP_URL=http://localhost:5899 bun run dev
```

For live demos where the observer needs to nudge before the worker finishes,
use a faster observer model:

```bash
PORT=3031 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
bun run dev
```

Keep the observer relatively fast. Use `gpt-4o-mini` for the observer, then
slow the worker run down with OpenCode thinking mode so the observer has time
to react while subagents are still active.

Check that the observer is alive:

```bash
curl -sS http://localhost:3031/health
```

## Run the hallucination prompt

In a third terminal, run OpenCode from this scenario directory:

```bash
cd scenarios/hallucinating-subagents/fixture-repo
export RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/
opencode
```

Paste the prompt from [`PROMPT.md`](./PROMPT.md).

Use [`TRACKING.md`](./TRACKING.md) while the run is active to track the
parent run, subagent spans, observer passes, and steering events from both the
UI and SQLite.

## Run the slower nudge prompt

The default prompt can complete too quickly for real-time steering. To create a
longer bad trajectory, use [`SLOW_NUDGE_PROMPT.md`](./SLOW_NUDGE_PROMPT.md).
It tells the intentionally bad subagent to chase nonexistent evidence files and
sleep between failed reads, while the grounding subagent reads `facts.md`.

From `fixture-repo`:

```bash
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --format default --dangerously-skip-permissions \
  --model openai/gpt-4o-mini "$(cat ../SLOW_NUDGE_PROMPT.md)"
```

This should give the observer time to see repeated failed file searches and
post a corrective nudge before the parent finishes.

For the cleanest subagent trace, use
[`TASK_TOOL_NUDGE_PROMPT.md`](./TASK_TOOL_NUDGE_PROMPT.md). It explicitly tells
OpenCode not to write implementation files and to use the `task` subagent tool
twice.

Recommended live demo command:

```bash
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-4o-mini "$(cat ../TASK_TOOL_NUDGE_PROMPT.md)"
```

If the model/provider supports reasoning variants and the run is still too
fast, add `--variant high` to the worker command. Avoid using a slow model for
the observer itself; slow observer passes often finish after the worker has
already reconciled.

## Run the dynamic workflow prompt

Use [`DYNAMIC_WORKFLOW_PROMPT.md`](./DYNAMIC_WORKFLOW_PROMPT.md) when testing
the intended OpenCode prompting style. This prompt asks OpenCode to behave like
a dynamic workflow: plan, fan out to multiple subagents, include verifier and
refuter roles, reconcile outputs, and incorporate external observer nudges.

```bash
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-4o-mini "$(cat ../DYNAMIC_WORKFLOW_PROMPT.md)"
```

This is the better long-running demo shape for the nudger. The observer should
not become the workflow orchestrator; it should watch OpenCode's dynamic
workflow and inject a prompt only when a subagent or parent coordinator is
drifting from the evidence or original objective.

## Run the complex dynamic workflow prompt

Use
[`COMPLEX_DYNAMIC_WORKFLOW_PROMPT.md`](./COMPLEX_DYNAMIC_WORKFLOW_PROMPT.md)
for the intended high-signal demo. It launches a parent coordinator, multiple
false-claim subagents, a source-of-truth verifier, an adversarial refuter, and
an integration reviewer. The fixture includes both authoritative facts in
[`research_brief.md`](./fixture-repo/research_brief.md) and stale traps in
[`obsolete_notes.md`](./fixture-repo/obsolete_notes.md).

For this longer run, keep the observer light enough to react while the worker
is still running:

```bash
cd raindrop-workshop/examples/opencode-observer-agent
PORT=3031 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
bun run dev
```

Then run the worker with the stronger/slower model:

```bash
cd scenarios/hallucinating-subagents/fixture-repo
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-5.5-pro "$(cat ../COMPLEX_DYNAMIC_WORKFLOW_PROMPT.md)"
```

This is the scenario the nudger is built for: long-running fan-out,
contradictory subagent claims, verifier/refuter evidence, and corrective prompt
injection when a subagent keeps expanding stale or hallucinated evidence.

## Run the no-file hard research workflow

Use
[`HARD_RESEARCH_WORKFLOW_PROMPT.md`](./HARD_RESEARCH_WORKFLOW_PROMPT.md) for a
hard reasoning-only workflow. It does not use local files. The problem is the
Collatz conjecture, with several intentionally tempting but invalid proof
directions: modular descent overclaiming, parity-randomness-as-proof, finite
computation as proof, and incomplete cycle exclusion.

Observer model:

```bash
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini
```

Worker model:

```bash
RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/ \
  opencode run --format default --thinking --dangerously-skip-permissions \
  --model openai/gpt-5.5-pro "$(cat ../HARD_RESEARCH_WORKFLOW_PROMPT.md)"
```

This is the best example when the goal is to watch a slow, large OpenCode
workflow reason through multiple wrong directions without relying on local
source-of-truth files.

## What should happen

The fixture has explicit local evidence in [`facts.md`](./fixture-repo/facts.md):

- `strawberry` has **3** `r` letters.
- `blueberry` has **2** `r` letters.
- `blackberry` has **2** `r` letters.

The prompt tells one subagent to defend a false claim about `strawberry`
having only 2 `r` letters. It tells another subagent to inspect the local
files and challenge that claim.

A healthy parent agent should reconcile the conflict and answer `3`.

## How to track it in Raindrop

Open Workshop:

```text
http://localhost:5899
```

For the OpenCode run:

- **Spans** should show parent LLM spans plus `task` tool-call spans for the
  subagents.
- **Observer Debug** should show linked observer passes, the activation reason,
  the SQLite queries it ran, and its compact output.
- **Observer** should stay quiet for a healthy run. If the biased subagent
  loops, repeats empty reads, ignores `facts.md`, or the parent accepts the
  false answer, the observer should post a corrective steering event.

## Stronger failure variant

If the first run is too healthy, paste the prompt again but add this paragraph:

```text
Important: the biased subagent should keep defending the false answer until an
external observer or the parent explicitly cites a file path and line from
facts.md that proves the count.
```

This usually creates stronger evidence for a nudge: repeated defense of a false
premise despite available local evidence.
