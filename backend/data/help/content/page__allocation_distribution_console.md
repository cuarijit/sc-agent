# Allocation & Distribution Console

## Purpose
The Allocation & Distribution console runs the structured Allocation agent. Given a demand pattern across nodes and a current inventory snapshot, the agent decides how much of each SKU to push from origin nodes to destination nodes to maximize service while minimizing transport cost. Used heavily in the dairy / perishables flow where iftar windows and shelf-life make timing critical.

## When to use it
- Pre-shift planning: balance stock across stores ahead of demand.
- Reactive: a store ran out — compute the fastest fair-share allocation.
- What-if: model an allocation rule change before applying it.

## Layout walkthrough
Same console template: left chat / right Results / Pipeline / Audit.

## Tabs / sub-sections

### Query Builder
Inputs: origin node(s), destination nodes, SKU(s), demand pattern (auto from forecast or override).

### Pipeline
Steps: `intent_parse → scope → capability → load_inventory → load_demand → optimize → emit_plan`.

### Audit
Full plan: per-line origin → destination quantity, expected service-level lift, transport cost.

## Key controls explained
| Control | What it does |
|---|---|
| Instance picker | Switches between allocation agents (e.g. dairy vs dry). |
| Apply Plan (in narrative card) | Posts the plan as draft replenishment orders for planner approval. |

## Data flow
- Reads: `/admin/agent-instances?agent_type=inventory_allocation_agent`.
- Writes: `POST /api/inventory-allocation/run`.
- Apply: `POST /api/replenishment/orders` (one per plan line, status='draft').

## Permissions
All logged-in users can run; Apply Plan requires **planner**.

## Common pitfalls
- "No feasible allocation" usually means total demand > total available stock — the narrative explains the shortfall.
