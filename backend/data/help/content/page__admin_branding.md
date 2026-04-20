# Branding & Logos

## Purpose
Branding & Logos manages the three logo slots in the application header + the asset library. Upload customer / company / tenant logos; pick from the library; preview live.

## Layout walkthrough
- Three **LogoSlot** cards, side-by-side or stacked depending on viewport:
  - **Company logo — brand strip LEFT** (e.g. Demand Chain AI mark).
  - **Module / product logo — brand strip LEFT (after divider)** (e.g. Puls8 product mark).
  - **Customer logo — brand strip RIGHT** (per-tenant uploadable customer mark).
- Each slot: current logo preview, "Pick from library / upload" button, "Clear" button (when set).
- **Save Branding** button writes all three; **Refresh** re-reads from server.
- Asset picker dialog: library grid (29 starter assets) + Upload PNG / JPG / SVG / WebP (≤2 MB).

## Step-by-step workflow (upload + assign customer logo)
1. Click **Pick from library / upload** on the Customer slot.
2. In the dialog → click **Upload PNG / JPG / SVG (max 2 MB)** → pick file.
3. The uploaded asset auto-selects into the Customer slot.
4. Click **Save Branding**.
5. The header re-renders immediately (no page refresh) — the page dispatches a `branding:changed` event and the header listens.

## Key controls explained
| Control | What it does |
|---|---|
| Save Branding | PUTs `/admin/branding` with all three tokens. |
| Refresh | GETs `/admin/branding` + `/admin/branding/assets` to undo unsaved edits. |
| Clear | Sets that slot to null (header falls back to text label). |
| Asset row click | Selects that library asset into the active slot. |

## Data flow
- Reads: `GET /admin/branding`, `GET /admin/branding/assets`.
- Writes: `PUT /admin/branding`, `POST /admin/branding/upload` (multipart file).
- Public read for header / login: `GET /api/branding` (no auth).

## Permissions
Admin only for write; the public `/api/branding` is unauthenticated for header rendering.

## Common pitfalls
- Files > 2 MB return 413; downscale before upload.
- Uploaded files are stored under `config/branding/uploads/` and surfaced as `upload:uuid.png` tokens; library files use `library:filename.png`.
