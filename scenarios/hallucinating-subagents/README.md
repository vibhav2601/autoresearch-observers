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
