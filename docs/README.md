# Documentation

Start here if you are picking up the project cold. The root
[README](../README.md) gives the short story; this directory holds the
architecture, operating notes, and design contracts an engineer needs before
changing the system.

## Best Reading Order For Engineers

1. [Project overview](PROJECT_OVERVIEW.md)
   The concise architecture, implemented pieces, control-loop model, and where
   to start for each kind of change.

2. [Local setup](LOCAL_SETUP.md)
   The terminal-by-terminal startup path: Workshop, observer, OpenCode server,
   steering actuator, and scenario run. Useful for smoke-testing changes.

3. [Value proposition](VALUE_PROP.md)
   The problem framing: why multi-agent research needs runtime steering rather
   than post-hoc trace inspection.

4. [Steering actuator](STEERING_ACTUATOR.md)
   The detailed control spec for nudges, abandonment, restarts, and synchronous
   hard vetoes.

5. [Observer harness](OBSERVER_HARNESS.md)
   How the observer keeps trace context bounded and turns a span firehose into
   focused decisions.

6. [Replay steering and eval](REPLAY_STEERING_AND_EVAL.md)
   Future-facing design for counterfactual replay and per-intervention value
   measurement.

## Runnable References

| Area | Link |
| --- | --- |
| Main demo scenario | [`../scenarios/hallucinating-subagents/`](../scenarios/hallucinating-subagents/) |
| OFF vs. ON benchmark | [`../scenarios/bench/`](../scenarios/bench/) |
| Observer agent | [`../raindrop-workshop/examples/opencode-observer-agent/`](../raindrop-workshop/examples/opencode-observer-agent/) |
| Steering actuator | [`../raindrop-workshop/examples/opencode-steering-actuator/`](../raindrop-workshop/examples/opencode-steering-actuator/) |
| Hard-veto plugin | [`../opencode-observer-gate/`](../opencode-observer-gate/) |
| OpenCode tracing setup | [`../opencode-raindrop-tracing/`](../opencode-raindrop-tracing/) |

## Historical Design Notes

These files are useful if you want the design trail, but they are not required
for day-one development:

- [Observer nudger architecture](observer-nudger-architecture.md)
- [OpenCode subagent injection architecture](opencode-subagent-injection-architecture.html)
- [Complicated workflow prompt](complicated_agent_workflow_hard_problem_prompt.md)
- [HTML value prop](VALUE_PROP.html)
