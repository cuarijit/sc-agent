# Documentation Management

## Purpose
Documentation Management is the in-app authoring surface for every help / user-guide markdown document the application serves. Each entry has metadata (title, type, route_path, parent, order, icon) and a markdown body. Edits go live immediately — no rebuild, no restart.

## Layout walkthrough
- **Left sidebar tree**: hierarchy of entries grouped by parent_id and sorted by order. Click → loads the entry into the right pane.
- **Right pane**: tabbed editor with three tabs — **Preview**, **Edit Markdown**, **Metadata**.
- **Top bar**: + New Entry, Delete, Refresh.

## Tabs / sub-sections (right pane)

### Preview
Read-only rendered markdown — what the in-app help drawer + Customer pages will show.

### Edit Markdown
Plain markdown editor + an **Upload .md** button that replaces the body from a file picker.

### Metadata
Form: id (read-only), type (module / page / tab / reference), title, description, icon, route_path, parent_id, order.

## Step-by-step workflow (upload a .md for an existing entry)
1. Click the entry in the left tree (e.g. `customer-highlights`).
2. Switch to **Edit Markdown** tab.
3. Click **Upload .md** → pick file (≤ 512 KB, must be UTF-8 markdown / text).
4. Editor swaps to the uploaded content.
5. Click **Save** → POSTs `/admin/help/upload/{entry_id}` (multipart) — the change is live for users immediately.

## Step-by-step workflow (create a new entry)
1. Click **+ New Entry**.
2. Set id (e.g. `page__my_new_page`), type, title, description, route_path (e.g. `/my-new-page`).
3. Save → entry appears in the tree.
4. Switch to Edit Markdown → write or upload content → Save.

## Key controls explained
| Control | What it does |
|---|---|
| Tree click | Loads the entry. |
| Upload .md | Replaces content from a file. |
| Save (Edit / Metadata) | Persists changes; live immediately. |
| Delete | Removes the manifest entry + the .md file from disk. |
| route_path | Drives in-app help auto-resolution; longest-prefix match wins. |

## Data flow
- Reads: `GET /admin/help/manifest`, `GET /admin/help/content/{entry_id}`.
- Writes: `PUT /admin/help/manifest`, `PUT /admin/help/content/{entry_id}`, `POST /admin/help/entry`, `DELETE /admin/help/entry/{entry_id}`, `POST /admin/help/upload/{entry_id}`.
- Storage: filesystem at `backend/data/help/help_manifest.json` + `backend/data/help/content/*.md`.

## Permissions
Admin only.

## Common pitfalls
- The seed will not overwrite admin edits — once you save an entry, the next backend boot leaves it alone.
- Deleting an entry deletes its .md file too; copy the content first if you want a backup.
- An entry's route_path can be empty (reference type) — those entries are not auto-resolved by the help drawer.
