# Observer A/B benchmark

Single-prompt benchmark that measures wall-clock and token usage for one
OpenCode worker run. Run it twice — once with the observer running in
"disabled" mode, once with the observer active — to compare.

## What it measures

- **Wall-clock** seconds from worker spawn to exit
- **Tokens** (input, output, reasoning, total) summed from `step_finish`
  events on the worker's JSON event stream
- **Cost** (USD) summed from the same events
- **Step count** so you can sanity-check pacing

The observer's own tokens are *not* counted. The benchmark reads the worker's
own `--format json` stream, which only contains the worker's own
`step_finish` events. The observer runs in its own OpenCode process and emits
its own session — those tokens go to a different Workshop run with
`user_id=opencode-observer`, never to the worker's stdout.

## Toggle

The observer agent has an `OBSERVER_DISABLED=1` env var that makes its
internal tick loop early-return. This is the on/off switch for the A/B.

The benchmark script does NOT manage the observer process. You start it
once with the desired flag and leave it running across both runs.

## Two-terminal workflow

**Terminal 1 — Workshop** (always running):

```bash
cd raindrop-workshop
RAINDROP_WORKSHOP_PORT=5899 bun src/index.ts workshop serve
```

**Terminal 2 — observer**, switched between conditions:

```bash
# OFF condition: observer process is up but its tick loop is a no-op
cd raindrop-workshop/examples/opencode-observer-agent
PORT=3031 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
OBSERVER_DISABLED=1 \
bun server.ts

# ON condition: kill the OFF process (Ctrl-C), then:
PORT=3031 \
RAINDROP_WORKSHOP_URL=http://localhost:5899 \
OPENCODE_OBSERVER_MODEL=openai/gpt-4o-mini \
bun server.ts
```

Verify the toggle from a third terminal:

```bash
curl -s http://localhost:3031/health | python3 -c 'import sys,json; print("disabled =", json.load(sys.stdin)["disabled"])'
```

## Run a benchmark

From the repo root, with the observer in the desired state:

```bash
bun scenarios/bench/bench.ts \
  --prompt-file scenarios/hallucinating-subagents/PROMPT.md \
  --cwd scenarios/hallucinating-subagents/fixture-repo \
  --model openai/gpt-4o-mini \
  --label off \
  --output scenarios/bench/results.jsonl
```

Then flip the observer (kill, restart without `OBSERVER_DISABLED`) and run
again with `--label on`.

## What you get

```
label:        on
observer:     ON
session:      ses_185abc1234...
exit:         0
wall-clock:   42.3s
tokens:       in=18432  out=2103  reasoning=0  total=20535
cost:         $0.0085
steps:        7
```

The `observer` line probes `:3031/health` so you can confirm the script saw
the right toggle. `?` means the observer wasn't reachable.

If you pass `--output`, the same data is appended as a JSON line per run so
you can `jq` over many runs later.

## Caveats

- **One run per condition is a demo, not a measurement.** LLM
  nondeterminism dwarfs whatever effect the observer is producing. Use it
  to spot-check the wiring; don't read it as evidence.
- **The observer's startup cost is shared across both conditions** because
  the process is up in both. That's the whole point of the env-var toggle:
  the only thing different between OFF and ON is whether `tick()` does
  anything when its timer fires.
- **Workshop daemon traffic still happens in OFF.** The Raindrop plugin
  inside the worker still POSTs spans to Workshop. So OFF doesn't
  measure "Workshop is gone"; it measures "observer logic is gone".
