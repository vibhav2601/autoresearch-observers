# Observer Nudger Architecture

This design turns the current mocked observer writeback into a real control
plane that can inject steering prompts into live OpenCode subagents.

The target worker shape is a dynamic workflow: OpenCode is prompted to plan,
decompose, fan out work across subagents, run independent verification and
refutation passes, and converge on a coordinated answer. The observer/nudger is
not the primary orchestrator of that work. It is an external supervisory control
plane that watches this dynamic workflow through Raindrop traces and injects
steering prompts only when the workflow drifts, loops, contradicts evidence, or
fails to converge.

## Current Flow

1. A worker OpenCode run emits Raindrop spans into Workshop.
2. Workshop stores runs, spans, live events, and steering events in
   `~/.raindrop/raindrop_workshop.db`.
3. `raindrop-workshop/examples/opencode-observer-agent/server.ts` polls
   `/api/runs`, watches `opencode_session` runs, and starts an observer
   OpenCode process for active or final passes.
4. The observer reads SQLite with `sqlite3`, detects drift, and posts corrective
   events to `POST /api/steering/events`.
5. Workshop hides observer runs from the main run list, links them through
   `GET /api/runs/:id/steering`, and renders them in Observer / Observer Debug.

The mocked part is step 4. `steering_events` can show a nudge, but no process
currently injects that nudge into a live target subagent.

## Real Nudger Components

### Prompted OpenCode Dynamic Workflow

The parent OpenCode run should be prompted to behave like a dynamic workflow:

- create a compact plan,
- launch multiple `task` subagents in parallel,
- assign independent evidence-gathering, implementation, verifier, and refuter
  roles,
- compare sibling outputs before folding them into the parent answer,
- iterate when verifiers or refuters find a contradiction,
- persist progress through traceable tool calls and outputs,
- pause or incorporate injected observer prompts when they arrive.

The nudger is built for this mode. It should target a specific active
`task` span or the parent coordination span with a prompt injection such as:

```text
Observer nudge: the verifier found local evidence contradicting the current
claim. Stop expanding the unsupported path, read the verifier result, and run a
short reconciliation pass before continuing.
```

The worker prompt should make this contract explicit: subagents may receive
external observer nudges, and the parent coordinator must treat those nudges as
high-priority steering context while preserving the original user goal.

### Observer Judge

Location: `raindrop-workshop/examples/opencode-observer-agent/server.ts`.

The observer remains the LLM-as-judge. It should decide whether a run needs
correction and produce:

- `observedRunId`: parent OpenCode run ID.
- `observerRunId`: observer pass run ID.
- `targetSubagentSpanId`: task span to steer when available.
- `action`: usually `nudge`; sometimes `system_prompt_update`, `stop`, or
  `restart`.
- `message`: compact UI summary.
- `afterPrompt`: exact prompt text to inject into the target subagent.
- `reason`: evidence-backed explanation for the UI.
- `confidence`: normalized confidence.

For `action=nudge`, `afterPrompt` is the actuator payload. It is not just UI
copy.

The observer should avoid replacing the workflow plan. It should steer the
existing dynamic workflow back toward the original objective. Good nudges are
small injected prompts that change the next local decision of one subagent or
the parent coordinator.

### Workshop Steering Ledger

Locations:

- `raindrop-workshop/src/steering.ts`
- `raindrop-workshop/src/server.ts`
- `raindrop-workshop/app/src/api/steering.ts`
- `raindrop-workshop/app/src/components/RunDetail.tsx`

Workshop is the durable ledger and UI layer. It records every steering decision
and broadcasts it over the existing `steering` event channel. It should not own
OpenCode process internals.

### OpenCode Control Service

Default URL: `OPENCODE_CONTROL_URL=http://localhost:3032`.

This service owns live-session control. It maps Raindrop run/span identifiers to
OpenCode sessions and injects prompts into the correct active target.

It can be implemented as a local sidecar that:

- subscribes to OpenCode session lifecycle events,
- records `runId -> sessionId` and `taskSpanId -> subagentSessionId`,
- exposes HTTP endpoints for observer-driven steering,
- appends an injected message into the live parent or subagent conversation,
- reports whether the injection was accepted.

## Control API

### `POST /nudge`

Request:

```json
{
  "observedRunId": "3af4785d3c5d2f565762dc9164800e25",
  "targetSubagentSpanId": "0310f2763a7b9f78",
  "targetSpanId": null,
  "action": "nudge",
  "message": "Verify the evidence paths; multiple glob errors indicate reliance on nonexistent files.",
  "injectedPrompt": "Observer nudge: stop defending the 2-r claim from missing files. Read the Grounding Checker result and reconcile against facts.md, which cites strawberry as 3.",
  "reason": "The Bad Evidence Hunter is relying on nonexistent files while sibling evidence cites facts.md.",
  "observerRunId": "a23c1b48c98b9fb6ed3ac31b7bd43de4",
  "confidence": 0.85
}
```

Response:

```json
{
  "ok": true,
  "applied": true,
  "deliveryId": "ctrl_123",
  "target": {
    "observedRunId": "3af4785d3c5d2f565762dc9164800e25",
    "targetSubagentSpanId": "0310f2763a7b9f78",
    "sessionId": "ses_..."
  },
  "deliveredAt": 1780173762226
}
```

If the target cannot be found:

```json
{
  "ok": false,
  "applied": false,
  "error": "target_subagent_not_active"
}
```

### `GET /targets/:observedRunId`

Returns known live targets for debugging and UI assurance:

```json
{
  "observedRunId": "3af4785d3c5d2f565762dc9164800e25",
  "parentSessionId": "ses_parent",
  "targets": [
    {
      "taskSpanId": "0310f2763a7b9f78",
      "description": "Bad evidence hunter",
      "state": "running",
      "subagentSessionId": "ses_child"
    }
  ]
}
```

## Status Rules

- `applied`: control service accepted and injected the prompt.
- `mock_applied`: Workshop recorded the event, but no real injection happened.
- `failed`: observer attempted real control and the actuator rejected or failed.
- `proposed`: observer generated a candidate decision but did not attempt
  delivery.
- `acknowledged` / `dismissed`: future human or agent review states.

The observer must never post `applied` unless `/nudge` returns success.

## E2E Sequence

1. Worker OpenCode starts an `opencode_session` with a dynamic-workflow prompt.
2. Worker plans, launches `task` subagents, and assigns verifier/refuter roles.
3. Observer detects a handoff or active-run heartbeat and starts an observer
   pass.
4. Observer queries SQLite and finds the target task span.
5. Observer builds an injected prompt in `afterPrompt` that preserves the
   original workflow goal and corrects the local drift.
6. Observer calls `POST ${OPENCODE_CONTROL_URL}/nudge`.
7. If the actuator succeeds, observer posts `status=applied` to Workshop.
8. If the actuator is absent or rejects, observer posts `status=mock_applied`
   or `failed`.
9. Workshop broadcasts and renders the steering event under Observer.
10. Observer Debug shows the observer pass input, output, and SQLite/curl tool
    calls linked to the observed run.

For the hallucinating-subagents test, the dynamic-workflow shape is:

- parent coordinator asks for an answer to the `strawberry` count question,
- one evidence-hunter subagent intentionally follows a false premise,
- one grounding verifier reads `facts.md`,
- optionally one refuter compares both answers,
- parent folds the verified answer back into the final response,
- observer nudges the false-premise subagent if it keeps expanding unsupported
  evidence paths or ignores the verifier.

## UI Behavior

Observer tab:

- show only corrective actions,
- group actions by target subagent,
- show action, status, confidence, message, reason, and injected prompt,
- hide quiet observer passes except for a count.

Observer Debug tab:

- show all linked observer passes,
- mark each pass as `action` or `quiet`,
- show compact observer inputs, outputs, and tools called,
- avoid dumping raw JSON unless expanded.

## Minimal Implementation Plan

1. Add a small OpenCode control sidecar on port `3032`.
2. Track live OpenCode session IDs and map them to Raindrop run/span IDs.
3. Implement `POST /nudge` and `GET /targets/:observedRunId`.
4. Update the observer to call `/nudge` before writing Workshop events.
5. Use `afterPrompt` as the exact injection text and render it as
   "Injected prompt" for nudge events.
6. Add E2E tests that start Workshop, observer, mock/real control sidecar, and
   the hallucinating-subagents scenario.

## Open Questions

- Which OpenCode API or plugin hook should append a message to a currently
  running subagent conversation?
- Can an active `task` subagent receive a prompt mid-run, or does injection
  need to target the parent and affect the next handoff?
- Should failed injections be retried automatically, or should they remain
  visible as `failed` until the observer sees new trace evidence?
