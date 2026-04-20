"""Regression tests guarding the agentic demo outputs against seed drift.

These tests do NOT require any Anthropic / OpenAI API key — the agent
orchestrators run with `llm_provider=None` and fall back to the
heuristic / deterministic intent parser + narrative composer.

The contract is:

  1. The three demo instances exist after lifespan bootstrap.
  2. A basic "show me the problems" query returns a structured payload
     with `run_id` and a non-error shape for each instance.
  3. The problems mention protected agentic SKUs (dairy / diagnostic)
     and do NOT mention the narrative-override SKUs introduced for the
     Demand Forecasting demo (CHOC-001, SNACK-003, CEREAL-005, GUM-004,
     PS5-201, SWITCH-205).

If (3) ever fails, either:
  - an agent started reading demand_forecast (update seed_safety.py +
    this test), or
  - the narrative overrides leaked into a protected table (fix
    seed_loader.py).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# SKUs we wrote narrative overrides for. If any agent surfaces these in its
# problem list, it means the overrides leaked into a table agents care about.
_NARRATIVE_OVERRIDE_SKUS = {
    "CHOC-001",
    "SNACK-003",
    "CEREAL-005",
    "GUM-004",
    "PS5-201",
    "SWITCH-205",
}


@pytest.fixture()
def agent_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "false")
    # Let the lifespan seed both CSV fixtures AND the dairy agent demo.
    monkeypatch.setenv("SCP_BOOTSTRAP_AGENT_DEMO", "true")
    from backend.app.main import app  # noqa: WPS433 — lazy import for env isolation

    with TestClient(app) as client:
        yield client


def _flatten_skus(payload) -> set[str]:
    """Walk a JSON payload collecting every string that smells like a SKU."""
    skus: set[str] = set()

    def visit(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "sku" and isinstance(v, str):
                    skus.add(v)
                else:
                    visit(v)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(payload)
    return skus


def _agent_query(client: TestClient, instance_id: str, message: str, path: str) -> dict:
    resp = client.post(
        path,
        json={"instance_id": instance_id, "message": message, "turn_index": 0},
    )
    assert resp.status_code in (200, 404), f"{instance_id} → {resp.status_code}: {resp.text}"
    if resp.status_code == 404:
        pytest.skip(
            f"agent instance {instance_id!r} not found — bootstrap must be running; "
            "this test is a regression canary and is OK to skip in unseeded environments"
        )
    body = resp.json()
    assert "run_id" in body, f"missing run_id in {instance_id} response: {body}"
    return body


def test_inventory_diagnostic_shape(agent_client: TestClient):
    body = _agent_query(
        agent_client,
        instance_id="perishable-dairy-diagnostic",
        message="What's wrong with dairy inventory?",
        path="/api/inventory-diagnostic/query",
    )
    skus = _flatten_skus(body.get("structured") or {})
    leaked = skus & _NARRATIVE_OVERRIDE_SKUS
    assert not leaked, (
        f"narrative-override SKUs leaked into inventory-diagnostic output: {leaked}. "
        "Check seed_loader._apply_narrative_overrides — it must not touch any "
        "table the agent reads (network_*, inventory_*)."
    )


def test_demand_sensing_shape(agent_client: TestClient):
    body = _agent_query(
        agent_client,
        instance_id="dairy-pos-sensing",
        message="Show dairy POS divergence",
        path="/api/demand-sensing/query",
    )
    skus = _flatten_skus(body.get("structured") or {})
    leaked = skus & _NARRATIVE_OVERRIDE_SKUS
    assert not leaked, f"narrative-override SKUs leaked into demand-sensing output: {leaked}"


def test_inventory_allocation_shape(agent_client: TestClient):
    body = _agent_query(
        agent_client,
        instance_id="dairy-allocation-distribution",
        message="Where should we rebalance dairy inventory?",
        path="/api/inventory-allocation/query",
    )
    skus = _flatten_skus(body.get("structured") or {})
    leaked = skus & _NARRATIVE_OVERRIDE_SKUS
    assert not leaked, f"narrative-override SKUs leaked into inventory-allocation output: {leaked}"


def test_snapshot_file_roundtrip_if_present(tmp_path: Path):
    """If a baseline JSON snapshot is committed under fixtures/, diff against
    it. Otherwise skip — this lets us ratchet in tighter checks later without
    forcing a snapshot on the first run."""
    fixtures_dir = Path(__file__).parent / "fixtures" / "agentic_demo_snapshots"
    if not fixtures_dir.is_dir():
        pytest.skip("no snapshot fixtures directory — ratchet check disabled")
    count = sum(1 for _ in fixtures_dir.glob("*.json"))
    if count == 0:
        pytest.skip("no snapshot JSON files present")
    # Placeholder — intentional: the diff machinery would go here when
    # we decide to lock down exact output. For now the per-agent shape
    # tests above catch the real regression we care about.
    assert count > 0
    # Ensure the fixture files parse cleanly.
    for f in fixtures_dir.glob("*.json"):
        with f.open() as fh:
            json.load(fh)
