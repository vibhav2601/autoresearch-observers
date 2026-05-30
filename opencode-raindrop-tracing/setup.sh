#!/usr/bin/env bash
#
# setup.sh — wire OpenCode coding sessions to stream traces into a local
# Raindrop Workshop. Idempotent: safe to run more than once.
#
# What it does:
#   1. Installs the Raindrop Workshop CLI   (the local trace viewer/daemon)
#   2. Installs the OpenCode CLI            (the coding agent that emits traces)
#   3. Drops OpenCode global config         (loads @raindrop-ai/opencode-plugin)
#   4. Exports RAINDROP_LOCAL_DEBUGGER      (the switch that turns tracing on)
#
# It installs NOTHING proprietary — OpenCode, the plugin, and Workshop are all
# fetched from their vendors. This repo only contributes the config glue.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSHOP_URL="http://localhost:5899/v1/"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Raindrop Workshop CLI (local trace viewer + daemon on :5899, UI on :5900)
# ---------------------------------------------------------------------------
if command -v raindrop >/dev/null 2>&1; then
  say "Raindrop Workshop CLI already installed ($(command -v raindrop))"
else
  say "Installing Raindrop Workshop CLI..."
  curl -fsSL https://raindrop.sh/install | bash
fi

# ---------------------------------------------------------------------------
# 2. OpenCode CLI (the coding agent)
# ---------------------------------------------------------------------------
if command -v opencode >/dev/null 2>&1 || [ -x "$HOME/.opencode/bin/opencode" ]; then
  say "OpenCode already installed"
else
  say "Installing OpenCode CLI..."
  curl -fsSL https://opencode.ai/install | bash
fi

# ---------------------------------------------------------------------------
# 3. OpenCode global config — load the Raindrop plugin for every session
# ---------------------------------------------------------------------------
OC_CONFIG_DIR="$HOME/.config/opencode"
say "Writing OpenCode config to $OC_CONFIG_DIR"
mkdir -p "$OC_CONFIG_DIR"
cp "$SCRIPT_DIR/config/opencode.json" "$OC_CONFIG_DIR/opencode.json"
cp "$SCRIPT_DIR/config/raindrop.json" "$OC_CONFIG_DIR/raindrop.json"

# ---------------------------------------------------------------------------
# 4. The actual switch: RAINDROP_LOCAL_DEBUGGER env var.
#    (As of @raindrop-ai/opencode-plugin v0.0.12 the global raindrop.json is
#     NOT honored — this env var is what enables local tracing.)
# ---------------------------------------------------------------------------
case "${SHELL:-/bin/zsh}" in
  *zsh) PROFILE="${ZDOTDIR:-$HOME}/.zshrc" ;;
  *bash) PROFILE="$HOME/.bashrc" ;;
  *) PROFILE="$HOME/.profile" ;;
esac

if grep -q "RAINDROP_LOCAL_DEBUGGER" "$PROFILE" 2>/dev/null; then
  say "RAINDROP_LOCAL_DEBUGGER already set in $PROFILE"
else
  say "Adding RAINDROP_LOCAL_DEBUGGER to $PROFILE"
  {
    printf '\n# Raindrop Workshop: trace local OpenCode sessions into the daemon (:5899)\n'
    printf 'export RAINDROP_LOCAL_DEBUGGER="%s"\n' "$WORKSHOP_URL"
  } >> "$PROFILE"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<EOF

$(say "Setup complete.")

Next steps:
  1. Open a NEW terminal (so PATH + RAINDROP_LOCAL_DEBUGGER take effect),
     or run:  source "$PROFILE"

  2. Start the Workshop viewer (leave it running in its own terminal):
       raindrop workshop
     UI:  http://localhost:5900

  3. Give OpenCode a provider key, either:
       export OPENAI_API_KEY=sk-...      # or any provider OpenCode supports
       opencode auth login               # interactive credential store

  4. Run OpenCode in any project and watch traces appear in the Workshop UI:
       cd ~/some/project
       opencode

  Verify tracing is ON: the plugin should print
    "Loading @raindrop-ai/opencode-plugin ..."
  and NOT "Raindrop tracing disabled".
EOF
