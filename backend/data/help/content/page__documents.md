# Documents

## Purpose
The Documents page is full-text search across the corpus of vendor agreements, policy documents, and lead-time documentation that lives under `data/seed/vendor_docs/` and `data/seed/policy_docs/`. Backed by Elasticsearch when configured, with a SQLite LIKE fallback otherwise.

## When to use it
- Verifying a contractual lead time before approving a recommendation.
- Finding the source policy that justifies a parameter value.
- Pulling vendor-provided cost-of-delay clauses for a financial impact calc.

## Layout walkthrough
- Search bar (top), vendor filter dropdown (right of search), Reindex button.
- Results grid: title, vendor, topic, document type, snippet, source path.
- Click a result row → opens the source path (PDF / markdown) in a new tab.

## Key controls explained
| Control | What it does |
|---|---|
| Search box | Free-text query — phrase support, OR/AND defaults to AND. |
| Vendor filter | Restrict to one vendor. |
| **Reindex Docs** | Re-walks the seed directories and re-pushes to Elasticsearch (or rebuilds the SQLite index). Admin only. |

## Data flow
- Reads: `GET /api/documents/search?q=...&vendor=...`.
- Reindex: `POST /api/documents/reindex` — long-running, returns count.
- Documents are stored in the `Document` table; ES index sync via `document_search_service.py`.

## Permissions
Read for all roles. Reindex requires **admin**.

## Common pitfalls
- After uploading a new doc to disk, the index will not pick it up until a Reindex is triggered.
- ES is optional — if it's not running, search falls back to SQLite LIKE which is slower and case-sensitive.
