#!/usr/bin/env bash
# Full reseed: drops and repopulates all seed data (products, locations, documents, network, etc.).
# Requires the backend API to be running (e.g. uvicorn on port 8000).

set -e
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
echo "Full reseed via ${BASE_URL}/api/documents/ingest ..."
curl -s -X POST "${BASE_URL}/api/documents/ingest" | python3 -m json.tool
echo "Done."
