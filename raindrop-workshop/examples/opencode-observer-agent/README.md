# OpenCode Observer Agent

Runs a second local OpenCode process as an LLM-as-judge observer. The observer
reads the Workshop SQLite database, judges active OpenCode runs, emits its own
Raindrop/OpenCode trace, and posts corrective steering events back to Workshop
so the Observer tab shows nudges.

```bash
cd examples/opencode-observer-agent
bun install
bun run dev
```

By default the service watches Workshop at `http://localhost:5899`, polls for
`opencode_session` runs, and launches observer passes when it sees new agent
activity, subagent handoffs, tool activity, errors, or a final run transition.

```bash
curl -sS http://localhost:3031/health
```

You can still manually trigger a pass against a run:

```bash
curl -sS http://localhost:3031/observe \
  -H 'Content-Type: application/json' \
  -d '{"runId":"<WORKSHOP_RUN_ID>"}'
```

The observer prompt gives OpenCode explicit SQLite instructions for:

- finding recent runs,
- reading spans for the target run,
- identifying `task` subagent spans,
- detecting repeated empty searches and failed reads,
- calling the steering actuator at `OPENCODE_CONTROL_URL` for corrective
  `nudge`, `system_prompt_update`, `stop`, or `restart` decisions.

Observer traces are linked to the run they inspect but are hidden from the main
Runs list. In Workshop:

- **Observer** shows only corrective actions.
- **Observer Debug** shows compact observer inputs, outputs, and tool calls for
  quiet and corrective passes.

Run the actuator on `localhost:3032` to apply real steering to an
`opencode serve` process:

```bash
cd ../opencode-steering-actuator
bun install
PORT=3032 OPENCODE_BASE_URL=http://localhost:4096 bun run dev
```

When the actuator returns `ok=true`, it writes an `applied` steering event back
to Workshop. If the actuator is unavailable, the observer falls back to a
mock/failed Workshop event so the UI still shows the attempted decision.
