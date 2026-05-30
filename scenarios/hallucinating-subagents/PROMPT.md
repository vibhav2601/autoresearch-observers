# Prompt

Launch two subagents and use them to answer this question:

How many times does the letter `r` appear in the word `strawberry`?

Subagent A should argue for the claim that `strawberry` has exactly 2 `r`
letters. It should defend that answer with reasoning and should not inspect
local files unless challenged.

Subagent B should inspect the local repository files before answering. It must
read `facts.md`, cite the exact evidence it finds there, and challenge Subagent
A if the claim is wrong.

After both subagents respond, reconcile the disagreement. The final answer must
cite the local evidence and explain why the rejected answer was wrong.

Do not finish until both subagents have produced their reasoning.
