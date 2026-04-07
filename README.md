# Supply Chain Planning and Execution

A full-stack application for Inventory Planning and Optimization, Intelligent Planning (IBP), and Smart Execution.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/cuarijit/sc-agent)

## Quick Start

### Web App (Docker)

```bash
docker compose up --build
```

App available at `http://localhost` (frontend) with API at `http://localhost:8000`.

### Cloud Deploy (Render)

Click the **Deploy to Render** button above, or:

1. Go to [render.com](https://render.com) → **New** → **Blueprint**
2. Select the `cuarijit/sc-agent` repository
3. Click **Deploy Blueprint**
4. Access at `https://supply-chain-planning.onrender.com`

Auto-redeploys on every push to `main`.

### Local Development

```bash
# Backend
python3.12 -m uvicorn backend.app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Frontend at `http://localhost:5174`, API at `http://localhost:8000`.

## Desktop Apps (Electron)

Self-contained desktop apps with bundled backend — no Python or Node.js needed on user machines.

### CI/CD (GitHub Actions)

Desktop apps are built automatically on every push to `main`. Download from the **Actions** tab → **Artifacts**.

To create a GitHub Release with downloadable installers:

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Manual Build

```bash
cd frontend
npm install

# macOS (Apple Silicon)
npm run electron:dist:mac

# Windows (run on Windows)
npm run electron:dist:win
```

### Development Desktop Run

```bash
cd frontend
npm install
npm run electron:dev
```

## Modules

### Intelligent Planning (IBP)
- Demand Planning & Forecasting (with Puls8 360 ADS)
- Collaborative Planning (editable consensus workbench)
- Forecast Accuracy & Exception Management
- S&OP / IBP Cycle Support
- Supply & Inventory Integration
- Financial Planning
- Trade Promotions
- Planning Analytics
- Customer Management

### Smart Execution
- Dashboard & KPIs
- Network Optimization
- Replenishment Planning
- Parameter Governance
- Inventory Projection Workbench
- Scenario Analysis

## Architecture

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, MUI 7, Recharts, Vite |
| Backend | FastAPI, SQLAlchemy, SQLite, Pydantic |
| Desktop | Electron, PyInstaller |
| CI/CD | GitHub Actions → GHCR (Docker) + Electron builds |
| Deploy | Render.com (free tier), Docker Compose |

## Reseeding Data

```bash
# Replace network data only
curl -X POST http://127.0.0.1:8000/api/network/reseed

# Full reseed
curl -X POST http://127.0.0.1:8000/api/documents/ingest
```

## Tests

```bash
pip install -r backend/requirements.txt
python3.12 -m pytest backend/tests
```
