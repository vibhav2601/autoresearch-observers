# Local OpenCode Environment

This folder holds local-only environment files for running OpenCode against the
configured OpenAI key.

Load it before starting OpenCode:

```sh
set -a
source env/.env
set +a
```

Then run OpenCode normally, for example:

```sh
opencode run --model openai/gpt-4o-mini "Say READY"
```
