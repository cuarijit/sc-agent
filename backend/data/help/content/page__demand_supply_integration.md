# Supply Integration

## Purpose
Supply Integration is where Demand Planning meets Supply Planning. It compares the consensus demand forecast week-by-week against the supply plan (replenishment + capacity) and surfaces gaps, capacity constraints, and rebalance signals.

## When to use it
- After each forecast adjustment cycle: confirm supply can deliver.
- Spotting capacity-constrained nodes before they go red on Network.
- Pre-S&OP: pull the alignment picture for exec review.

## Layout walkthrough
- **KPI cards**: Total Demand, Total Supply, Coverage %, Capacity-Constrained Locations.
- **Demand vs Supply chart**: composed bar (Demand / Supply) + line (Gap, Coverage %) per week.
- **Capacity Constraints grid**: location, week, demand, capacity, constrained orders, production_flag, logistics_flag.
- **Alignment Status grid**: SKU/location/week with status (`aligned` / `partial` / `short`).

## Key controls explained
| Control | What it does |
|---|---|
| Week filter | Restrict the Gap chart + grids to a date range. |
| Status chip (Alignment grid) | Click to filter the grid to that status. |

## Data flow
- Reads: `/api/demand/supply-integration/gap`, `/api/demand/supply-integration/capacity`, `/api/demand/supply-integration/alignment`.
- Joins demand_forecast vs replenishment_orders + capacity (network_node attribute).

## Permissions
Read for all roles.

## Common pitfalls
- Coverage > 100% is normal in over-supplied weeks; alignment can still be `short` if it's a different SKU/location.
