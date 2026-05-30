# autoresearch-observers — Project Overview

> **Hand-off doc for a fresh agent session.** Read this top-to-bottom and you have the full
> context: what we're building, why, the locked architectural decisions, what's still open,
> and where to start. Status as of **2026-05-30**: design phase, with the **L0 trace path already
> scaffolded** — see [`opencode-raindrop-tracing/`](./opencode-raindrop-tracing/) (merged PR #1):
> one-command `setup.sh` that streams OpenCode sessions into a local Workshop via the official
> Raindrop plugin. No observer/worker control code yet.

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
| **Actuator** | Nudges injected into / abort signals sent to workers |
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

| Capability | Endpoint / SDK method |
|---|---|
| Spawn a worker | `POST /session` + `POST /session/:id/prompt_async` |
| **Inject a nudge** (no reply triggered) | `session.prompt({ noReply: true })` |
| **Kill** a worker | `POST /session/:id/abort` |
| Stream the sensor feed | `GET /event` (SSE) |
| List / inspect / delete | `GET /session`, `GET /session/:id`, `DELETE /session/:id` |

So all four nudges have a concrete home, and the observer can be an **external process** driving
workers over REST + SSE. The TS-only `@opencode-ai/sdk` is not a lock-in (raw REST works from any
language).

### Fan-out model: **flat top-level sessions, externally orchestrated**

**Do NOT use Opencode's internal subagent / Task-tool tree for the fan-out.** Each worker is a
**flat, top-level session** the external orchestrator spawns and controls. The LLM planner still
decides the fan-out (decompose the question → subquestions + count + assignments via structured
output); a custom `spawn_searcher(subquestion)` tool (or the orchestrator loop) turns that plan
into `POST /session` calls. **Scheduling authority lives in the observer, deterministically — not
inside an LLM orchestrator.**

Why flat sessions: it sidesteps documented Opencode bugs in the nested-subagent path (see Risks).

### Observability: **Raindrop Workshop, local-only**

- Local **daemon on `:5899`**, **UI on `:5900`**; single SQLite at `~/.raindrop/raindrop_workshop.db`.
- **Trace path is already wired** (see `opencode-raindrop-tracing/`): the official
  **`@raindrop-ai/opencode-plugin`** (enabled in `~/.config/opencode/opencode.json`) subscribes to
  OpenCode's session/message/tool/task hooks and POSTs each as a span to the Workshop daemon — no
  fork. **Gotcha:** as of plugin **v0.0.12** the `raindrop.json` `localWorkshopUrl` is ignored; the
  real switch is the env var `RAINDROP_LOCAL_DEBUGGER="http://localhost:5899/v1/"` (set by
  `setup.sh`). (Opencode can also emit OTLP natively, but the plugin is the implemented path.)
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
- **L2 — Fan-out swarm (core).** Multiple flat worker sessions; observer becomes a **dynamic
  scheduler**: kill dead branches, reallocate to the least-covered open item, dedupe redundant
  branches. *(Optional stretch within L2: a `ModalDispatcher` swap that runs the same workers on
  Modal sandboxes — unlocks the "$20k megastructure" narrative. Pluggable behind a dispatch
  interface so the observer code never changes; only attempt if L1 is solid and time remains.)*
- **L3 — Replay steering (the wow).** Before committing a high-stakes nudge (kill / major
  refocus), use Workshop's **replay** to run the trace forward *with* the candidate intervention,
  compare the resulting coverage delta vs. the no-intervention baseline, and commit only if it
  improves. Gated to high-stakes calls so replay cost stays bounded.

### ⚠️ L0 spike — run this before writing feature code (~45 min)

The **trace half is already done** by `opencode-raindrop-tracing/setup.sh` (plugin + Workshop).
What's left to prove is the **server/control half**:

```
1. raindrop workshop          # UI :5900; run setup.sh once if RAINDROP_LOCAL_DEBUGGER isn't set
2. opencode serve             # CONFIRM the Raindrop plugin also loads under server mode (not just
                              #   the TUI) — i.e. REST-driven sessions still emit spans to Workshop
3. Spawn 2 flat sessions via POST /session, each assigned a subquestion;
   confirm each appears as its own interaction on the :5900 timeline
4. Deliberately stall one searcher
5. Confirm: POST /session/:id/abort + orchestration-level abandonment unblocks the other worker
```

If that holds → go all-in on Opencode. If flat-session abort is also broken, or the plugin
doesn't load under `opencode serve` → we know in 45 minutes instead of at 4pm.

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

**Mitigations baked into the design:**
1. **Flat sessions, not nested subagents** — dodges #6573 / #21176, which are about the nested path.
2. **Treat "stall → abandon" as an orchestration decision, not an OS kill** — the nudge takes
   effect the moment the observer stops consuming the staller's output and spawns a replacement.
   `abort` is then best-effort compute reclamation, not correctness-critical. So cooperative abort
   is *good enough* for the demo.

---

## Open decisions (resolve during L0)

- **Observer language**: TypeScript (`@opencode-ai/sdk`, native `event.subscribe`) vs. Python
  (raw REST + Raindrop's Python SDK for the coverage-map / embedding logic).
- **Spawn mechanism**: LLM-invoked custom `spawn_searcher` tool vs. orchestrator loop issuing
  `POST /session` directly.
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
requests, tool execution, session lifecycle, message processing). Plugin system (JS/TS) hooks:
`tool.execute.before/after`, `message.updated`, `session.*`. Docs:
[server](https://opencode.ai/docs/server/), [sdk](https://opencode.ai/docs/sdk/),
[agents](https://opencode.ai/docs/agents/), [plugins](https://opencode.ai/docs/plugins/).
