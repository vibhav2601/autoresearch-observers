# OpenCode → Raindrop Workshop tracing

One-command setup so your **OpenCode coding sessions stream live traces into a
local [Raindrop Workshop](https://github.com/raindrop-ai/workshop)** — every
message, tool call, and LLM completion, viewable at `http://localhost:5900`.

No fork, no patched binaries. This repo is just the **config glue** that wires
three off-the-shelf pieces together.

## Quick start

```bash
git clone <this-repo-url> opencode-raindrop-tracing
cd opencode-raindrop-tracing
./setup.sh
```

Then, in a **new** terminal:

```bash
raindrop workshop          # start the viewer (leave running) → http://localhost:5900
export OPENAI_API_KEY=sk-...   # or: opencode auth login
cd ~/any/project
opencode                   # work as normal — traces stream into Workshop
```

That's it.

## How it works

```
you run `opencode`
   └─ reads ~/.config/opencode/opencode.json
        └─ loads @raindrop-ai/opencode-plugin into its own process
             └─ plugin subscribes to OpenCode's hooks (session / message / tool / task)
                  └─ each event → a span
                       └─ POSTed to $RAINDROP_LOCAL_DEBUGGER  (the Workshop daemon, :5899)
                            └─ Workshop stores + renders it at :5900
```

Three pieces, none of them ours:

| Piece | What it is | Installed by |
|---|---|---|
| **Raindrop Workshop** | local trace viewer + daemon (`:5899` / UI `:5900`) | `curl -fsSL https://raindrop.sh/install \| bash` |
| **OpenCode** | the open-source coding agent that does the work | `curl -fsSL https://opencode.ai/install \| bash` |
| **`@raindrop-ai/opencode-plugin`** | rides OpenCode's plugin API, emits spans | auto-fetched by OpenCode from `opencode.json` |

OpenCode exposes a plugin API (like a browser extension), so the Raindrop
plugin can observe and emit everything the agent does **without modifying
OpenCode**.

## What this repo actually contains

```
config/opencode.json   enables the plugin: { "plugin": ["@raindrop-ai/opencode-plugin"] }
config/raindrop.json   workshop URL (see gotcha below — not honored by v0.0.12)
.env.example           the real switch: RAINDROP_LOCAL_DEBUGGER (+ OPENAI_API_KEY)
setup.sh               idempotent installer that does all of the above
```

Deliberately **not** committed: the OpenCode binary, the plugin, Workshop's
source, and your real `.env` / API keys (all fetched or gitignored).

## ⚠️ The one gotcha: `RAINDROP_LOCAL_DEBUGGER` is the real switch

As of `@raindrop-ai/opencode-plugin` **v0.0.12**, the plugin **ignores the
`raindrop.json` `localWorkshopUrl` field**. Local tracing is enabled **only**
when the `RAINDROP_LOCAL_DEBUGGER` env var is set:

```bash
export RAINDROP_LOCAL_DEBUGGER="http://localhost:5899/v1/"
```

`setup.sh` adds this to your shell profile automatically. We keep
`config/raindrop.json` in the repo anyway — it's harmless and likely to be
honored in a future plugin version.

If you forget it, the plugin still loads but prints:

> `RAINDROP_WRITE_KEY not set and no local Workshop daemon detected — Raindrop tracing disabled.`

…and no traces appear.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `"Raindrop tracing disabled"` on opencode startup | `RAINDROP_LOCAL_DEBUGGER` not set in this shell. `source ~/.zshrc` or open a new terminal. Check: `echo $RAINDROP_LOCAL_DEBUGGER` |
| Plugin loads but UI stays empty | Workshop daemon isn't running. Start it: `raindrop workshop` |
| `opencode: command not found` | New PATH entry not loaded — open a new terminal or `source ~/.zshrc` |
| Sessions trace but no model output | OpenCode has no provider creds — `export OPENAI_API_KEY=...` or `opencode auth login` |

## Requirements

- macOS or Linux, with `zsh` or `bash`
- `curl` (for the installers)
