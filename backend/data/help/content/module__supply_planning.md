# Puls8 Supply Planning

## Purpose
The Supply Planning module is the operational cockpit for short- to mid-horizon supply chain execution. Demand and supply planners use it to spot exceptions in the network, triage parameter integrity issues, and approve replenishment moves before orders cut.

## When to use it
- Daily exception sweep: open Dashboard → triage red KPI cards.
- Replenishment review meetings: open Replenishment to inspect today's order book.
- Parameter audit: open Parameters → bulk-correct lead-times, safety stocks, EOQs.
- Network design and what-if simulation: open Network or Scenarios.

## Pages in this module
| Page | What it answers |
|---|---|
| Dashboard | What's broken right now? |
| Recommendations | Which moves should we approve? |
| Replenishment | What orders are queued / late? |
| Parameters | Which policies are wrong or stale? |
| Network | Where do nodes / lanes / capacities live? |
| Analytics | How healthy is the plan over time? |
| Documents | Where is the policy / vendor evidence? |
| Chat | Explain a recommendation in plain English. |
| Scenarios | What-if a multiplier or lead-time changes. |
| SKU Detail | One SKU/location end-to-end view. |

## Data flow at a glance
All Supply Planning pages read from the `asc.db` SQLite database (replenishment_orders, parameters, recommendations, network_nodes, network_lanes). Updates POST through `/api/replenishment/*`, `/api/parameters/*`, and `/api/recommendations/*`. The global filter bar (top right of every page) feeds run_id, region, location, and SKU into every query.

## Permissions
Visible to all logged-in users. Edits to parameters and orders require the **planner** role; admin role inherits all access.

## Common pitfalls
- An empty Dashboard usually means the global filter is too narrow — clear the filter chip.
- "0 orders" on Replenishment after a fresh seed means no run has been executed; trigger one from the Network page.
