# DBF Analytics

## Purpose
DBF Analytics shows forecast accuracy across the three DBF tiers — driver, consumption, shipment. For each tier you see overall MAPE / Bias / WMAPE, a 26-week trend, and a per-entity detail grid (per SKU + customer + driver).

## When to use it
- Quarterly DBF model review.
- Diagnosing where the chain breaks down (driver accurate but consumption off → elasticity issue).
- Comparing scenarios on accuracy.

## Tabs / sub-sections

### tab__driver_accuracy — Driver Accuracy
How accurate are the per-driver forecasts vs actuals? Useful for spotting which driver to retrain.

### tab__consumption_accuracy — Consumption Accuracy
Composed-output accuracy. If drivers are accurate but consumption isn't, the elasticity coefficients need tuning.

### tab__shipment_accuracy — Shipment Accuracy
Bridge regression accuracy. If consumption is accurate but shipment isn't, the consumption-to-shipment regression needs refitting.

## Key controls explained
| Control | What it does |
|---|---|
| Scenario picker | Anchor the metrics to a specific scenario. |
| Tab toggle | Switches the tier. |

## Data flow
- Reads: `/api/dbf/accuracy/{tier}` where tier ∈ {driver, consumption, shipment}.
- Source: `dbf_accuracy_snapshot`.

## Permissions
Read for all roles.

## Common pitfalls
- Bias near zero with high MAPE = symmetric noise; bias far from zero = systematic over/under.
