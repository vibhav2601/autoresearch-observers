# Replay Steering & Nudge-Value Eval — Design

> Future-facing design for replay steering. Refines the replay/eval direction
> from [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) and adds a per-nudge
> **value eval** for demos and regression analysis.
> Assumes the **native-subagent-tree** topology and the three-lever actuator in
> [`STEERING_ACTUATOR.md`](STEERING_ACTUATOR.md) — read both first.
> Status: **design — approved 2026-05-30** (reconciled the same day to the native-tree + gate-plugin
> decisions). Depends on the L0 trace path (built) and a re-execution probe (not yet run — see Risk).
> **No implementation yet.**

---

## ⚠️ Terminology: "replay preflight" is NOT the gate plugin

The actuator spec already owns the word **"gate"** for the in-process **synchronous veto plugin**
(Lever 3): a fast, **deterministic ~100 ms lookup** on `tool.execute.before`. To avoid a dangerous
collision, this doc calls its concept the **replay preflight**:

| | Gate plugin (Lever 3, STEERING_ACTUATOR) | Replay preflight (this doc, L3) |
|---|---|---|
| When | **Synchronous**, before a tool call runs | **Async**, before the observer commits a high-stakes intervention |
| Cost | Deterministic lookup, ~100 ms, **no LLM, no replay** | Runs a worker forward — seconds + LLM/tool cost |
| Scope | Duplicate / drift **veto** | **Abandon** + **major refocus** only |

**Hard rule: replay never sits on the synchronous veto path.** Re-executing a worker is orders of
magnitude too slow for the gate's budget, and the gate is deterministic by design. Replay preflight
gates only the *slow, expensive, high-stakes* decisions.

---

## TL;DR

Both asks reduce to one primitive: **from a saved pre-decision checkpoint, run a bounded branch
forward and score it.** Build that **Counterfactual Replay engine** once; the steering preflight and
the demo eval are thin adapters over it.

- **Ask A — steering preflight.** Before *high-stakes* interventions only — **abandon** (Lever 2) and
  **major refocus** (Lever 1) — replay `{with-intervention, without}` from the worker's current
  checkpoint and commit only if it wins. It lives in the **observer's decision pipeline**, between
  "LLM proposes intervention" and "observer invokes the lever" — *not* in the gate plugin, *not* on
  the synchronous veto path.
- **Ask B — nudge-value eval.** Batch, after the run. For each intervention that actually fired,
  compare the **recorded** actual outcome against a **replayed** no-intervention counterfactual, and
  report a **composite scoreboard** (ΔCoverage, ΔWasted-steps, ΔUnsupported-claims) per nudge and
  aggregated.

The payoff: the trace stops being something you *look at* and becomes something the controller
*acts on before* steering — and the "wrong path we caught" becomes a measured number, not a claim.

---

## The engine: one primitive, two callers

```
            ┌──────────────────────────────────────────────┐
            │   Counterfactual Replay Engine                 │
            │   fork(checkpoint, branch_policy)              │
            │     → run ≤ horizon (steps / time / $)         │
            │     → score(trajectory) → composite metric     │
            └──────────────────────────────────────────────┘
                  ▲                              ▲
   ONLINE, blocking │                            │ OFFLINE, batch
   ┌────────────────┴────────┐        ┌──────────┴───────────────────┐
   │ ASK A: steering preflight│        │ ASK B: nudge-value eval        │
   │ branches = {with, without}│        │ branches = {recorded actual,  │
   │ before commit; tight cap │        │   replayed no-nudge}; loose cap│
   └─────────────────────────┘        └───────────────────────────────┘
```

The engine knows nothing about *why* it's branching: it takes a checkpoint + a branch policy +
a horizon, returns scored trajectories. That isolation is the point — independently testable, both
callers stay thin. A **checkpoint is a worker's child session** at a chosen message (workers are
native subagents, each with its own `sessionID` under the swarm root). Illustrative interface
(language-neutral; observer language is still an open decision — TS vs Python — per PROJECT_OVERVIEW):

```
Checkpoint   = { sessionID, messageID, recorded_prefix_ref }   // sessionID = the worker child session
BranchPolicy = ObserverOff | SuppressIntervention(id) | ApplyIntervention(intervention)
Horizon      = { max_steps?, max_seconds?, max_usd? }          // at least one cap REQUIRED

replay.fork(cp: Checkpoint, policy: BranchPolicy, h: Horizon) -> Trajectory
replay.score(t: Trajectory) -> { coverage, steps, wasted_steps, unsupported_rate }
```

Every branch is written to Workshop as its own interaction. Reuse the **self-audit pathway already
specified** in STEERING_ACTUATOR (observer POSTs the span to Raindrop ingest `:5899/v1/`, correlated
by the worker's `convo_id`/session) — the preflight verdict and the eval counterfactual both land on
the timeline, consistent with "every nudge/abort/veto written back as its own span."

---

## The one architecture decision: the replay *substrate* (de-risk first)

Everything hinges on this. "Replay" can mean two very different things, and **only re-execution
yields a counterfactual** — a re-render of recorded spans can only show the path that already happened.

| Approach | What it is | Pro | Con |
|---|---|---|---|
| **A — OpenCode-native fork/revert** | `session.revert`/fork a worker **child session** to the checkpoint and run live continuations | Truest agent behavior; least harness code; rides the native tree we committed to | Re-execution leans *harder* on OpenCode session control than nudge/abort do; revert/fork reliability under `opencode serve` is unproven (see #20095 cancel races) |
| **B — Prefix-replay harness** *(substrate-agnostic)* | We already capture every message/tool span. Spin a fresh session, replay the recorded prefix to the checkpoint, then continue with/without the intervention | Doesn't depend on fork/revert; we own it; works even if native revert is flaky | More harness code; a prefix replay isn't a perfect state restore |
| **C — pure trace re-render** | Re-paint recorded spans | — | **Insufficient for both asks** (no new path). Only good for the human timeline / self-audit you already have |

**Recommendation: B as the spine, behind the one-method `fork()` interface, with A as a drop-in
optimization once the probe proves child-session fork/revert is reliable under `opencode serve`.**
The project now deliberately rides the native subagent path (treating its bugs as probes to pass) —
so A is no longer off-limits on principle; it's just *unproven for re-execution specifically*, and
re-running a worker is a heavier ask than the inject/abort the actuator already relies on. B keeps
L3 decoupled from that risk; promote to A when the probe is green.

**Determinism lever (matters for both callers).** Cache the *actual* tool/web responses from the
original run, keyed by call signature. Then the prefix replays deterministically, and the
no-intervention continuation serves cached responses for repeated queries — making the counterfactual
faithful instead of a fresh random walk. Without this, a research worker's web + LLM non-determinism
makes the counterfactual a different question each time.

---

## Ask A — replay as a *preflight*, not a tool

Replay lives in the **observer's decision pipeline**, gated to the few decisions where a wrong call
is expensive — and explicitly off the synchronous veto path:

1. Heuristic wakes the observer → LLM proposes `Intervention { action, payload, reason, confidence }`.
2. The observer classifies **stakes**:
   - **Synchronous veto** (duplicate / drift block) → the **gate plugin** answers from its
     deterministic lookup. **No preflight** — replay is far too slow for that path.
   - **Low-stakes async** (contradiction re-verify, minor refocus) → invoke the lever immediately,
     as today.
   - **High-stakes async** — **abandon** (Lever 2) or **major refocus** (Lever 1) → run the preflight.
3. **Preflight:** two bounded branches from the worker's current checkpoint — `ApplyIntervention` vs
   `ObserverOff` — each under a **tight** horizon cap (small `max_steps` / `max_seconds` / `max_usd`).
   Commit only if `score(apply) − score(skip) > margin`; otherwise hold (optionally fall back to a
   softer nudge).
4. **Self-audit either way:** write the preflight verdict back as its own span —
   *"considered ABANDON @ step 12; replay projected skip = +0 coverage / +8 steps vs apply = recovery;
   committed."*

This preserves the "don't over-steer" guarantee (a thrashing controller is worse than none) while
bounding replay cost to the handful of high-stakes calls per run.

---

## Ask B — pre-nudge "wrong path" replays as the demo eval

Batch / pre-computed (no mid-demo latency or cost spikes). For **each intervention that actually
fired**:

- **Actual side = recorded.** It really happened — read it straight from Workshop. No replay, zero
  added cost, ground truth.
- **Counterfactual side = replayed.** From the pre-intervention checkpoint, run the worker child
  session forward with the intervention suppressed, to the same horizon.
- **Branch policy (default): `ObserverOff` from the checkpoint** — let the worker run free. Cleanest
  "here's where it was heading" story. (Alternative knob below: `SuppressIntervention` for strict
  marginal attribution.)

**Composite scoreboard, per intervention at horizon H:**

| Metric | Definition |
|---|---|
| **ΔCoverage** | `coverage_actual(H) − coverage_cf(H)` — coverage-map points the intervention saved |
| **Wasted steps averted** | steps the counterfactual burned that did **not** raise coverage |
| **ΔUnsupported-claims** | `unsupported_rate_cf(H) − unsupported_rate_actual(H)` |

Aggregate across all fired interventions → headline demo numbers: *"N wasted steps averted, X
coverage points saved, Y fewer unsupported claims."* Per-intervention drill-down lives on the
timeline as the self-audit spans.

**This extends the eval surface.** Today it asserts *correctness*: "pattern P → nudge N." This adds
*value*: "intervention N at checkpoint C averted cost Z." It complements the global **observer
OFF-vs-ON** A/B by attributing value **per intervention**, not just per run — and it works uniformly
across all three levers (a vetoed duplicate, an abandoned staller, a refocused drifter all get a
counterfactual).

---

## Credibility guardrails

Cheap to add, and they're what survive a skeptical review:

- **Non-determinism → distribution, not a point.** Run each counterfactual ~3× and report
  median + range. (The response cache shrinks the variance at its source.)
- **Report the preflight's false-positive rate too.** High-stakes calls the preflight *vetoed*
  because the counterfactual turned out fine → the story is self-aware, not cherry-picked.
- **Equal, bounded horizon** for both branches of any comparison; declared up front.
- **Faithfulness caveat, stated honestly:** the counterfactual is an *estimate* of the wrong path,
  not a re-run of the exact one. The recorded pre-nudge drift (real) is the evidence the intervention
  was *warranted*; the replay estimates how *costly* not intervening would have been.

---

## Risk & graceful degradation

The whole scope rests on re-execution working. **De-risk it with a dedicated
replay probe** before building policy around it: *"`revert`/fork a worker child
session to an earlier message and re-run a divergent continuation under
`opencode serve`; confirm both branches land as their own interactions on the
Workshop timeline."*

Degradation ladder if re-execution is shaky:

1. **Best — A (native fork/revert):** cheapest, truest, rides the native tree.
2. **Default — B (prefix-replay + response cache):** robust, decoupled from fork/revert reliability.
3. **Floor — recorded-only (no counterfactual):** show the *recorded* drift before each intervention
   vs. the *recorded* recovery after. No replay, 100% reliable, weaker claim ("it recovered") but it
   never fails live. Keep this as the demo's safety net regardless of A/B.

---

## How it slots into the build plan

- **L3 (Replay steering)** = Ask A (the preflight). The documented "wow."
- **Eval artifact** = Ask B (the batch nudge-value scoreboard) — a small addition to "the demo,"
  reusing the same engine.
- **Additive to the observer's decision logic; invokes the *existing* three levers** in
  STEERING_ACTUATOR — it adds no new actuator surface and **does not touch the gate plugin**. The
  four-patterns→levers spec and the P→N eval surface are unchanged (the eval *extends* them with value).
- **Prereq:** the L0 trace path (built) supplies the recorded prefixes and the response cache the
  engine replays.

---

## Open knobs

- **Counterfactual branch policy** — default `ObserverOff` (simplest, cleanest "where it was
  heading"). Alternative: `SuppressIntervention` (suppress only this one, observer keeps steering
  after) for strict marginal attribution. Start with `ObserverOff`.
- **Substrate** — B by default; switch to A only once the L3 fork/revert probe is green.
- **Horizon caps** — preflight uses a tight cap (latency-bound, online); eval can use a looser cap.
  Exact step/time/$ numbers TBD during L0/L3 against real worker pacing.
- **Repeat count `N`** for counterfactual averaging — start at 3; raise if variance is high.
- **High-stakes set** — `{ abandon (Lever 2), major refocus (Lever 1) }`. The synchronous veto
  (Lever 3) is **excluded by design**. Revisit once the levers are implemented.
