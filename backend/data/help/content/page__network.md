# Network

## Purpose
The Network page is the planner's view of the supply network as a living graph: nodes (DCs, plants, stores), lanes (sourcing options), capacities, and current alert overlays. It also hosts the scenario simulator — change a parameter and see the system rerun against the same data.

## When to use it
- Spotting where alerts cluster geographically.
- Modeling a new lane or capacity change in a scenario before committing.
- Investigating an alert by expanding into the impacted SKUs grid.

## Layout walkthrough
- **Top KPI cards**: Alert Severity (donut), Network Impact (bar), Financial Impact (line), Demand & Accuracy (gauge).
- **Tabs** below the cards:
  - **Alert** — the active alerts grid + workbench actions.
  - **Network** — the interactive network graph + filters.
  - **Scenarios** — scenario builder + side-by-side compare cards.

## Tabs / sub-sections

### Alert tab
Workbench for active vs archived alerts. Select rows → run a Simulation. Each alert ties to a SKU/location and an exception type. Severity click on the KPI donut filters this grid.

### Network tab
SVG graph with nodes positioned geographically. Lane click reveals lead time + cost; node click reveals on-hand + projected horizon. Drag nodes to rearrange (positions persist per session). Filters: SKU, node, alert id, weeks-of-coverage.

### Scenarios tab
Same layout as the standalone Scenarios page but scoped to the current network selection. Scenario cards compare service level / transport cost / inventory cost / lead time deltas vs baseline.

## Key controls explained
| Control | What it does |
|---|---|
| Add Node | Adds a placeholder node to the graph; configurable in the form below. |
| Create Scenario | Branches a scenario from the current baseline. |
| Simulate Scenario | Re-runs the optimizer with the scenario's overrides. |
| Save Scenario | Persists as a named scenario for later compare. |
| Inventory Diagnostic Agent | Opens the diagnostic agent with the selected node/SKU pre-filled. |

## Data flow
- Reads: `/api/network/baseline`, `/api/network/graph`, `/api/network/alerts`, `/api/network/scenarios`.
- Writes: `POST /api/network/scenarios`, `POST /api/network/scenarios/{id}/simulate`.
- Drag-positions are local-storage only.

## Permissions
Read for all roles. Scenario create / simulate requires **planner**.

## Common pitfalls
- Graph is heavy on > 100 nodes; use the SKU filter to reduce render time.
- Scenario sim runs synchronously for small networks; for > 5k SKUs prefer the Scenarios page which queues async.
