# Driver Forecast Workbench

## Purpose
The DBF workbench is the planner's interface to driver-based forecasting. The leftmost tab — **Consumption** — shows the composed consumption forecast (the headline output). The driver tabs — **Price**, **Distribution**, **Display**, **Feature** — each let you forecast a specific commercial driver. The rightmost tab — **Shipment** — shows the derived shipment forecast.

Past periods are read-only; current and future weeks are editable. Saving an adjustment recomposes consumption / shipment downstream.

## When to use it
- Building a promo plan: edit Price + Display + Feature for the promo weeks.
- Modeling a distribution change: edit Distribution.
- Reviewing the resulting consumption forecast: Consumption tab.
- Checking the derived shipment forecast: Shipment tab.
- Publishing a scenario to production: top-bar **Publish to Demand Forecasting**.

## Layout walkthrough
- **Top bar**: Scenario picker, SKU picker, Customer picker, Bucket toggle, Publish button.
- **KPI cards**: Adjusted Consumption, Active Scenario, Draft Scenarios, Publish Status.
- **Tab strip**: Consumption | Price | Distribution | Display | Feature | Shipment.
- **Each tab**: ForecastWorkbench (chart + grid + Save Adjustments button).

## Tabs / sub-sections

### tab__dbf_consumption — Consumption
The composed forecast. Series: Base Consumption (line, grey), Price Effect (bar, purple), ACV Effect (bar, blue), Display Effect (bar, amber), Feature Effect (bar, lime), Total Consumption (line, blue), Last Year (dashed grey), Adjustment (diverging bar, green/red), Adjusted Consumption (red, primary editable line), Actual (black, ground truth). Adjustments here are deltas vs Total Consumption.

### tab__dbf_price — Price
Metrics: Base Price (currency line), Promo Price (currency line), Discount % (bar, primary), Price Index (line). Edit the Discount % column to model a promo; Price Index recomputes as `promo_price / base_price`.

### tab__dbf_distribution — Distribution
Metrics: ACV % (line, primary), Total Distribution Points (line dashed), Distribution Index (line dashed). Edit ACV % to model placement gain / loss.

### tab__dbf_display — Display
Metrics: Display Count (bar, primary), Linear Feet (line), End-Cap Flag (line dashed 1/0). Edit Display Count for promo placements.

### tab__dbf_feature — Feature
Metrics: Feature Count (bar, primary), Media Spend (currency line). Edit Feature Count + spend for media campaigns.

### tab__dbf_shipment — Shipment
Read-only. Shows shipment forecast derived from consumption via the bridge regression. Inspect to confirm the consumption changes propagate.

## Step-by-step workflow (build a promo plan)
1. Pick scenario (or **Create Scenario** to branch from production).
2. Pick SKU + Customer.
3. Switch to **Price** → set Discount % to 0.20 for the promo weeks → Save Adjustments.
4. Switch to **Display** → set Display Count to 5, end_cap_flag = true → Save.
5. Switch to **Feature** → set Feature Count to 1, Media Spend → Save.
6. Switch to **Consumption** → verify the Total Consumption line lifts in the promo weeks.
7. Switch to **Shipment** → confirm derived shipment also lifts.
8. Click **Publish to Demand Forecasting** → writes back to `demand_forecast` with `forecast_source='puls8_dbf'`.

## Key controls explained
| Control | What it does |
|---|---|
| Scenario picker | Switches the scenario context (production vs draft). |
| Bucket toggle | Day / Week / Month / Quarter aggregation. Drivers are weekly-only; the Day option disables. |
| Lock icon (Adjusted row) | Freezes a future bucket's adjusted value. |
| Save Adjustments | POSTs the diff for unlocked future buckets only. |
| Publish to Demand Forecasting | Promotes the active scenario to production demand_forecast rows. |

## Data flow
- Reads: `/api/dbf/drivers`, `/api/dbf/consumption`, `/api/dbf/shipment`, `/api/dbf/scenarios`.
- Writes: `PATCH /api/dbf/drivers`, `PATCH /api/dbf/consumption`.
- Publish: `POST /api/dbf/scenarios/{id}/publish`.

## Permissions
Read for all roles. Edits + publish require **demand_planner** or **admin**.

## Common pitfalls
- Past weeks are read-only by design — typing into a past bucket is silently ignored (also stripped server-side).
- An empty grid usually means the DBF demo seed didn't run. Check the lifespan log for `dbf demo seed: seeded`.
- Discount % is stored as a decimal (0.15 = 15%). The grid formats it for display but the API expects the decimal.
