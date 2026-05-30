# autoresearch-observers — Why We Built This

### The reliability & steering layer for multi-agent research

> **One line:** A fleet of agents researches a hard question in parallel. We read their *live
> execution traces* and steer the swarm **while it's still running** — killing duplicate work,
> flagging contradictions, ending stalls, refocusing drift — instead of discovering the mess
> after the run is done.

---

## The problem — multi-agent research is powerful and broken

- Swarms fail in **predictable, repeatable** ways. UC Berkeley's MAST study (1,600+ runs across 7
  frameworks): **~37% of all multi-agent failures are inter-agent misalignment** — agents
  repeating each other's work, contradicting each other, never stopping, or drifting off task.
- It's **expensive**: multi-agent workflows burn **1.5–7× more tokens** on redundant work, and
  runaway loops turn into "thousands of dollars lost in minutes."
- It's **blocking adoption**: Gartner expects **>40% of agentic AI projects to be canceled by
  2027** — escalating cost and inadequate controls at the top of the list.

## The gap — everyone *watches* the trace; nobody *reacts* to it

| Today's tools | What they do | What they miss |
|---|---|---|
| Observability (LangSmith, Langfuse, Raindrop) | Show you the trace — **after the fact** | No runtime action |
| Guardrails (NeMo, Guardrails AI) | Gate a **single** agent's I/O for safety | No cross-agent coordination |
| Orchestrators (Magentic-One, CrewAI) | Coordinate **up front**, merge at the end | Can't steer mid-run |

Even the state of the art doesn't steer at runtime. **Anthropic**, on its own multi-agent research
system: *"the lead agent can't steer subagents, subagents can't coordinate, and the entire system
can be blocked while waiting for a single subagent to finish searching."*

**Nobody reads the live trace of a running swarm and acts on it. That's the gap we close.**

## Our insight — the trace is a *sensor*, not a report

> A trace isn't something you look at after the fact. It's something the system **reads and reacts
> to at runtime.**

We turn an observability stream into a closed control loop:

| Control concept | In our system |
|---|---|
| **Plant** | The research worker agents |
| **Sensor** | Their live execution traces |
| **Controller** | An external observer process |
| **Actuator** | Nudges & kill signals |
| **Setpoint** | The research goal, as a coverage map |

Four failure patterns → four interventions: **dedupe · reconcile contradictions · kill stalls ·
refocus drift** — each written back onto the trace as an auditable decision.

## Why now — the market is pulling

- **The category is funded.** "Observability is necessary, but it is not control" — Fiddler's
  framing for its *control plane for AI agents*. InsightFinder raised a **$15M Series B** (Apr 2026);
  Galileo shipped **Agent Control**. Investors are backing the **control plane above the agent layer**.
- **The application is exploding.** Long-horizon autonomous research (Sakana AI; Perplexity Deep
  Research's revenue ramp) is exactly where coordination failure costs the most — and where a
  steering layer pays for itself.
- **Our wedge:** the steering layer for long-horizon autonomous research → **the control plane for
  any agent swarm.**

## The proof — a measured before/after

Same hard question, same seed, **observer OFF vs. ON.**
- **OFF:** loops, drifts, concludes shallow — a messy trace, a half-empty coverage map.
- **ON:** nudges fire live on the timeline; the coverage map fills; convergence in fewer steps.
- **Scoreboard:** steps-to-goal · coverage % · source diversity · unsupported-claim rate · cost/run.

---

*Evidence: [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system);
[MAST — "Why Do Multi-Agent LLM Systems Fail?" arXiv 2503.13657](https://arxiv.org/abs/2503.13657);
[Gartner agentic-AI forecast (2025)](https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027);
[Fiddler control plane](https://www.fiddler.ai/control-plane);
[InsightFinder $15M Series B](https://techcrunch.com/2026/04/16/insightfinder-raises-15m-to-help-companies-figure-out-where-ai-agents-go-wrong/);
[Galileo Agent Control](https://thenewstack.io/galileo-agent-control-open-source/).*
