# Context & Hand-off Docs — start here

**New agent session? Read this directory first.** It is the single source of context for
**autoresearch-observers** — read it before planning or writing any code, then point the next
session back here.

## Read in this order

1. **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** — **the master brief.** The closed-loop
   observer-over-research-swarm concept; the locked architecture decisions (Opencode-as-server
   workers, flat-session fan-out, local Raindrop Workshop); the 4-pattern → 4-nudge observer spec
   (the eval surface); the L0→L3 build plan with the L0 de-risk spike; known risks + mitigations;
   open decisions; the demo; and prize alignment.

2. **[OpenCode → Raindrop Workshop tracing](../opencode-raindrop-tracing/README.md)** — the
   already-implemented **L0 trace path**: a one-command `setup.sh` that streams OpenCode sessions
   into a local Workshop via the official Raindrop plugin. Read when working on tracing or the L0
   spike. *(Lives next to its `setup.sh` + config by design — it's runnable glue, not just prose,
   so it stays with the code rather than moving here.)*

3. **[STEERING_ACTUATOR.md](STEERING_ACTUATOR.md)** — implementation spec for the **actuator** (how
   an observer decision becomes a real nudge on a worker): the two modes (auto guardrail + injected
   guidance) mapped onto the external REST surface (`prompt{noReply}` / `abort`) vs. in-process
   OpenCode plugin hooks, grounded hook/SDK signatures, the self-audit requirement, and L0 open
   questions. Read before building any worker-control code. **Reconciles the earlier "steer a
   subagent" framing with the locked flat-session decision — start here so you don't build the
   nested-subagent version.**

4. **[OBSERVER_HARNESS.md](OBSERVER_HARNESS.md)** — the **context-management plan** for the
   observer LLM: how the harness keeps the LLM's input small, fresh, and pattern-scoped while the
   worker swarm firehoses spans. Covers the principle (LLM never sees raw spans), the
   continuously-running reducers + bounded state model, the two-clock trigger taxonomy
   (event-driven + clock-driven), the coalescing queue with re-read-at-dequeue, the
   per-`(scope, pattern)` cooldown matrix with escalation bypass, and a gap analysis vs. the current
   skeleton. Read before building observer detection, queueing, or prompt-shaping code.

## Current status (2026-05-30)

Design phase. The L0 **trace half** is scaffolded (see #2). The next gate is the L0 **control
half** — confirm the Raindrop plugin loads under `opencode serve`, spawn flat sessions over the
REST API, and prove stall + abort. Details in [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) → "L0 spike".

## Keeping this useful

When a decision changes or a new context doc is added, update `PROJECT_OVERVIEW.md` and add a line
here. Keep `docs/` the canonical place an agent looks first.
