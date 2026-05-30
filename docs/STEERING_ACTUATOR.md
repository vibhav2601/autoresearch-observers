# Worker Steering — the Nudge Actuator (implementation spec)

> **Hand-off for the agent that builds the actuator.** Read [`PROJECT_OVERVIEW.md`](./PROJECT_OVERVIEW.md)
> first — this doc assumes its vocabulary (sensor / controller / actuator / plant) and its **locked
> decisions**. **This is the single spec for the actuator**: how an observer decision ("emit nudge N")
> becomes a real effect on a running worker. It covers all three levers we committed to — **nudge**
> (inject), **abandon** (abort), and **hard veto** (the synchronous gate plugin).
> **Status 2026-05-30:** **native-subagent-tree** topology; trace path (L0 sensor half) merged in
> PR #1; the external nudge/stop bridge prototype lives in
> `raindrop-workshop/examples/opencode-steering-actuator/`; the synchronous hard-veto gate plugin
> lives in `opencode-observer-gate/`.
> *Consolidates the earlier flat-session actuator draft + the standalone gate-plugin design into one
> spec, per the 2026-05-30 native-tree + hard-veto decisions (see PROJECT_OVERVIEW → "Fan-out model").*

---

## Architecture context (reconciled to the native tree)

- **Workers are native subagents.** The planner fans out via OpenCode's built-in subagent harness;
  each worker runs in **its own child session with its own `sessionID`**, forming a tree under a
  swarm root (`parentID`). We do *not* rebuild spawning over REST. *(Supersedes the earlier
  flat-session framing — see PROJECT_OVERVIEW.)*
- **The observer is external** (the brain). It identifies a worker by its `sessionID` and maps
  `sessionID → role / assigned subquestion` from its own run-state (+ `GET /session/:id/children`).
  No in-band "detection" of which session is which — it's a lookup.
- **Three levers, two surfaces:**

  | Lever | Mechanism | Surface |
  |---|---|---|
  | **Nudge** (inject guidance) | `session.prompt({ sessionID, parts, noReply:true })` (REST `POST /session/:id/prompt_async`) | external |
  | **Abandon** (stop a worker) | `POST /session/:id/abort` (cooperative) + stop consuming its output | external |
  | **Hard veto** (block a call pre-execution) | the **gate plugin**'s `tool.execute.before` → **throw to block** | in-process |

  *(Reach into a native child via REST is an L0 probe — see #6573 in PROJECT_OVERVIEW; if it hangs,
  nudges route through the orchestrator.)*

- **The external actuator prototype exists.** `raindrop-workshop/examples/opencode-steering-actuator/`
  accepts observer decisions, resolves a Workshop run / task span to an OpenCode session, calls the
  OpenCode REST API, and writes the resulting steering event back to Workshop.
- **The in-process gate plugin exists separately.** `opencode-observer-gate/` handles the hard-veto
  surface only: a fast synchronous `tool.execute.before` observer round-trip with local guardrails
  and fail-open behavior.

---

## Lever 1 — Injected guidance  *(external)*

Steers a worker by adding text to its context. **Observer-driven, trace-informed.**

- **Reactive (primary):** observer detects a pattern (drift / contradiction / duplicate-soft / stall)
  from traces → `session.prompt({ …, noReply:true })`. The injected text becomes context the worker
  reads on its **next turn** without forcing a reply. *(Verify exact `noReply` landing semantics in L0.)*
- **At spawn:** the worker's standing instructions (its slice of the coverage map / assigned
  subquestion) are set when the harness creates the subagent / sends the first prompt.
- **Optional in-process augmentation:** `experimental.chat.system.transform` can append *standing*
  guidance to **every** worker turn ("stay on subquestion X; you have N open coverage items") without
  an observer round-trip. Use only for invariant guidance, not reactive nudges.

## Lever 2 — Abandon  *(external)*

`POST /session/:id/abort` is **cooperative** (no force-kill — see #21176). So "stall → abandon" is an
**orchestration decision, not an OS kill**: the effect lands the moment the observer **stops
consuming** the staller's output and reassigns its subquestion; `abort` is best-effort compute
reclamation. Cooperative abort is good enough for the demo.

## Lever 3 — Hard veto: the synchronous gate  ⭐ *(in-process plugin)*

The reconciliation the native + hard-veto decisions force: **cross-worker veto (a duplicate search)
is delivered _synchronously_ — blocked before the call runs — not as an async nudge that arrives
after the duplicate has already started.**

REST can inject a *follow-up* message but cannot reach inside a tool call about to execute. Only an
in-process hook runs at that instant. That single capability — **synchronous pre-execution
interception** — is the entire reason a plugin exists.

**The gate holds ZERO detection logic.** It is a remote-controlled gate: on a gated tool's
`tool.execute.before` it asks the external observer "allow or deny?" and **fails open**.

```
worker about to call websearch({ query })
  └─ tool.execute.before  ── gated tool? no ──▶ return (zero cost)
       └─ POST {observer}/veto { sessionID, callID, tool, args, ts }   (timeout ~100ms)
            ├─ deny  ▶ throw Error(reason)   ── blocks the call; reason = the hard nudge
            └─ allow / timeout / error / malformed ▶ return ── proceed (FAIL-OPEN)
```

### The gate ⇄ observer wire protocol

Plain HTTP/JSON (observer can be any language). **Request** — `POST ${OBSERVER_GATE_URL}`:
```json
{ "sessionID": "ses_abc", "callID": "call_123", "tool": "websearch", "args": { "query": "…" }, "ts": 1748600000000 }
```
**Response** (`200`, within timeout): `{ "decision": "allow" }`  — or —
```json
{ "decision": "deny", "reason": "Searcher 1 already retrieved this (finding #4). Take the next open subquestion.", "confidence": 0.94 }
```
**Fail-open invariant:** the call is allowed unless the observer returns a well-formed `deny` in time.
Timeout, connection refused, non-200, unparseable body, unknown `decision` → **allow**. A broken or
absent observer removes the veto; it never stalls a worker.

### ⭐ The `/veto` endpoint is a fast deterministic lookup — NOT an LLM call

This is what makes a ~100 ms timeout realistic. `/veto` answers from observer state that is **already
maintained** (coverage map / claim registry for duplicate; the worker's assigned-subquestion
embedding for drift) — a hash/threshold/cosine lookup. The **LLM** side of the observer runs
*asynchronously* (consumes the trace stream, maintains that state, composes Lever 1's soft nudges).
It is never in the synchronous veto path. Both veto and nudge are observer decisions → both stay on
the same **P→N eval surface**.

### Which patterns use the gate

| Pattern | Pre-execution? | Lever |
|---|---|---|
| **Duplicate** | yes — block the redundant search | **gate (sync veto)** — primary |
| **Drift** | partly — block an off-subquestion search | **gate (sync veto)** — optional |
| **Contradiction** | no — only knowable after findings return | Lever 1 (inject) |
| **Stall** | no — a duration / dependency condition | Lever 2 (abandon) |

### Local guardrails the gate can also enforce (no round-trip)

Purely-local, single-worker rules don't need the observer and fire entirely in-plugin:
- `permission.ask` → `output.status = "deny"` for risky ops (shell `rm`, writes outside the worktree).
- `tool.execute.after` → per-`sessionID` counters to cap ("8 searches, no new info → synthesize"),
  and/or append a nudge to `output.output`.
- `tool.execute.before` → mutate `output.args` to *redirect* rather than block (cap result counts,
  strip a path).

**Rule of thumb:** *local + single-worker → enforce in-plugin directly. Cross-worker → the gate
round-trips to the observer: **synchronous** for a hard veto (duplicate / drift), or let the observer
**inject async** for soft steering.*

### Config (env; mirrors the Raindrop plugin's env-switch convention)

| Env var | Default | Meaning |
|---|---|---|
| `OBSERVER_GATE_URL` | *(unset)* | Observer `/veto` endpoint. Unset → plugin loads but is a **no-op** (fail-open). |
| `OBSERVER_GATE_TIMEOUT_MS` | `100` | Per-call deadline → fail-open on expiry. |
| `OBSERVER_GATE_TOOLS` | `websearch,webfetch` | Allowlist; only these incur a round-trip (everything else is zero-overhead). |
| `OBSERVER_GATE_ENABLED` | `true` if URL set | Kill switch. |

Purely-local guardrail rules (deny-tools, caps, standing guidance) can live in a sibling `steer.json`
read at plugin init:
```jsonc
{ "guardrails": { "denyTools": ["bash:rm*"], "maxToolCalls": { "websearch": 8 } },
  "guidance":   { "standingSystem": ["Stay on your assigned subquestion. Report when coverage stalls."] } }
```

### Package layout & code sketch

```
opencode-observer-gate/
  package.json           # "type":"module", peerDep @opencode-ai/plugin
  src/index.ts           # Plugin export: tool.execute.before (+ optional permission.ask / after / system.transform)
  src/observer-client.ts # fetch-with-timeout, fail-open
  src/config.ts          # env + steer.json
```
Loaded via `opencode.json` next to Raindrop:
`{ "plugin": ["@raindrop-ai/opencode-plugin", "opencode-observer-gate"] }`
(npm name **or** `file:///abs/path` — both supported; loads independently of Raindrop).

```ts
// src/index.ts
import type { Plugin } from "@opencode-ai/plugin"
export const ObserverGate: Plugin = async () => {
  const cfg = loadConfig()                      // env + steer.json
  if (!cfg.enabled) return {}                   // no URL → no-op, fail-open
  return {
    "tool.execute.before": async (input, output) => {
      // (optional) local guardrails first — no round-trip: denyTools / arg caps from steer.json
      if (!cfg.tools.has(input.tool)) return    // ungated → zero cost
      const v = await askObserver(cfg, {
        sessionID: input.sessionID, callID: input.callID,   // ← both confirmed present (see signatures)
        tool: input.tool, args: output.args, ts: Date.now(),
      })                                         // resolves null on ANY failure → allow
      if (v?.decision === "deny")
        throw new Error(`[observer veto] ${v.reason ?? "Redundant or off-task — blocked by the observer."}`)
    },
  }
}

// src/observer-client.ts — always resolves; any failure → null (fail-open)
export async function askObserver(cfg, q) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(cfg.url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(q), signal: ctl.signal })
    if (!res.ok) return null
    const b = await res.json(); return b?.decision === "deny" || b?.decision === "allow" ? b : null
  } catch { return null } finally { clearTimeout(t) }
}
```

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

**Scoping note (native tree):** `chat.*` hooks carry `agent`; `tool.execute.*` carry
`sessionID`/`callID`. The observer owns the `sessionID → worker/role` map (its run-state +
`GET /session/:id/children`), so scoping is a lookup. For purely-local in-plugin rules, pass the map
via plugin config or a shared file; for **cross-worker veto, the gate just sends `sessionID` to the
observer**, which does the mapping. *(This resolves the earlier "is `sessionID` available on
`tool.execute.before`?" question — yes, see the signature above.)*

**Caveats to verify, not assume:**
- `experimental.*` hooks are explicitly experimental — signatures may change.
- Whether **throwing in `tool.execute.before`** cleanly aborts *just that tool call* (surfacing the
  error/reason to the model) vs. faulting the turn/session is **unverified** — test before relying
  on it. The reason-surfacing is what makes a `deny` usable as a nudge.
- **Does the plugin load under `opencode serve`?** This is the top-priority L0 gate. If it does not
  load in server mode, the entire in-process veto + guardrail surface is unavailable and we fall back
  to soft nudges (Lever 1) only. **Resolve in L0 before committing to plugin hooks.**

### External control surface — `opencode serve` / `@opencode-ai/sdk`

`POST /session`, `POST /session/:id/prompt_async`, `session.prompt({ noReply:true })`,
`POST /session/:id/abort`, `GET /event` (SSE), `GET /session/:id/children`. Raw REST works from any
language (observer-language decision still open — see overview).

---

## Self-audit requirement (do not skip)

Per PROJECT_OVERVIEW, **every applied nudge / abort / veto must be written back as its own span on the
worker's trace timeline** (the "saw looping → banned query → novelty recovered" audit trail + demo
overlay). Where the span is emitted:
- **Observer-side (nudge / abort / veto verdict)** → observer POSTs a span to Raindrop ingest
  `http://localhost:5899/v1/` with the worker's `convo_id`/session correlation. Because the gate's
  `/veto` decision is made by the observer, the observer emits the veto span too.
- **Plugin-side local guardrails** → emit a marker the Raindrop plugin already traces, or POST an
  explicit span. **Correlate to the same interaction** (`convo_id` = the worker's session id).

---

## Recommended split (so the next agent doesn't re-litigate)

1. **Observer (external process)** — owns *decisions* + all *trace-derived / cross-worker* state:
   Lever 1 reactive nudges (`prompt{noReply}`), Lever 2 `abort`, and it **answers the gate's `/veto`
   synchronously** from already-maintained state. Rate-limiting + confidence-gating live here (a
   thrashing controller is worse than none).
2. **Gate plugin** (loaded via `opencode.json` next to Raindrop) — **zero detection logic**: Lever 3
   synchronous veto via the observer round-trip (fail-open) + optional purely-local guardrails
   (`permission.ask`, `tool.execute.after` counters, `system.transform` standing guidance).
3. **Config** — env (gate: URL / timeout / tool allowlist) + `steer.json` (local rules + guidance).
   Keep the **P→N eval surface** in PROJECT_OVERVIEW the single source of truth.

---

## Open questions / L0 probes (resolve during L0)

- ✅ **`tool.execute.before` carries `sessionID` + `callID`** — confirmed in the Hooks signatures
  above (`@opencode-ai/plugin 1.15.12`).
- **Plugin under `opencode serve`** — top-priority gate; veto + all in-process guardrails depend on it.
- **`tool.execute.before` throw behavior** — aborts just the call (surfacing the reason to the model)
  vs. errors the turn vs. kills the session? Gates whether `deny` is a usable hard nudge.
- **`noReply` semantics** — does injected text land as a message the worker consumes next turn,
  mid-flight or only when idle? (Determines whether reactive nudges interrupt or queue.)
- **Reach (#6573)** — REST inject into a *running native child*: if it hangs, Lever 1 routes through
  the orchestrator.
- **Veto latency** — end-to-end added latency on a gated call with a real fast observer; tune
  `timeoutMs` / shrink the allowlist if needed.
- **Audit-span emitter & observer language** — `/v1/` POST correlation; TS vs Python (inherited).

---

## Test / verification plan

- **P→N unit tests (reuse the eval surface):** given trace pattern P (fixture), assert the observer
  emits intervention N (nudge / abort / veto-verdict). These double as self-healing-loop regressions.
- **Gate unit:** stub observer that always denies → assert `tool.execute.before` blocks + the reason
  surfaces; assert allowlist gating (ungated tool = no round-trip); assert **fail-open** on
  timeout / refused / malformed.
- **Local guardrail unit:** drive `tool.execute.before`/`after` with crafted `{tool,args}` → assert
  block / arg-mutation / appended-nudge / counter-cap.
- **Integration (L0-gated):** spawn a **native subagent**; inject a `noReply` nudge → confirm it's
  incorporated next turn; `abort` → confirm it stops; point the gate at a deny-stub → confirm a
  `websearch` is blocked; confirm an audit span appears on the `:5900` timeline correlated to that
  worker.

---

## Version pins (re-verify if bumped)

`opencode 1.15.12` · `@opencode-ai/plugin 1.15.12` · `@opencode-ai/sdk 1.15.12` ·
`@raindrop-ai/opencode-plugin 0.0.12`. Source of truth for hook signatures: the installed
`@opencode-ai/plugin/dist/index.d.ts` (`Hooks` interface) and `tool.d.ts` (`ToolContext`).
