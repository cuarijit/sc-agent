# Parameter Detail

## Purpose
The Parameter Detail page expands the lineage of every parameter that resolves for a given (SKU, location) — global → region → location → sku/location — and shows the open exception queue tied to that pair.

## When to use it
- Investigating why a parameter has a surprising effective value.
- Auditing the override chain for a compliance review.
- Resolving an exception that calls out a specific (SKU, location).

## Layout walkthrough
- **Effective parameters** table: parameter_code, effective value, source level, last updated, override status.
- **Open recommendations** table: any pending parameter recommendation for the same SKU/location.

## Key controls explained
| Control | What it does |
|---|---|
| Source level chip | Click → highlights the corresponding row in the lineage tree. |
| Apply Recommendation | Accepts the suggested override and writes a new parameter row. |

## Data flow
- Reads: `/api/parameters/lineage/{sku}/{location}`, `/api/parameters/exceptions?sku=…&location=…`.
- Writes: `POST /api/parameters/values`, `PATCH /api/parameters/exceptions/{id}/state`.

## Permissions
Read for all roles. Apply Recommendation requires **planner**.

## Common pitfalls
- The lineage shows resolution path, not history — to see who changed what when, use the audit log on the Parameter Values grid (right-rail).
