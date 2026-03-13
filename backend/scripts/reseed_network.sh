#!/usr/bin/env bash
# Reseed network data only: clears network_nodes, network_sourcing_rules, network_lanes,
# and related tables; repopulates with demo data (1 plant, 2 CDCs, 5 RDCs, 35 stores, single sourcing).
# Requires the backend API to be running (e.g. uvicorn on port 8000).

set -e
BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
echo "Reseeding network data via ${BASE_URL}/api/network/reseed ..."
curl -s -X POST "${BASE_URL}/api/network/reseed" | python3 -m json.tool
echo "Done."
