# Puls8 Demand Planning

## Purpose
The Demand Planning module is where planners build, reconcile, and govern the consensus demand forecast. It covers the full S&OP / IBP cycle — from baseline statistical forecast through promo lift, customer collaboration, financial planning, and supply alignment.

## When to use it
- Weekly forecast adjustment cycle: Demand Forecasting → Collaborative Planning → Forecast Accuracy.
- Monthly S&OP cycle: S&OP / IBP → Supply Integration → Financial Planning.
- Promo planning: Trade Promotion → push lift back into Demand Forecasting.
- Executive review: Planning Analytics dashboards.

## Pages in this module
| Page | What it answers |
|---|---|
| Demand Forecasting & Planning | What's the baseline / final forecast and where do I adjust it? |
| Collaborative Planning | What do Sales / Customer / Marketing / Supply Chain say? |
| Forecast Accuracy | How close was last week's forecast? |
| S&OP / IBP | What's the cycle status and open review items? |
| Supply Integration | Where does demand exceed supply? |
| Financial Planning | What's the revenue / margin plan? |
| Trade Promotion | Which promos run when and what's the lift? |
| Planning Analytics | KPI dashboards across the cycle. |
| Customers | Customer hierarchy + planning level. |

## Data flow
All pages read from the `asc.db` `demand_*` tables (`demand_forecast`, `demand_forecast_accuracy`, `demand_consensus_entries`, `demand_promotions`, `sop_cycles`, `customer_hierarchy`). Adjustments POST through `/api/demand/*`. The "Save Adjustments" action on Forecasting writes back into `demand_forecast.adjusted_qty` for the unlocked, future-period rows.

## Permissions
Read access for all logged-in roles. Adjustment writes require the **demand_planner** entitlement (granted by default to admin + planner roles).

## Common pitfalls
- Past-period rows are read-only — locked-and-greyed cells in the workbench. This is by design.
- The forecast workbench has 4 bucketing modes (day / week / month / quarter); some metrics are weekly-only and the toggle disables itself with a tooltip.
