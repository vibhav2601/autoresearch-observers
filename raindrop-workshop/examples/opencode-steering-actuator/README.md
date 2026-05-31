# OpenCode Steering Actuator

Applies observer steering decisions to a running `opencode serve` instance.
This is the real control bridge for the observer: it receives a nudge/stop
decision, resolves the target Workshop run to an OpenCode session, calls the
OpenCode REST API, and writes the resulting steering event back to Workshop.

```bash
cd examples/opencode-steering-actuator
bun install
PORT=3032 \
  OPENCODE_BASE_URL=http://localhost:4096 \
  RAINDROP_WORKSHOP_URL=http://localhost:5899 \
  bun run dev
```

The default OpenCode base URL is `http://localhost:4096`. If your
`opencode serve` process prints a different URL, pass it with
`OPENCODE_BASE_URL`.

## API

Generic apply endpoint:

```bash
curl -sS -X POST http://localhost:3032/apply \
  -H 'Content-Type: application/json' \
  -d '{
    "observedRunId": "<WORKSHOP_RUN_ID>",
    "observerRunId": "<OBSERVER_RUN_ID>",
    "action": "nudge",
    "message": "Refocus on the assigned subquestion.",
    "afterPrompt": "Observer nudge: refocus on the assigned subquestion and report only evidence relevant to it.",
    "reason": "The worker drifted from its assigned task.",
    "confidence": 0.82
  }'
```

Convenience endpoints:

- `POST /nudge`
- `POST /system_prompt_update`
- `POST /stop`
- `POST /restart`
- `POST /resolve`

Use `/resolve` to test target resolution without calling OpenCode or writing a
Workshop steering event:

```bash
curl -sS -X POST http://localhost:3032/resolve \
  -H 'Content-Type: application/json' \
  -d '{
    "observedRunId": "<WORKSHOP_RUN_ID>",
    "targetSubagentSpanId": "<RAINDROP_TASK_SPAN_ID>"
  }'
```

For `nudge` and `system_prompt_update`, the actuator calls:

```text
POST /session/:id/prompt_async
{ "noReply": true, "parts": [{ "type": "text", "text": "..." }] }
```

For `stop`, it calls:

```text
POST /session/:id/abort
```

For `restart`, it aborts the session and then posts the supplied prompt with
`noReply: false` so OpenCode starts a fresh turn in the same session.

## Target resolution

Pass `sessionId` when the observer already knows the OpenCode session. If it is
omitted, the actuator can resolve a subagent target from `targetSubagentSpanId`
or `targetSpanId`. When that value is a Raindrop `task` span id, the actuator
fetches the Workshop run detail, extracts the child `<task id="ses_...">` from
the span output, and targets that OpenCode child session. If no child session
can be extracted, it falls back to `run.convo_id`, which targets the parent
OpenCode session.

This means observers can send either:

- `sessionId: "ses_..."` to target a known OpenCode parent or child session.
- `targetSubagentSpanId: "<RAINDROP_TASK_SPAN_ID>"` or
  `targetSpanId: "<RAINDROP_TASK_SPAN_ID>"` to target the subagent that produced
  that task span.

The actuator always writes a Workshop steering event with status:

- `applied` when OpenCode accepted the control call,
- `failed` when OpenCode rejected it or no session could be resolved.

## Running OpenCode for live injection

Start a controllable OpenCode server:

```bash
opencode serve --port 4096 --hostname 127.0.0.1
```

Then run workers through that server, for example:

```bash
opencode run \
  --attach http://localhost:4096 \
  --model openai/gpt-4o-mini \
  --dangerously-skip-permissions \
  "Run the workflow..."
```

The installed OpenCode 1.15.12 server accepts:

- `POST /session/:id/prompt_async` with `204 No Content`
- `POST /session/:id/abort` with JSON `true`

`prompt_async` with `noReply: true` records the observer nudge as a user text
part in the target session. If the target is a live child session, the nudge is
available to that subagent's next turn. If the target child session has already
completed, the message is still recorded on that child session; in that case a
parent-session nudge or a restart/follow-up task is usually the useful action.
