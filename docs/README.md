# Context & Hand-off Docs — start here

**New agent session? Read this directory first.** It is the single source of context for
**autoresearch-observers** — read it before planning or writing any code, then point the next
session back here.

## Read in this order

1. **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** — **the master brief.** The closed-loop
   observer-over-research-swarm concept; the locked architecture decisions (Opencode-as-server
   workers, **native subagent-tree fan-out + external observer + gate plugin**, local Raindrop
   Workshop); the 4-pattern → 4-nudge observer spec
   (the eval surface); the L0→L3 build plan with the L0 de-risk spike; known risks + mitigations;
   open decisions; the demo; and prize alignment.

2. **[OpenCode → Raindrop Workshop tracing](../opencode-raindrop-tracing/README.md)** — the
   already-implemented **L0 trace path**: a one-command `setup.sh` that streams OpenCode sessions
   into a local Workshop via the official Raindrop plugin. Read when working on tracing or the L0
   spike. *(Lives next to its `setup.sh` + config by design — it's runnable glue, not just prose,
   so it stays with the code rather than moving here.)*

3. **[STEERING_ACTUATOR.md](STEERING_ACTUATOR.md)** — **the single actuator spec.** How an observer
   decision becomes a real effect on a running worker, across all three levers: **nudge** (inject,
   `prompt{noReply}`), **abandon** (`abort`), and **hard veto** (the in-process synchronous gate
   plugin). Native-subagent-tree topology; cross-worker veto via a synchronous observer round-trip;
   grounded version-pinned hook/SDK signatures; the self-audit requirement; config; package layout +
   code sketch; and merged L0 probes. **Read before building any worker-control code.**

4. **[Replay Steering & Nudge-Value Eval](REPLAY_STEERING_AND_EVAL.md)** — the **L3** design: how
   Workshop replays become a counterfactual **preflight** on high-stakes interventions (abandon /
   major refocus) — distinct from the synchronous gate plugin in #3 — and how pre-nudge "wrong path"
   replays become a per-intervention **value metric** for the demo. Read when working on replay,
   high-stakes steering, or the demo scoreboard.

5. **[OBSERVER_HARNESS.md](OBSERVER_HARNESS.md)** — the **context-management plan** for the
   observer LLM: how the harness keeps the LLM's input small, fresh, and pattern-scoped while the
   worker swarm firehoses spans. Covers the principle (LLM never sees raw spans), the
   continuously-running reducers + bounded state model, the two-clock trigger taxonomy
   (event-driven + clock-driven), the coalescing queue with re-read-at-dequeue, the
   per-`(scope, pattern)` cooldown matrix with escalation bypass, and a gap analysis vs. the current
   skeleton. Read before building observer detection, queueing, or prompt-shaping code.

## Current status (2026-05-30)

Design plus working prototypes. The L0 **trace half** is scaffolded (see #2). The interaction layer
now has an external steering actuator under
`raindrop-workshop/examples/opencode-steering-actuator/` and a synchronous hard-veto gate plugin
under `opencode-observer-gate/`. The next gate is local end-to-end validation: confirm both plugins
load under `opencode serve`, fan out via the native subagent harness, and prove reach (nudge into a
child) + veto + abandon. Details in [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) → "L0 spike".

## Keeping this useful

When a decision changes or a new context doc is added, update `PROJECT_OVERVIEW.md` and add a line
here. Keep `docs/` the canonical place an agent looks first.
