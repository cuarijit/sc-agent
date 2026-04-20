# Puls8 Agents

## Purpose
Puls8 Agents is the **agentic AI** layer of the platform. Each agent is an instance of a JSON-defined template (handler + prompt sections + decision tree + capability dots) that planners can run conversationally. Agents do not just call an LLM — they execute a structured pipeline of steps (parse intent → load data → reason → act → record artifact) and surface every step in the right-hand Pipeline panel for auditability.

## When to use it
- Diagnose a stockout: Inventory Diagnostic.
- React to a POS surge / forecast divergence: Demand Sensing.
- Plan an inventory move across nodes: Allocation & Distribution.
- Audit which pages consume which global filters: Filter Compliance.
- Build / edit / publish your own agent template: Agent Configurator.

## Pages in this module
| Page | What it answers |
|---|---|
| Agent Configurator | Manage agent templates and instances. |
| Inventory Diagnostic | Why is this SKU short, what fixes are available? |
| Demand Sensing | What's diverging from forecast in the last 24-72 h? |
| Allocation & Distribution | How should I rebalance stock across nodes? |
| Filter Compliance | Which pages / queries are missing filter wiring? |

## Data flow
Each console fetches its agent instances from `/admin/agent-instances` (filtered to the relevant `agent_type`), then POSTs questions to `/api/{agent}/run` and reads back a structured response + a list of step artifacts via `/api/{agent}/runs/{run_id}/steps`. Step artifacts are persisted in the `agent_run_step_artifact` table — they are the audit trail.

## Permissions
All logged-in users can run agents. Editing templates / instances requires the **admin** role.

## Common pitfalls
- "No instances yet" on a console means the demo seed didn't run; the **Agent Configurator → Instances** tab has a "Seed Demo" button.
- The Pipeline panel is empty if the agent's runner forgets to call `recorder.flush()`. As of this release, all four shipping agents flush correctly.
