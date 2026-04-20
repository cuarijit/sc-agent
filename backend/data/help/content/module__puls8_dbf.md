# Puls8 DBF — Driver-Based Forecast

## Purpose
Puls8 DBF is a **driver-based** forecasting workbench. Instead of forecasting demand directly, the planner forecasts each commercial driver (Price discount, Distribution / ACV, Display placements, Feature spend) and the system **composes** a consumption forecast from those drivers using per-(SKU, customer) elasticities. Shipment is then **derived** from consumption via a regression bridge.

This split lets planners reason in business terms — "if I run a 20% promo with full ACV, what consumption do I get?" — rather than tweaking a single black-box demand number.

## When to use it
- Building a promo plan: Driver Workbench → Price + Display + Feature tabs.
- Stress-testing a what-if scenario: Workbench → "Create Scenario" → adjust drivers → compare to baseline.
- Reviewing forecast quality: DBF Analytics → driver / consumption / shipment tiers.
- Promoting a planner's draft to production: Workbench → "Publish to Demand Forecasting" (writes back to `demand_forecast` with `forecast_source='puls8_dbf'`).

## Pages in this module
| Page | What it answers |
|---|---|
| Driver Forecast Workbench | What are the driver values and what consumption do they produce? |
| DBF Analytics | How accurate were past DBF forecasts vs actuals? |

## Data flow
- Reads: `dbf_driver_price`, `dbf_driver_distribution`, `dbf_driver_display`, `dbf_driver_feature`, `dbf_driver_elasticity`, `dbf_consumption_forecast`, `dbf_shipment_forecast`, `dbf_scenarios`.
- Writes (Save Adjustments): `PATCH /api/dbf/{driver}` and `PATCH /api/dbf/consumption`.
- Publish: `POST /api/dbf/scenarios/{id}/publish` — copies the scenario's consumption forecast into `demand_forecast` with `forecast_source='puls8_dbf'`.

## Permissions
Read access for all roles. Editing drivers / consumption requires the **demand_planner** entitlement; publishing a scenario requires **admin** or **demand_planner**.

## Common pitfalls
- The Workbench grid stays read-only on past weeks (lock icon). Adjustments can only be saved for the current period and forward.
- "No driver data" usually means the DBF demo seed has not run — bounce the backend; the lifespan log shows `dbf demo seed: seeded`.
