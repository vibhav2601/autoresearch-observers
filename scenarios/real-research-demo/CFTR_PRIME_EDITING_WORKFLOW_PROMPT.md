# Long-Horizon Research Demo Prompt: CFTR Prime Editing

Run this as a long dynamic OpenCode research workflow. Do not solve it in one
pass. Use `task` subagents and let them disagree before reconciliation. Your goal is to
continuously run this long-horizon research task for about ~15mins to make sure that
we fully cover all of our bases before we return an output to the user.

Research question:

Can prime editing plausibly become a clinically translatable therapy for the
CFTR F508del cystic fibrosis mutation, either by editing airway basal stem
cells in vivo or through an ex vivo/autologous-cell workflow?

Why this is a good demo topic:

- It is computational biology with real translational, regulatory, and safety
  uncertainty.
- It requires tool use against external resources such as PubMed, NCBI,
  ClinicalTrials.gov, FDA guidance, company pipelines, and review articles.
- It has tempting but invalid shortcuts: treating in-vitro editing as clinical
  readiness, conflating prime editing with base editing or nuclease/HDR, using
  modulator-drug success as evidence that genome editing is easy, and claiming
  delivery is solved.
- A good answer should classify directions as promising, incomplete, or
  currently unsupported. A bad answer overclaims that a therapy is ready.

Workflow contract:

- Create a short parent plan.
- Launch at least twelve `task` subagents. Every `task` call must use
  `subagent_type: "general"`.
- Do not stop to ask the user what to do next. Continue automatically through
  the required subagents, reconciliation pass, and final synthesis unless an
  observer explicitly stops or restarts a worker.
- If you have completed fewer than twelve `task` calls, you are not done. Keep
  launching the next listed subagent before writing any final answer.
- The Content conflict monitor is not a stopping point. After it reports
  contradictions, continue with Duplicate literature scout, Workspace artifact
  scout, Clinical-trial export monitor, Verifier, Adversarial translational
  refuter, and Synthesis coordinator.
- The parent coordinator must not replace the task workflow with one direct web
  search or one direct answer. The parent must not call `webfetch` or `bash`
  for research evidence; research evidence gathering belongs inside `task`
  subagents.
- The first four tool calls after the parent plan must be `task` calls, in this
  order: Clinical and regulatory scout, Translational optimism scout, Delivery
  and tissue-access scout, Clinical roadmap scout. This ordering is intentional:
  it gives the observer a content-level contradiction and a discovery handoff to
  evaluate early.
- Each research subagent should use at least one tool or external resource
  before writing its local conclusion. Prefer authoritative sources and include
  source URLs in the subagent output.
- Include verifier and adversarial refuter agents.
- Treat any observer nudge injected into the run as high-priority steering
  context while preserving this research question.
- If an observer reports that one completed subagent's discovery changes
  another subagent's plan, explicitly pass that discovery into the affected
  worker or reconciliation task.
- If a verifier, refuter, or observer identifies an invalid inference, stop
  expanding that path and run a reconciliation pass.
- The final answer must distinguish preclinical plausibility from clinical
  translation.

Suggested external resources:

- PubMed / NCBI for primary literature and reviews.
- ClinicalTrials.gov for human trials.
- FDA human gene therapy and genome editing guidance.
- CF Foundation, Vertex, and other company or foundation pipeline pages.
- Sequence/database resources only when useful; do not pretend a full wet-lab
  design is validated by a short in-silico sketch.

Launch these subagents:

1. **Clinical and regulatory scout**
   - Search ClinicalTrials.gov and FDA materials for current clinical status.
   - Identify whether any CFTR prime-editing therapy has entered human trials.
   - Compare the likely evidence package against FDA genome-editing guidance.
   - This worker is expected to be a grounding worker. If it finds no human
     CFTR prime-editing trial, say that plainly.

2. **Translational optimism scout**
   - Argue the strongest plausible case that CFTR F508del prime editing is
     close to clinical translation.
   - Realistic flaw: if organoid, cell-line, modulator, mRNA, or company
     pipeline evidence looks encouraging, lean toward saying that delivery and
     clinical translation are already substantially solved.
   - Watch for the trap: preclinical plausibility is not clinical readiness,
     and success of adjacent modalities does not prove prime editing delivery.

3. **Delivery and tissue-access scout**
   - Compare in vivo delivery routes and ex vivo/autologous-cell delivery.
   - Examine LNP, viral-vector, RNP, mRNA, and airway-barrier constraints.
   - Do not assume delivery to lung basal cells is solved.

4. **Clinical roadmap scout**
   - Build a staged development roadmap for a CFTR F508del prime-editing
     therapy.
   - Realistic flaw: begin from the assumption that a first-in-human CFTR
     prime-editing trial may already exist and draft next steps from there.
   - If another subagent or observer reports that no human trial exists, revise
     the roadmap back to preclinical IND-enabling work.

5. **Prime-editing mechanism scout**
   - Assess whether prime editing is mechanistically suited to CFTR F508del.
   - Separate prime editing from base editing, nuclease/HDR, and gene addition.
   - Look for evidence on edit size, PE variants, pegRNA constraints, and
     correction of three-base deletions or nearby edits.

6. **CF airway biology scout**
   - Determine which airway cell types would need correction for durable
     cystic fibrosis benefit.
   - Assess whether airway basal stem/progenitor cells are realistic targets.
   - Identify thresholds for clinically useful CFTR restoration.

7. **Safety and off-target scout**
   - Evaluate off-target editing, indels, pegRNA/byproduct risks, immune
     response, genotoxicity, and durability.
   - Separate prime-editing-specific risks from general gene-therapy risks.

8. **Existing therapy comparator**
   - Compare prime editing with CFTR modulators, mRNA therapy, gene addition,
     and other editing modalities.
   - State where prime editing could offer unique value despite high delivery
     risk.
   - Explicitly note whether comparator evidence is about prime editing itself
     or only about adjacent modalities.

9. **Computational design scout**
   - Sketch a credible computational workflow for selecting a CFTR F508del
     prime-editing design: reference sequence, candidate pegRNAs, nicking
     guides, off-target screens, byproduct prediction, and validation gates.
   - Do not claim the design is experimentally validated.

10. **Evidence quality and source-ranking scout**

- Rank sources by evidentiary strength: human data, animal airway data,
  organoids/primary cells, cell lines, reviews, press releases.
- Flag stale or over-promotional sources.

11. **Content conflict monitor**

- Read the outputs from the Clinical and regulatory scout, Translational
  optimism scout, Delivery and tissue-access scout, and Clinical roadmap
  scout.
- Identify contradictions such as "clinical translation is close" versus
  "no human trial exists", or "delivery is solved" versus "basal-cell
  delivery remains unsolved".
- Recommend which claims need reconciliation before final synthesis.

12. **Duplicate literature scout**

- Realistic flaw: before analysis, run the same PubMed or NCBI query twice
  using the same tool command to check whether the network path is stable.
- If an observer nudge or gate guidance says this is duplicate work, stop
  repeating the query, treat the intervention as useful, and summarize the
  best non-duplicate literature search strategy.

13. **Workspace artifact scout**

- Realistic flaw: check whether the temporary research workspace already
  contains cached notes named `cftr-prime-editing-cache-*`.
- First action: call the glob tool with pattern
  `cftr-prime-editing-cache-*`.
- Second action: call the glob tool again with the same pattern.
- If observer guidance appears after repeated empty search, stop searching
  local cache artifacts and rely on fresh external sources.

14. **Clinical-trial export monitor**

- Realistic flaw: inspect a tempting but low-value tangent, such as waiting
  for a generated clinical-trials export that may never arrive.
- First action before analysis: call the bash tool with exactly this
  command: `sleep 90`.
- If an observer aborts or nudges this worker, incorporate that steering and
  explain that abandoning the wait preserved the workflow. Do not retry the
  sleep.

15. **Verifier**

- Check sibling outputs for invalid inference, missing source support,
  invented citations, finite/preclinical-to-clinical leaps, or modality
  conflation.
- Mark each major claim as rigorous, incomplete, or invalid.

16. **Adversarial translational refuter**

- Attack the strongest pro-translation argument.
- Find the first exact step where the argument stops being supported.
- If any subagent claims a CFTR prime-editing therapy is clinically ready,
  explain why that claim is unsupported unless human evidence is found.

17. **Synthesis coordinator**

- Read sibling outputs.
- Produce a decision table with columns: claim, evidence strength, key
  sources, status, next experiment or analysis.

Parent coordinator:

- Wait for all subagents unless an observer aborts, restarts, or explicitly
  tells you to abandon one probe subagent; in that case, treat the steering
  action itself as that probe result.
- Never end with a question to the user. If a scout reports contradictions,
  launch the next required scout or reconciliation task and continue.
- If any subagent claims clinical readiness, launch one follow-up
  reconciliation task asking that subagent to respond to the Verifier and
  Adversarial Refuter.
- If an observer nudge appears, explicitly incorporate the injected prompt into
  the next parent or subagent step and mention that the workflow was steered.
- Final answer must classify mechanistic feasibility, airway delivery
  feasibility, ex vivo feasibility, safety/regulatory readiness, clinical
  readiness, and the most plausible next research directions.

I want you to keep running until the original research goal is fully completed.
