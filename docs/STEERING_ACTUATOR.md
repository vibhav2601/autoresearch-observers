# Worker Steering — the Nudge Actuator (implementation spec)

> **Hand-off for the agent that builds the actuator.** Read
> [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md) first — this doc assumes its vocabulary
> (sensor / controller / actuator / plant) and its **locked decisions**. This is the spec for the
> **actuator**: how an observer decision ("emit nudge N") is physically applied to a running
> worker. Scope is the two actuator modes we committed to: **auto guardrail** + **injected
> guidance**. Status **2026-05-30**: implemented prototype for external injected guidance in
> `raindrop-workshop/examples/opencode-steering-actuator/`; plugin guardrails remain design work.

---

## ⚠️ Read this first — reconcile with the locked architecture

This work started under the framing *"add tools to nudge/steer a **subagent** in OpenCode."* The
preferred architecture in `PROJECT_OVERVIEW.md` is flat top-level worker sessions. The current
Raindrop/OpenCode test harness can also produce nested `task` child sessions, so the actuator
supports both forms:

- flat worker session: pass `sessionId: "ses_..."`;
- nested task span: pass `targetSubagentSpanId: "<RAINDROP_TASK_SPAN_ID>"`; the actuator extracts
  the child `<task id="ses_...">` from the task span output and targets that OpenCode session.

Concretely:

1. **Prefer no nested subagents.** Workers are **flat, top-level sessions** spawned by the external
   orchestrator (PROJECT_OVERVIEW → *Fan-out model*). Consequence: there is **nothing to
   "detect"** — a worker *is* a session, identified directly by its `sessionID`, which the
   orchestrator already holds. The OpenCode SDK's `Session.parentID` exists; in the nested
   compatibility path it links a `task` child session to the parent coordinator.

2. **The actuator is primarily EXTERNAL (REST/SSE), not in-process plugin hooks.** The observer is
   a separate process. Its committed control surface:

   | Actuator action | Mechanism |
   |---|---|
   | Inject a nudge (no reply triggered) | `session.prompt({ sessionID, parts:[{type:"text",text}], noReply:true })` (REST `POST /session/:id/prompt_async`) |
   | Hard stop a worker | `POST /session/:id/abort` (cooperative — see Risks in overview) |
   | Read the sensor feed | `GET /event` (SSE) + Raindrop Workshop spans |

So **in-process OpenCode plugin hooks are a *secondary* surface**, used only for guardrails that are
better enforced **synchronously and locally** (before a tool runs) and that do **not** need the
observer's cross-worker view. Everything requiring a global view (e.g. cross-worker dedupe) lives
in the external observer and actuates via prompt-nudge / abort.

---

## The two actuator modes, mapped onto the two surfaces

### Mode A — Injected guidance ("refocus on subquestion X", "your finding conflicts with…")
Steers a worker by adding text to its context.

- **Primary (external, observer-driven, trace-informed):** observer detects pattern (drift /
  contradiction / duplicate / stall) from traces → `session.prompt({ …, noReply:true })`. The
  injected text becomes context the worker reads on its **next turn** without forcing a reply.
  *(Verify the exact `noReply` landing semantics in L0 — see Open Questions.)*
- **At spawn:** the worker's standing instructions (its slice of the coverage map / assigned
  subquestion) are set when the orchestrator creates the session / sends the first prompt.
- **Optional in-process augmentation:** `experimental.chat.system.transform` can append *standing*
  guidance to **every** worker turn (e.g. "stay on subquestion X; you have N open coverage items")
  without an observer round-trip. Use only for invariant guidance, not reactive nudges.

### Mode B — Auto guardrail (block / cap / deny, deterministically)
Hard limits that should fire **synchronously** the instant a worker acts.

- **In-process plugin hooks (preferred for purely-local rules):**
  - `tool.execute.before` — inspect `{ tool, args }`; **throw to block** the call, or **mutate
    `output.args`** to redirect it (e.g. cap result counts, strip a disallowed path).
  - `permission.ask` — set `output.status = "deny"` for risky ops (e.g. shell `rm`, writes outside
    the worktree).
  - `tool.execute.after` — mutate `output.output` to **append a nudge** to what the worker reads
    back, and/or maintain per-`sessionID` counters to enforce caps ("you've run 8 searches with no
    new info — synthesize and report").
- **Observer-driven guardrails (need cross-worker state):** e.g. "Searcher 2 already issued this
  query" can't be decided from one worker's local hook — the observer detects it from the merged
  trace/SSE stream and actuates via prompt-nudge or abort.

**Rule of thumb:** *local + synchronous + single-worker → plugin hook. Cross-worker or
trace-derived → external observer.*

---

## Grounded API facts (verified 2026-05-30; pin the versions below)

Pins: `opencode 1.15.12`, `@opencode-ai/plugin 1.15.12`, `@opencode-ai/sdk 1.15.12`,
`@raindrop-ai/opencode-plugin 0.0.12`. Re-verify against installed `dist/*.d.ts` if versions move.

### In-process plugin surface — `@opencode-ai/plugin`

A plugin module exports a default `async (input: PluginInput) => Promise<Hooks>` and is loaded via
the `plugin` array in `opencode.json` (npm name **or** `file:///abs/path` — both supported; the
Raindrop plugin is loaded the same way, so ours loads **alongside** it, independently).

`Hooks` (exact, mutate via the second `output` arg; the relevant subset):

```ts
interface Hooks {
  tool?: { [name: string]: ToolDefinition }                 // register custom tools
  event?: (i: { event: Event }) => Promise<void>            // observe everything (SSE-equivalent in-proc)
  "chat.params"?:  (i:{sessionID,agent,model,provider,message}, o:{temperature,topP,topK,maxOutputTokens,options})=>Promise<void>
  "permission.ask"?: (i: Permission, o:{ status:"ask"|"deny"|"allow" })=>Promise<void>
  "tool.execute.before"?: (i:{tool:string,sessionID:string,callID:string}, o:{args:any})=>Promise<void>   // throw → block
  "tool.execute.after"?:  (i:{tool:string,sessionID:string,callID:string,args:any}, o:{title,output:string,metadata})=>Promise<void>
  "experimental.chat.system.transform"?: (i:{sessionID?:string,model}, o:{ system:string[] })=>Promise<void>
  "experimental.chat.messages.transform"?: (i:{}, o:{ messages:{info:Message,parts:Part[]}[] })=>Promise<void>
  "tool.definition"?: (i:{toolID:string}, o:{description,parameters})=>Promise<void>
}
```

Custom tool shape (`tool.d.ts`):

```ts
tool({ description, args: ZodRawShape, execute(args, ctx) })
// ctx (ToolContext): { sessionID, messageID, agent, directory, worktree, abort, metadata(), ask() }
```

**Scoping note:** `chat.*` hooks carry `agent`; `tool.execute.*` carry only `sessionID`/`callID`.
With **flat sessions the orchestrator already owns the `sessionID → worker/role` map**, so scoping
a guardrail to a specific worker is a map lookup — no in-band detection needed. Pass that map to
the plugin via its config (worker session IDs) or have the plugin read it from a shared file the
orchestrator writes.

**Caveats to verify, not assume:**
- `experimental.*` hooks are explicitly experimental — signatures may change.
- Whether **throwing in `tool.execute.before`** cleanly aborts *just that tool call* (surfacing an
  error to the model) vs. faults the turn/session is **unverified** — test before relying on it.
- **Does the plugin load under `opencode serve` (server mode)?** This is already the L0 gate. If
  the plugin does **not** load in server mode, the entire in-process guardrail surface is
  unavailable and Mode B must be done externally. **Resolve in L0 before committing to plugin
  hooks.**

### External control surface — `opencode serve` / `@opencode-ai/sdk` (from PROJECT_OVERVIEW)

`POST /session`, `POST /session/:id/prompt_async`, `session.prompt({ noReply:true })`,
`POST /session/:id/abort`, `GET /event` (SSE). Raw REST works from any language (observer-language
decision still open — see overview).

---

## Self-audit requirement (do not skip)

Per PROJECT_OVERVIEW, **every applied nudge/guardrail must be written back as its own span on the
worker's trace timeline** (the "saw looping → banned query → novelty recovered" audit trail + demo
overlay). Decide where the span is emitted:
- **Observer-side nudges** → observer POSTs a span to Raindrop ingest `http://localhost:5899/v1/`
  with the worker's `convo_id`/session correlation.
- **Plugin-side guardrails** → either emit a marker the Raindrop plugin already traces, or POST an
  explicit span. **Coordinate with the existing tracing path (`opencode-raindrop-tracing/`) so
  audit spans correlate to the same interaction** (match `convo_id` = the worker's session id).

---

## Recommended split (so the next agent doesn't re-litigate)

1. **Observer (external process)** — owns *decisions* + all *trace-derived / cross-worker* actuation
   (Mode A reactive nudges via `prompt({noReply:true})`, kills via `abort`). Rate-limiting +
   confidence-gating live here (overview: a thrashing controller is worse than none).
2. **Thin guardrail plugin** (loaded via `opencode.json` next to the Raindrop plugin) — owns
   *local, synchronous, single-worker* Mode B rules + optional standing Mode A guidance
   (`system.transform`). Config-driven, no cross-worker state.
3. **Config** — a `steer.json` (rules + guidance text), e.g.:
   ```jsonc
   {
     "guardrails": {
       "denyTools": ["bash:rm*"],          // permission.ask → deny
       "maxToolCalls": { "websearch": 8 }, // tool.execute.after counter → block/nudge
       "blockArgs": [{ "tool": "websearch", "ifMatchesRecentQuery": true }]
     },
     "guidance": { "standingSystem": ["Stay on your assigned subquestion. Report when coverage stalls."] }
   }
   ```
   (Schema is a sketch — finalize with the observer's pattern definitions so the **P→N eval
   surface** in PROJECT_OVERVIEW stays the single source of truth.)

---

## Open questions (resolve during L0)

- **`noReply` semantics:** does injected text land as a user message the worker consumes on its next
  turn, mid-flight or only when idle? (Determines whether reactive nudges interrupt or queue.)
- **Plugin in server mode:** confirmed loading under `opencode serve`? (Gates all of Mode B-in-plugin.)
- **`tool.execute.before` throw behavior:** aborts the call cleanly, errors the turn, or kills the
  session?
- **Audit-span emitter:** observer-side `/v1/` POST vs plugin-side — and how to correlate `convo_id`.
- **Observer language** (TS vs Python) — inherited open decision; affects whether you lean on the
  TS plugin hooks or pure REST.

---

## Test / verification plan

- **P→N unit tests (reuse the eval surface):** given trace pattern P (fixture), assert the
  observer emits intervention N. These double as the self-healing-loop regression tests.
- **Guardrail unit:** drive `tool.execute.before`/`after` with crafted `{tool,args}` → assert
  block / arg-mutation / appended-nudge / counter-cap.
- **Integration (L0-gated):** spawn a flat session, inject a `noReply` nudge → confirm the worker
  incorporates it on its next turn; `abort` → confirm it stops; confirm an audit span appears on
  the `:5900` timeline correlated to that worker.

---

## Version pins (re-verify if bumped)

`opencode 1.15.12` · `@opencode-ai/plugin 1.15.12` · `@opencode-ai/sdk 1.15.12` ·
`@raindrop-ai/opencode-plugin 0.0.12`. Source of truth for hook signatures: the installed
`@opencode-ai/plugin/dist/index.d.ts` (`Hooks` interface) and `tool.d.ts` (`ToolContext`).
