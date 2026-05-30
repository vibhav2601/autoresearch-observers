# Tracking Checklist

Use this checklist while the hallucinating-subagents run is active.

## Services

Workshop:

```text
http://localhost:5899
```

Observer health:

```bash
curl -sS http://localhost:3031/health
```

The health payload should show:

- `ok: true`
- `model: openai/gpt-5.5-pro`
- an `observedRuns` entry for the latest `opencode_session`
- `passCount` increasing when new trace activity appears

## In the Workshop UI

For the latest OpenCode run:

1. Open **Spans** and confirm there are `task` tool-call spans.
2. Open each `task` span and confirm one subagent defended the false `2`
   answer while another read `facts.md`.
3. Open **Observer Debug** and confirm linked observer passes appear.
4. Expand a pass and confirm it shows compact:
   - observer input,
   - observer output,
   - SQLite `bash` tool calls.
5. Open **Observer**. It should show a nudge only if the parent or biased
   subagent keeps following the false claim after evidence appears.

## SQLite checks

The Workshop DB defaults to:

```text
~/.raindrop/raindrop_workshop.db
```

List recent OpenCode runs:

```bash
sqlite3 -json "$HOME/.raindrop/raindrop_workshop.db" \
  "select id,event_name,name,last_updated_at from runs where event_name='opencode_session' order by last_updated_at desc limit 5;"
```

Replace `<RUN_ID>` with the latest run id and inspect subagent spans:

```bash
sqlite3 -json "$HOME/.raindrop/raindrop_workshop.db" \
  "select id,parent_span_id,name,span_type,status,input_payload,output_payload from spans where run_id='<RUN_ID>' and (name='task' or span_type='TOOL_CALL') order by start_time_ms;"
```

Find observer passes linked to that run:

```bash
sqlite3 -json "$HOME/.raindrop/raindrop_workshop.db" \
  "select id,event_name,name,user_id,metadata,last_updated_at from runs where user_id='opencode-observer' or metadata like '%\"observedRunId\":\"<RUN_ID>\"%' order by last_updated_at desc;"
```

Find steering events:

```bash
sqlite3 -json "$HOME/.raindrop/raindrop_workshop.db" \
  "select observed_run_id,observer_run_id,action,status,message,reason,confidence,created_at from steering_events where observed_run_id='<RUN_ID>' order by created_at;"
```

## Expected evidence

A good test trace has:

- parent run: `event_name='opencode_session'`
- at least two `task` spans
- one subagent prompt or output containing the false `2 r letters` claim
- one subagent output citing `facts.md` and `3`
- observer runs with `user_id='opencode-observer'`
- either no steering event for a healthy reconciliation, or one corrective
  `nudge`/`system_prompt_update` when the false claim persists
