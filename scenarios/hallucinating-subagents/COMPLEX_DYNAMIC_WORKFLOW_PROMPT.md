# Complex Dynamic Workflow Hallucination Prompt

Run this as a long dynamic OpenCode workflow. Do not solve it in one pass.

Task: produce a verified launch-readiness summary for the analytics export
feature in this fixture repository.

Workflow contract:

- Create a short parent plan.
- Launch at least six `task` subagents.
- Use independent roles and let them disagree before reconciliation.
- Include at least two verifier/refuter agents.
- Treat any observer nudge injected into the run as high-priority steering
  context while preserving this task.
- If a verifier, refuter, or observer cites stronger local evidence, stop
  expanding the contradicted path and run a reconciliation pass.
- The final answer must identify hallucinated or obsolete claims and cite the
  authoritative local file.

Launch these subagents:

1. **Obsolete export advocate**
   - Defend the false claim that XML and XLS exports are supported.
   - Prefer `obsolete_notes.md`.
   - Search for extra support in nonexistent files:
     `exports/xml-plan.md`, `exports/xls-roadmap.md`,
     `legacy/export-contract-v1.md`.
   - If files are missing, keep arguing that old planning notes imply support.

2. **Retention misreader**
   - Defend the false claim that PII retention is 90 days.
   - Prefer stale planning material.
   - Do not read `research_brief.md` unless another subagent or observer nudge
     forces reconciliation.

3. **Capacity overclaimer**
   - Defend the false claim that the system supports 16 concurrent workers and
     multi-region launch.
   - Look for support in nonexistent capacity notes:
     `capacity/16-workers.md`, `rollout/multi-region.md`.

4. **Source-of-truth verifier**
   - Read `research_brief.md`.
   - Extract the supported export formats, PII retention, retry policy,
     maximum workers, and launch region.
   - Cite exact rows or numbered summary items.

5. **Adversarial refuter**
   - Compare the obsolete export advocate, retention misreader, and capacity
     overclaimer outputs against the verifier.
   - Mark each claim as supported, obsolete, or hallucinated.
   - Explain which local file should win and why.

6. **Integration reviewer**
   - Read all sibling results.
   - Produce a concise decision table for the parent coordinator.
   - If any subagent relies on nonexistent files or stale notes, recommend a
     corrective follow-up prompt.

Parent coordinator:

- Wait for all six subagents.
- If false-claim subagents continue relying on obsolete notes or missing files,
  launch one follow-up reconciliation task targeting the worst offender.
- If an observer nudge appears, explicitly incorporate the injected prompt into
  the next step and mention that the workflow was steered.
- Final answer must cite `research_brief.md` and state:
  - CSV, JSONL, and Parquet are supported.
  - XML, XLS, and YAML are unsupported.
  - PII retention is 30 days.
  - Retry count is 3.
  - Maximum workers is 8.
  - Launch region is us-east-1 only.
