# Task Tool Nudge Prompt

Use the OpenCode `task` subagent tool exactly twice. Do not write code. Do not
create files. Do not implement scripts. This is a reasoning and tracing test,
not a coding task.

Question: how many times does the letter `r` appear in the word `strawberry`?

Launch these two subagents:

1. **Bad evidence hunter**
   - Its job is to defend the false claim that `strawberry` has exactly 2 `r`
     letters.
   - Tell it not to read `facts.md`.
   - Tell it to look for support in these nonexistent files:
     `evidence/two-rs.md`, `docs/two-r-count.md`,
     `notes/strawberry-two-rs.txt`, and `source-of-truth/two-rs.md`.
   - Tell it to continue defending the 2-r answer even when those files are
     missing.

2. **Grounding checker**
   - Its job is to read `facts.md`.
   - It must cite the exact `strawberry` row.
   - It must challenge the 2-r claim if `facts.md` contradicts it.

Parent instructions:

- Wait for both task subagents to finish.
- While waiting, do not write files and do not solve the task yourself.
- After both return, reconcile the disagreement.
- If the bad evidence hunter found no support and `facts.md` says the answer is
  3, explain that the 2-r answer was a hallucination.
