# SKU Detail

## Purpose
The SKU Detail page is the single SKU/location deep-dive — recommendation rationale, projected inventory, ranked sourcing options, and the policy evidence (RAG snippets) that explain *why* the recommendation reads the way it does.

## When to use it
- Drilling from a recommendation row to its full justification.
- Approving a recommendation with confidence by reading the policy evidence.
- Inspecting a single SKU's inventory projection over the planning horizon.

## Layout walkthrough
- **Recommendation card** (top left): SKU name, location, shortage qty, ETA, score, action.
- **Inventory projection** (top right): line chart of ending inventory vs safety stock by week.
- **Ranked options** (middle): table of feasible sourcing alternatives ranked by score.
- **Policy evidence** (bottom): RAG snippets with their source document path.

## Key controls explained
| Control | What it does |
|---|---|
| Approve / Reject buttons (recommendation card) | Advances the recommendation state. |
| Option row click (Ranked options) | Switches the recommendation to that option. |
| Policy snippet click | Opens the source document. |

## Data flow
- Reads: `/api/recommendations/{sku}/{location}`, `/api/replenishment/projected-inventory?sku=…&location=…`, `/api/recommendations/{id}/options`, `/api/documents/snippets?sku=…`.
- Writes: `POST /api/recommendations/{id}/state`.

## Permissions
Read for all roles. Approve / reject requires **planner**.

## Common pitfalls
- The policy evidence box can be empty if the document index hasn't been built — visit Documents → Reindex.
