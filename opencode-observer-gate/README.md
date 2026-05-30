# opencode-observer-gate

OpenCode plugin for the steering actuator's synchronous hard-veto leg. It is a
remote-controlled gate: on a gated `tool.execute.before` hook it asks the
observer's `/veto` endpoint whether the call should proceed. It fails open on
timeouts, bad responses, missing observer URLs, and network errors.

This package implements the in-process plugin surface from
`../docs/STEERING_ACTUATOR.md`:

- observer round-trip for hard vetoes,
- env and `steer.json` config loading,
- local `denyTools` guardrails,
- per-session max tool-call guidance,
- standing system guidance.

## Load In OpenCode

Use a local file URL while developing:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@raindrop-ai/opencode-plugin",
    "file:///ABS/PATH/TO/autoresearch-observers/opencode-observer-gate"
  ]
}
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBSERVER_GATE_URL` | unset | Observer `/veto` endpoint. |
| `OBSERVER_GATE_TIMEOUT_MS` | `100` | Deadline for the observer call. |
| `OBSERVER_GATE_TOOLS` | `websearch,webfetch` | Tools that round-trip to the observer. |
| `OBSERVER_GATE_ENABLED` | true when URL or local config exists | Kill switch. |
| `OBSERVER_GATE_CONFIG` | `./steer.json` | Local guardrail config path. |
| `OBSERVER_GATE_DENY_TOOLS` | unset | CSV of local deny patterns, e.g. `bash:rm*`. |
| `OBSERVER_GATE_MAX_TOOL_CALLS` | unset | CSV of caps, e.g. `websearch=8`. |
| `OBSERVER_GATE_STANDING_SYSTEM` | unset | CSV of standing guidance strings. |

## `steer.json`

Prefer `steer.json` for local integration tests or OpenCode server launches
where custom environment variables may not be inherited by the server process.
Environment variables still override matching file settings.

```json
{
  "observer": {
    "url": "http://127.0.0.1:4555/veto",
    "timeoutMs": 100,
    "tools": ["websearch", "webfetch"]
  },
  "guardrails": {
    "denyTools": ["bash:rm*"],
    "maxToolCalls": { "websearch": 8 }
  },
  "guidance": {
    "standingSystem": [
      "Stay on your assigned subquestion. Report when coverage stalls."
    ]
  }
}
```

## Test

```bash
bun install
bun test
bun run typecheck
```
