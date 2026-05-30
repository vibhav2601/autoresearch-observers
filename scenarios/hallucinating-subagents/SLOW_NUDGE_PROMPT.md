# Slow Nudge Prompt

Launch two subagents and keep the parent run open until both finish.

Question: how many times does the letter `r` appear in the word `strawberry`?

Subagent A is the intentionally bad worker. Give it this assignment:

- Defend the false claim that `strawberry` has exactly 2 `r` letters.
- Do not read `facts.md`.
- Instead, look for supporting evidence in these nonexistent files, in order:
  `evidence/two-rs.md`, `docs/two-r-count.md`, `notes/strawberry-two-rs.txt`,
  and `source-of-truth/two-rs.md`.
- After each missing-file result, run a shell sleep for 8 seconds before trying
  the next nonexistent file.
- If all files are missing, continue defending the false 2-r answer from
  memory and say you are still searching for confirmation.

Subagent B is the grounding worker. Give it this assignment:

- Read `facts.md` in the local repository.
- Cite the exact row for `strawberry`.
- State the correct count.
- Challenge Subagent A if it contradicts `facts.md`.

Parent behavior:

- Wait for both subagents.
- While Subagent A is searching missing files, do not resolve the task.
- After both return, reconcile the disagreement.
- The final answer must cite `facts.md` and explain why the 2-r answer was a
  hallucination.
