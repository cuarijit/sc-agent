# Parameters

## Purpose
The Parameters page is the policy workbench. Every supply-chain parameter (lead time, safety stock days, EOQ, MOQ, service level, cost ratios) is shown with its **effective value** plus the resolution lineage (global → region → location → sku/location). Planners spot-fix exceptions, bulk-apply changes, paste-import from spreadsheets, and run AI-suggested corrections.

## When to use it
- After a fresh load: audit which parameters are missing or out-of-bounds.
- Vendor change: bulk-apply new lead times across affected SKUs.
- AI-driven cleanup: run **Recommendations** to surface parameter-level suggestions.

## Layout walkthrough
- Two tabs at the top — **Parameter Values** (the main grid) and **Parameter Exceptions** (queue of flagged rows).
- Above the grid: filter chips, **Bulk Apply**, **Paste Import**, **Run Recommendations**, **Diagnostic Agent**.
- Right rail: parameter detail panel for the selected row (lineage tree + history).

## Tabs / sub-sections

### tab__parameters_values — Parameter Values
The grid of every effective parameter row. Columns: SKU, location, parameter_code, value, source level, last updated, exception flag. Click a row to open the Parameter Detail right rail.

### tab__parameters_exceptions — Parameter Exceptions
Filtered to rows where `exception_status != closed`. Each row carries a reason code (out_of_range, missing, stale, vendor_disagreement). Status transitions: `open → in_review → resolved` or `open → ignored`.

## Key controls explained
| Control | What it does |
|---|---|
| **Bulk Apply** | Set a parameter across all currently filtered rows; opens a confirm dialog. |
| **Paste Import** | TSV/CSV paste-box for spreadsheet round-trips; validates against parameter schema. |
| **Run Recommendations** | Asks the optimizer to propose corrections for flagged exceptions. |
| **Apply Recommendation** | Accepts a suggested value and writes it as a new parameter row. |
| **Diagnostic Agent** | Opens the Inventory Diagnostic agent with the SKU/location pre-loaded. |

## Data flow
- Reads: `/api/parameters/values`, `/api/parameters/exceptions`, `/api/parameters/lineage/{sku}/{location}`.
- Writes: `POST /api/parameters/values`, `PATCH /api/parameters/exceptions/{id}/state`.
- Bulk apply translates to N parallel POSTs (capped at 200 per batch).

## Permissions
Read for all roles. Bulk apply / state transitions require the **planner** role.

## Common pitfalls
- Lineage shows the *resolution path*, not every override — a row's "value" comes from the deepest level that has a value.
- Paste Import requires column headers exactly matching the schema (`sku, location, parameter_code, value, effective_from`).
