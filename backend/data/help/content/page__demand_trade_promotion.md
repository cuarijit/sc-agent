# Trade Promotion

## Purpose
The Trade Promotion page is the calendar + analytics view for trade promotions. Each promo is one row with its lift %, trade spend, ROI, status (active / planned / completed), and historical performance baseline. Visualizations highlight which promos drove real lift and which underperformed.

## When to use it
- Promo planning meetings: which active promos run this quarter and how do they overlap?
- Post-promo analysis: ROI vs trade spend bubble + per-promo bar.
- Pre-Demand-Forecasting: confirm planned promos are reflected in the lift forecast.

## Layout walkthrough
- KPI cards: Active Promotions, Planned Promotions, Total Trade Spend, Avg Lift %.
- Promotion grid: promo_id, name, SKU, location, customer, channel, start_week, end_week, base_volume, lift %, trade_spend, ROI, status.
- Lift-by-promotion bar chart.
- ROI vs Trade Spend bubble scatter (size = lift volume).
- TPM ↔ IBP integration trend (composed).

## Key controls explained
| Control | What it does |
|---|---|
| Status chip | Click to filter the grid by status. |
| Promo row click | Drills to the underlying SKU/location forecast view. |

## Data flow
- Reads: `/api/demand/promotions`.
- Source: `demand_promotions` table.

## Permissions
Read for all roles. Editing promo metadata requires **demand_planner**.

## Common pitfalls
- A promo with `status='completed'` but lift = 0 usually indicates missing actuals; check accuracy table.
