# autoresearch-observers — Project Overview

> **Hand-off doc for a fresh agent session.** Read this top-to-bottom and you have the full
> context: what we're building, why, the locked architectural decisions, what's still open,
> and where to start. Status as of **2026-05-30**: design phase, with the **L0 trace path already
> scaffolded** — see [`opencode-raindrop-tracing/`](../opencode-raindrop-tracing/) (merged PR #1):
> one-command `setup.sh` that streams OpenCode sessions into a local Workshop via the official
> Raindrop plugin. The **observer↔worker interaction layer now has prototypes** — native subagent
> tree + external observer, an external OpenCode steering actuator for nudge/abort, and an
> in-process **gate plugin** for synchronous veto; full spec in
> [`STEERING_ACTUATOR.md`](STEERING_ACTUATOR.md).

---

## TL;DR

We're building a **closed-loop controller over a multi-agent research swarm**. A fleet of
research worker agents fans out on a hard question; an **observer agent** watches their
execution traces in real time and **reactively nudges them** — stopping duplicated work,
flagging contradictions, killing stalls, refocusing drift — to steer the swarm toward the goal.

The traces are the sensor. The observer is the controller. The nudges are the actuator. The
research goal (decomposed into a coverage map) is the setpoint. **The whole thing runs locally.**

This is a hackathon project. The headline differentiator: a trace isn't something you *look at*
after the fact — it's something the system *reads and reacts to at runtime*.

---

## The control-loop framing (the mental model)

| Control concept | In this system |
|---|---|
| **Plant** | The research worker agent(s) |
| **Sensor** | Execution traces — emitted by the worker harness, streamed to Raindrop Workshop + an event stream |
| **Controller** | The observer agent (external process) |
| **Actuator** | Three levers on workers: **nudge** (context-inject, REST), **abandon** (abort, REST), **hard veto** (synchronous, via the in-process gate plugin) |
| **Setpoint** | The research goal, decomposed into a **coverage map** (checklist of sub-questions/claims to evidence) |
| **Error term** | Coverage delta (open checklist items untouched) + novelty decay (new-info rate → 0) |

---

## What the observer actually does (the core spec)

The observer detects a **small, fixed set of coordination-failure patterns** — NOT "general
supervision" (which is unbounded and undemoable). Each pattern maps to one specific nudge.
**This P→N mapping is the eval surface**: tests assert "given trace pattern P, observer emits
nudge N." Those same assertions become regression tests in the self-healing loop.

| # | Pattern | Detection (from traces) | Nudge (the actuator) |
|---|---|---|---|
| 1 | **Duplicate work** — two searchers chasing the same query/source | Fuzzy-match search spans across agents in a sliding window | "Stop — Searcher 2 already has this" (block / reassign) |
| 2 | **Contradiction** — two searchers return conflicting findings on the same fact | Cluster claims, flag opposing assertions | "Your finding conflicts with Searcher 1 — re-verify" |
| 3 | **Stall / blocker** — synthesizer waiting on a looping/stuck searcher | Span-duration thresholds + dependency state | "Abandon this thread, return what you have" |
| 4 | **Drift** — a searcher wandering off its assigned subquestion | Semantic similarity between recent activity and the assigned task | "Refocus on subquestion X" |

**Decision policy is hybrid** (keeps it fast + cheap): cheap *deterministic heuristics* on span
features (repeat count, novelty score, coverage overlap, duration) decide **when** to wake the
observer; the *LLM observer* decides **what** to do, emitting a typed intervention:

```
Intervention { action, payload, reason, confidence }
```

LLM nudges are **rate-limited and confidence-gated** so the controller can't over-steer (a
thrashing controller is worse than none).

**Self-audit (this is what makes the observability tool load-bearing):** every diagnosis + action
is written back as its **own span on the same trace timeline** — producing a complete audit trail
("saw looping at step 12 → banned query → novelty recovered"), the demo overlay, and the data for
replay-based learning.

---

## Locked architectural decisions

### Worker substrate: **Opencode, run as a server** (NOT the OpenAI Agents SDK)

We evaluated building workers on the OpenAI Agents SDK and **rejected it** in favor of Opencode.
Rationale: Opencode is a *complete, open-source agent harness* (loop, tools, MCP, multi-model,
sessions) we can drive and modify — vs. the Agents SDK, which is a *library we'd have to
reassemble an agent from*. Velocity wins for a hackathon.

Opencode runs headless via `opencode serve`, exposing an HTTP API (OpenAPI 3.1 at `/doc`). The
relevant control surface:

| Capability | Mechanism |
|---|---|
| Spawn workers | **Native subagent harness** (planner spawns role subagents) — *not* the observer's job |
| Enumerate workers | `GET /session/:id/children` (the swarm tree; each child = one worker, own session ID) |
| **Nudge** (inject context, no reply) | `POST /session/:id/prompt_async` · `session.prompt({ noReply: true })` → targets a worker's child session *(reach into a Task-spawned child via REST is L0 probe #4, see #6573)* |
| **Abandon** a worker | `POST /session/:id/abort` (cooperative) + stop consuming its output |
| **Hard veto** (synchronous, pre-execution) | the **observer gate plugin** — `tool.execute.before` throws to block the call *(not a REST endpoint; see STEERING_ACTUATOR.md)* |
| Stream the sensor feed | `GET /event` (SSE) |
| Inspect / delete | `GET /session`, `GET /session/:id`, `DELETE /session/:id` |

So all four nudges have a concrete home, and the observer can be an **external process** driving
workers over REST + SSE. The TS-only `@opencode-ai/sdk` is not a lock-in (raw REST works from any
language).

### Fan-out model: **native subagent tree, externally observed** — *(updated 2026-05-30, supersedes the earlier "flat sessions" decision)*

**Use Opencode's native subagent harness for the fan-out.** The planner agent fans out by spawning
role-configured subagents (searchers, synthesizer) through the built-in harness; each subagent runs
in **its own child session with its own session ID**, forming a tree under a swarm root. We do
**not** rebuild spawning over REST — we lean on the harness that already exists.

**The brain stays external** (the overview's core intent, unchanged). What moves is *spawning*:
fan-out is now the harness/planner's job, not the observer's. The observer's authority is in
**steering the live swarm** — veto a duplicate before it runs, abandon a staller, refocus a drifter
— which is dynamic scheduling by another name (it reshapes what actually executes), just expressed
as interventions rather than `POST /session` calls.

**Why the change:** leaning on the existing agent harness for spawning is simpler and is what we
actually want to build on; the earlier "flat sessions" choice existed only to dodge nested-path bugs
(#6573 / #21176). We now treat those as **L0 probes to pass, not paths to avoid** (see Risks + L0).

### Observability: **Raindrop Workshop, local-only**

- Local **daemon on `:5899`**, **UI on `:5900`**; single SQLite at `~/.raindrop/raindrop_workshop.db`.
- **Trace path is already wired** (see `opencode-raindrop-tracing/`): the official
  **`@raindrop-ai/opencode-plugin`** (enabled in `~/.config/opencode/opencode.json`) subscribes to
  OpenCode's session/message/tool/task hooks and POSTs each as a span to the Workshop daemon — no
  fork. **Gotcha:** as of plugin **v0.0.12** the `raindrop.json` `localWorkshopUrl` is ignored; the
  real switch is the env var `RAINDROP_LOCAL_DEBUGGER="http://localhost:5899/v1/"` (set by
  `setup.sh`). (Opencode can also emit OTLP natively, but the plugin is the implemented path.)
- **Two plugins, two jobs (don't conflate them):** the **Raindrop plugin = sensor** (emits spans);
  the new **observer gate plugin = actuator** for the hard-veto leg (synchronous `tool.execute.before`
  interception). The gate holds *zero* detection logic — it's a remote-controlled gate that asks the
  external observer "allow/deny?" and **fails open**. Full spec (all three levers):
  [`STEERING_ACTUATOR.md`](STEERING_ACTUATOR.md).
- Provides the **MCP server** (coding agent reads failing trajectories + patches code = the
  self-healing build loop), the **replay harness** (`/setup-agent-replay`), and the human timeline.
- **Cloud Raindrop (Signals / Deep Search) is OUT for the MVP** — local-only avoids the ~1hr
  classifier-training wait and any external dependency. Nudges are represented as spans on the
  local timeline (the local-mode equivalent of a "signal").

### Everything runs locally

Research is I/O-bound (web + LLM calls), so local `async` concurrency captures most of the
wall-clock parallelism a remote swarm would — **without** the remote→local trace-transport
problem. This is a deliberate simplification (see Modal under Stretch).

---

## Build layering (dependency order)

- **L0 — De-risk the hook FIRST (the gate).** Before building anything clever, run the Opencode
  spike below. Nothing proceeds until it round-trips.
- **L1 — MVP core (the complete winning story).** Coverage map from goal decomposition + observer
  heuristics for the 4 patterns + the 4 nudges + nudges-written-back-as-spans + the **observer
  OFF-vs-ON A/B demo** on one hard question. → *Agent Architectures & Control Loops track + the
  Raindrop Workshop prize.*
- **L2 — Fan-out swarm (core).** Multiple worker subagents under one swarm root; observer becomes a
  **dynamic scheduler** — not by spawning (the harness does that) but by **steering**: kill dead
  branches (abandon), reallocate attention to the least-covered open item (refocus), dedupe redundant
  branches (veto). *(Optional stretch within L2: a `ModalDispatcher` swap that runs the same workers on
  Modal sandboxes — unlocks the "$20k megastructure" narrative. Pluggable behind a dispatch
  interface so the observer code never changes; only attempt if L1 is solid and time remains.)*
- **L3 — Replay steering (the wow).** Before committing a high-stakes nudge (kill / major
  refocus), use Workshop's **replay** to run the trace forward *with* the candidate intervention,
  compare the resulting coverage delta vs. the no-intervention baseline, and commit only if it
  improves. Gated to high-stakes calls so replay cost stays bounded.
  → **Detailed design:** [`REPLAY_STEERING_AND_EVAL.md`](REPLAY_STEERING_AND_EVAL.md) — the replay
  **preflight** (async, high-stakes only; *not* the synchronous gate plugin) + a per-intervention
  **value eval** (recorded vs. replayed no-nudge counterfactual) for the demo scoreboard.

### ⚠️ L0 spike — run this before writing feature code (~45 min)

The **trace half is already done** by `opencode-raindrop-tracing/setup.sh` (plugin + Workshop).
What's left to prove is the **control half** — re-prioritized now that we've committed to the native
subagent tree + a gate plugin for hard veto:

```
1. raindrop workshop      # UI :5900; run setup.sh once if RAINDROP_LOCAL_DEBUGGER isn't set
2. opencode serve         # P-LOAD (top-priority gate): CONFIRM BOTH plugins load under server mode (not just
                          #   the TUI) — the Raindrop sensor AND the observer gate. Gate not loading
                          #   here = the entire hard-veto leg is dead.
3. Planner fans out via the native subagent harness; confirm each subagent shows up as its own child
   (GET /session/:id/children) AND its own interaction on the :5900 timeline.
4. REACH (#6573): POST /session/:childId/message into a RUNNING Task-spawned child from outside;
   confirm it lands + the worker acts on it next turn. If not → nudges route via the orchestrator.
5. VETO: point the gate at a stub observer that always denies; confirm a gated tool call (websearch)
   is blocked by the thrown error AND the reason text surfaces to the worker.
6. ABANDON: stall a searcher; confirm POST /session/:id/abort + orchestration-level abandonment
   (stop consuming + reassign) unblocks the synthesizer. Cooperative abort is good enough.
```

If those hold → go all-in. If the gate doesn't load under `opencode serve`, or veto-by-throw doesn't
surface to the worker → we fall back to soft nudges only, and we know in 45 min, not at 4pm.

---

## Known risks & how we design around them

**Opencode's abort path is weakest exactly at our hardest pattern (killing a stuck worker).**
Evidence from their issue tracker:
- [#21176](https://github.com/anomalyco/opencode/issues/21176) — no reliable force-kill of a stuck
  subagent; `session.abort()` is **cooperative-only**.
- [#6573](https://github.com/anomalyco/opencode/issues/6573) — sessions hang indefinitely when the
  Task tool spawns subagents via REST.
- [#20095](https://github.com/anomalyco/opencode/issues/20095) — cancel races (lost cancels, stale
  aborts, dangling waits).

**How the design handles them (note: we now ride the native path deliberately, so we _verify_ these
rather than dodge them):**
1. **#6573 (REST reach into Task-spawned children) → L0 probe #4, with a fallback.** Direct
   `POST /session/:childId/message` into a running native child is the surgical path for 3 of the 4
   nudges; if the probe shows it hangs, nudges route **through the orchestrator** (it re-instructs
   the child on the child's next turn) — slower, but fully harness-native. Either way the nudge lands.
2. **#21176 (no force-kill) → treat "stall → abandon" as an orchestration decision, not an OS kill.**
   The nudge takes effect the moment the observer stops consuming the staller's output and reassigns;
   `abort` is then best-effort compute reclamation, not correctness-critical. Cooperative abort is
   *good enough* for the demo. (Unchanged by the flat→native switch.)
3. **New lever the flat design lacked: synchronous veto.** The gate plugin can block a duplicate /
   off-task call *before* it runs — but it depends on the plugin loading under `opencode serve`
   (L0 spike step 2) and **fails open** if the observer is slow/unreachable, so a gate failure degrades to
   "no veto," never to a stuck worker.

---

## Open decisions (resolve during L0)

- **Observer language**: TypeScript (`@opencode-ai/sdk`, native `event.subscribe`) vs. Python
  (raw REST + Raindrop's Python SDK for the coverage-map / embedding logic). *(The **gate plugin** is
  necessarily TS/JS — it loads in the Opencode runtime — but it's dumb and language-independent of
  the observer, which it reaches over plain HTTP.)*
- ~~**Spawn mechanism**: custom `spawn_searcher` tool vs. orchestrator loop~~ → **resolved: native
  subagent harness** (2026-05-30).
- **Nudge routing**: direct-into-child vs. through-the-orchestrator — *resolved by L0 probe #4* (use
  direct if the #6573 reach probe passes, else route through the orchestrator).
- **Modal dispatcher**: in or out for L2 (default: optional, only if L1 solid).

---

## The demo

Same hard research question, same seed, **observer OFF then ON, side by side.**
- **OFF:** loops, drifts, concludes shallow — a messy trace and a half-empty coverage map.
- **ON:** nudges fire on the timeline in real time, the coverage checklist fills, convergence in
  fewer steps.
- **Scoreboard on screen (OFF vs ON):** steps-to-goal, coverage %, source diversity,
  unsupported-claim rate, cost per run.

A measured before/after beats any architecture slide.

---

## Prize alignment

| Prize | How we earn it |
|---|---|
| **Raindrop Workshop (~$5k, "coolest use case")** | Workshop is load-bearing: the sensor, the replay engine (L3), the self-audit log, and the MCP read-side for the self-healing build loop — not a dashboard pointed at it afterward. |
| **Modal (~$20k)** | Observer as a dynamic scheduler over a fan-out; the `ModalDispatcher` swap (L2 stretch) makes it literal — "same observer, now scheduling a fleet on Modal." |
| **OpenAI credits** | Workers can run OpenAI models via Opencode. |
| **Antler** | Thesis: "the reliability & steering layer for long-horizon autonomous research" — a company, not a feature. |

**Tracks:** Agent Architectures & Control Loops (primary), Retrieval & Knowledge Synthesis,
Applied Autonomous Research. **Domain chosen:** general web research.

---

## Reference: key facts & endpoints

**Raindrop Workshop** — daemon `:5899`, UI `:5900`; SQLite `~/.raindrop/raindrop_workshop.db`;
ingest `http://localhost:5899/v1/` (install `curl -fsSL https://raindrop.sh/install | bash`, run
`raindrop workshop`); tracing on when `RAINDROP_LOCAL_DEBUGGER="http://localhost:5899/v1/"` is set;
OpenCode→Workshop via **`@raindrop-ai/opencode-plugin`** (loaded from `opencode.json`). MCP server
exposes traces to a coding agent; replay scaffolded via `/setup-agent-replay`. Span schema:
`input, output, model, convo_id, properties{}, duration_ms, error, attachments` (attachment types
`code|text|image|iframe`, 1 MB/event cap). Open-source (MIT); local slice of the Raindrop cloud
product. Python SDK: `raindrop.analytics` — `init(write_key, tracing_enabled=True)`,
`interaction`/`tool_span`/`task_span`, `resume_interaction(event_id)`, `bypass_otel_for_tools`.

**Opencode** — `opencode serve` → HTTP server, OpenAPI 3.1 at `/doc`. Endpoints: `POST /session`,
`GET /session`, `GET /session/:id`, `POST /session/:id/message` (send+wait),
`POST /session/:id/prompt_async`, `POST /session/:id/abort`, `DELETE /session/:id`, `GET /event`
(SSE), `GET /global/event`. SDK `@opencode-ai/sdk` (TS): `session.create`, `session.prompt`
(`{noReply:true}` to inject context w/o a reply; supports JSON-schema structured output),
`session.abort`, `session.revert/unrevert`, `event.subscribe`. Native OTLP/HTTP tracing (LLM
requests, tool execution, session lifecycle, message processing). Plugin system (JS/TS),
`import type { Plugin } from "@opencode-ai/plugin"`; hooks `tool.execute.before/after` (**a `before`
hook that throws blocks the tool — confirmed; this is our veto mechanism**), `message.updated`,
`session.created/updated`, `experimental.session.compacting`; plugin context
`{ project, client, $, directory, worktree }`. Docs:
[server](https://opencode.ai/docs/server/), [sdk](https://opencode.ai/docs/sdk/),
[agents](https://opencode.ai/docs/agents/), [plugins](https://opencode.ai/docs/plugins/).
