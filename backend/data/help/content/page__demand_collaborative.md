# Collaborative Planning

## Purpose
The Collaborative Planning workbench captures inputs from four stakeholder groups — Sales, Customer, Supply Chain, Marketing — and computes a consensus number per (SKU, location, week). Each group's input is editable by anyone with the role tag; the consensus is the simple average (4-corner blend) and the variance % flags weeks where the inputs disagree most.

## When to use it
- Pre-S&OP review: gather each group's view and surface disagreements.
- After a Demand Forecasting adjustment: validate the planner's number against Sales / Customer signals.
- Approving a cycle: lock the consensus row when stakeholders agree.

## Layout walkthrough
- **Top filter row**: cycle (defaulting to current S&OP cycle), SKU, Location.
- **Consensus grid**: rows per metric (Sales Input / Customer Input / Supply Chain Input / Marketing Input / Consensus / Variance %), columns per week. Editable cells per role.
- **Status chips** per consensus column (draft / approved).

## Step-by-step workflow
1. Pick a cycle (or accept current).
2. Each role enters their numbers in the appropriate row.
3. Consensus auto-computes; the Variance % row shows agreement.
4. When all four roles have entered: click **Approve** on a consensus column to lock it.
5. Save Adjustments persists the snapshot.

## Key controls explained
| Control | What it does |
|---|---|
| Editable role cells | PATCHes consensus entry on blur. |
| Approve column action | Sets `status='approved'` and locks the column. |
| Save Adjustments | Persists all dirty cells in one transaction. |

## Data flow
- Reads: `/api/demand/consensus?cycle_id=…`.
- Writes: `PATCH /api/demand/consensus/{id}`.
- The cycle metadata (status, dates) lives in `sop_cycles`.

## Permissions
Read for all roles. Editing requires the corresponding role tag (sales / customer / supply_chain / marketing); admin can edit all.

## Common pitfalls
- Editing a locked column is blocked client-side; if the API still rejects, your role tag may not match.
- Past-cycle data is read-only.
