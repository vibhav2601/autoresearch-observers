# Project Overview

`autoresearch-observers` is a local control loop for multi-agent research. It
uses Raindrop Workshop traces as the sensor, an observer agent as the
controller, and OpenCode control APIs/plugins as the actuator.

The project started as a hackathon prototype, but the repo is organized as an
engineer-facing system: each component is runnable, each control surface has a
README or design contract, and the scenario fixtures provide repeatable ways to
exercise the loop.

## System Model

```text
OpenCode parent agent
  -> native task subagents
  -> Raindrop OpenCode plugin emits spans
  -> local Raindrop Workshop stores and renders traces
  -> observer agent reads Workshop traces
  -> steering actuator applies corrective actions through OpenCode
  -> Workshop records the observer decision on the same run
```

| Control-loop role | Implementation |
| --- | --- |
| Plant | OpenCode parent session and child `task` subagents |
| Sensor | Raindrop Workshop spans from the OpenCode plugin |
| Controller | `raindrop-workshop/examples/opencode-observer-agent/` |
| Actuator | `raindrop-workshop/examples/opencode-steering-actuator/` plus `opencode-observer-gate/` |
| Setpoint | The original research goal and scenario-specific evidence/coverage expectations |
| Audit log | Workshop run timeline, Observer tab, Observer Debug tab, and `steering_events` records |

## What Is Implemented

- **Trace ingestion:** OpenCode sessions stream into local Workshop through
  `@raindrop-ai/opencode-plugin` and `RAINDROP_LOCAL_DEBUGGER`.
- **Workshop UI changes:** observer runs are hidden from the main Runs list;
  worker runs expose **Observer** and **Observer Debug** tabs.
- **Steering event API/storage:** observer decisions can be written back to
  Workshop and tied to the run they inspected.
- **Observer service:** a local OpenCode-powered observer reads Workshop
  SQLite state, inspects active OpenCode runs, and emits corrective decisions.
- **Steering actuator:** a local service resolves Workshop runs/spans to
  OpenCode sessions and applies `nudge`, `system_prompt_update`, `stop`, and
  `restart` actions.
- **Hard-veto plugin:** an OpenCode plugin can synchronously gate selected tool
  calls by asking an observer endpoint whether to allow or deny them.
- **Scenarios and benchmark:** demo fixtures exercise hallucination pressure,
  subagent disagreement, drift, and observer OFF vs. ON measurement.

## Observer Failure Patterns

The observer is intentionally scoped. It should not become a general-purpose
manager for every agent decision. The useful surface is a small set of
coordination failures that can be detected from traces and mapped to concrete
actions.

| Pattern | Trace signal | Typical intervention |
| --- | --- | --- |
| Duplicate work | Multiple workers chase the same query, source, or subclaim | Nudge or veto the redundant branch |
| Contradiction | Subagents assert incompatible facts about the same target | Ask the worker to re-verify against evidence |
| Stall | A worker loops, repeatedly fails reads/searches, or blocks progress | Stop, restart, or tell the parent to abandon that branch |
| Drift | Recent activity diverges from the assigned subquestion | Inject a refocus prompt into the parent or child session |

Every observer action should be auditable: reason, confidence, target, status,
and enough context for a human to understand the decision.

## Main Components

### Raindrop Workshop

Path: [`../raindrop-workshop/`](../raindrop-workshop/)

This vendored Workshop contains the project-specific UI and API changes:

- `steering_events` persistence and API routes,
- linked observer debug output,
- hidden observer runs in the main Runs list,
- Observer and Observer Debug tabs on worker runs,
- example observer and actuator services.

### Observer Agent

Path:
[`../raindrop-workshop/examples/opencode-observer-agent/`](../raindrop-workshop/examples/opencode-observer-agent/)

The observer is a second local OpenCode process. It polls Workshop, reads the
SQLite database for recent runs/spans, decides whether a run needs corrective
steering, and posts the result back to Workshop. When an actuator is available,
it also attempts to apply the action to a live OpenCode session.

### Steering Actuator

Path:
[`../raindrop-workshop/examples/opencode-steering-actuator/`](../raindrop-workshop/examples/opencode-steering-actuator/)

The actuator is the REST bridge from observer decisions to OpenCode. It can:

- resolve a Workshop run to an OpenCode session,
- resolve a Raindrop `task` span to a child OpenCode session,
- inject `prompt_async` nudges,
- abort a session,
- restart/follow up in the same session,
- write `applied` or `failed` steering events back to Workshop.

### Hard-Veto Gate Plugin

Path: [`../opencode-observer-gate/`](../opencode-observer-gate/)

The gate plugin handles the synchronous control case. On selected
`tool.execute.before` hooks, it can ask an observer endpoint whether the tool
call should proceed. It fails open when the observer is unavailable so the
plugin does not deadlock local work.

### Tracing Setup

Path:
[`../opencode-raindrop-tracing/`](../opencode-raindrop-tracing/)

This is the minimal OpenCode-to-Workshop tracing setup. It is useful when you
want tracing without the full observer/actuator stack.

### Scenarios

Path: [`../scenarios/`](../scenarios/)

The main scenario is
[`hallucinating-subagents`](../scenarios/hallucinating-subagents/): it creates
subagent disagreement and stale evidence so the observer has something
meaningful to detect. The benchmark harness in
[`bench`](../scenarios/bench/) records wall-clock, token, cost, and step counts
for OFF vs. ON comparisons.

## Running The Loop

Use [LOCAL_SETUP.md](LOCAL_SETUP.md) for the full command sequence. The services
you usually need are:

1. Workshop on `http://localhost:5899`.
2. Observer on `http://localhost:3031`.
3. `opencode serve` on `http://localhost:4096`.
4. Steering actuator on `http://localhost:3032`.
5. A worker run with `RAINDROP_LOCAL_DEBUGGER=http://localhost:5899/v1/`.

## Where To Start For Common Changes

| Change | Start here |
| --- | --- |
| UI display of observer decisions | `raindrop-workshop/app/` and the Workshop README |
| Observer prompt/detection behavior | `raindrop-workshop/examples/opencode-observer-agent/` |
| Applying nudges/stops/restarts | `raindrop-workshop/examples/opencode-steering-actuator/` and [STEERING_ACTUATOR.md](STEERING_ACTUATOR.md) |
| Synchronous veto behavior | `opencode-observer-gate/` |
| Demo prompt tuning | `scenarios/hallucinating-subagents/` |
| Measurement and A/B runs | `scenarios/bench/` |
| Trace-only OpenCode setup | `opencode-raindrop-tracing/` |

## Design Contracts

- [STEERING_ACTUATOR.md](STEERING_ACTUATOR.md) is the source of truth for how
  observer decisions become real worker effects.
- [OBSERVER_HARNESS.md](OBSERVER_HARNESS.md) describes how observer context
  should stay bounded as traces grow.
- [REPLAY_STEERING_AND_EVAL.md](REPLAY_STEERING_AND_EVAL.md) captures the
  replay/evaluation direction for future high-stakes interventions.
- [VALUE_PROP.md](VALUE_PROP.md) explains the problem framing and market/user
  motivation behind the project.
