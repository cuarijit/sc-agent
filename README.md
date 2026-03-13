# MEIO Inventory Optimization MVP

This workspace contains a scaffolded full-stack MVP for a planner-facing MEIO application.

## Backend

- `backend/app/main.py`
- FastAPI API with seeded deterministic planning, scenario, recommendation, parameter-governance, and chat endpoints

Run:

```bash
python3.12 -m uvicorn backend.app.main:app --reload --port 8000
```

## Frontend

- `frontend/`
- React + TypeScript + MUI shell with fixed left nav, fixed top header, routed pages, and global filters
- Layout and visual direction are adapted from `/Users/arijitchoudhuri/ai_app/dcai_ai_agent/ui`

Run:

```bash
cd frontend
npm install
npm run dev
```

## Desktop App (Electron + Local Backend)

The frontend can be distributed as a self-contained desktop app (Windows and macOS) that starts its own local backend API and uses a self-contained SQLite DB.

### What is bundled

- Electron desktop shell (frontend UI)
- Local backend executable (`backend-api.exe` on Windows, `backend-api` on macOS)
- Seed data folder (`backend/data/*`)
- Runtime DB copied to user profile on first launch

### Build Windows installer

```bash
cd frontend
npm install
npm run electron:dist:win
```

Output:

- `release/Zebra MEIO Desktop-Setup-<version>.exe`

Important:

- Build the Windows installer on a Windows machine so the bundled backend executable is `backend-api.exe`.
- Building `electron:dist:win` on macOS/Linux can produce a Windows installer shell but with a non-Windows backend binary, which fails at app startup on Windows.
- Build scripts now include platform guards and will fail fast if run on the wrong OS.

### Build macOS app packages

```bash
cd frontend
npm install
npm run electron:dist:mac
```

Output examples:

- `release/Zebra MEIO Desktop-<version>-arm64.dmg`
- `release/Zebra MEIO Desktop-<version>-x64.dmg`
- matching `.zip` artifacts for each architecture

### Development desktop run

```bash
cd frontend
npm install
npm run electron:dev
```

Notes:

- In dev mode, Electron starts backend via local Python + Uvicorn.
- In packaged mode, Electron starts bundled backend executable for the current OS.
- The desktop app uses `http://127.0.0.1:8000` when running from `file://`.

## Reseeding (replace network / full seed)

To **replace only network data** (network_nodes, network_sourcing_rules, network_lanes, and related tables) with the demo hierarchy (1 plant, 2 CDCs, 5 RDCs, 35 stores, single sourcing), run with the API already up:

```bash
# From project root, API on port 8000
bash backend/scripts/reseed_network.sh
```

Or call the endpoint directly:

```bash
curl -X POST http://127.0.0.1:8000/api/network/reseed
```

To **drop and repopulate all seed data** (products, locations, documents, network, etc.):

```bash
bash backend/scripts/reseed_full.sh
# or: curl -X POST http://127.0.0.1:8000/api/documents/ingest
```

## Tests

```bash
pip install -r backend/requirements.txt
python3.12 -m pytest backend/tests
```

## Docker

```bash
docker compose up --build
```

## Included pages

- Dashboard
- Recommendations
- SKU Detail
- Scenarios
- Parameters
- Parameter Detail
- Planner Chat
