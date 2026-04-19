from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    # Tests are written against the un-authenticated API surface. We keep
    # auth disabled at the test layer so they exercise the deterministic
    # synthetic-admin path (which gives the test client all entitlements).
    monkeypatch.setenv("SCP_AUTH_ENABLED", "false")
    from backend.app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def authed_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Like `client` but with auth ENABLED and a logged-in admin session
    cookie pre-attached. Use this for tests that explicitly verify behavior
    behind auth (e.g. role-based access)."""
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    from backend.app.main import app

    with TestClient(app) as test_client:
        # Trigger lifespan + bootstrap admin user
        resp = test_client.post("/auth/login", json={"username": "admin", "password": "admin123"})
        assert resp.status_code == 200, f"bootstrap login failed: {resp.text}"
        yield test_client


@pytest.fixture()
def planner_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    from backend.app.main import app

    with TestClient(app) as test_client:
        resp = test_client.post("/auth/login", json={"username": "planner", "password": "planner"})
        assert resp.status_code == 200
        yield test_client


@pytest.fixture()
def analyst_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    from backend.app.main import app

    with TestClient(app) as test_client:
        resp = test_client.post("/auth/login", json={"username": "analyst", "password": "analyst"})
        assert resp.status_code == 200
        yield test_client


def test_health(client: TestClient):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_dashboard_seeded(client: TestClient):
    response = client.get("/api/dashboard/stockouts")
    payload = response.json()
    assert response.status_code == 200
    assert payload["run_id"] == "RUN-BASELINE-001"
    assert len(payload["recommendations"]) >= 6


def test_scenario_persists(client: TestClient):
    response = client.post(
        "/api/scenarios/evaluate",
        json={
            "scenario_name": "Demand uplift",
            "scope": {},
            "changes": {
                "forecast_multiplier": 1.2,
                "forecast_error_multiplier": 1.2,
                "lead_time_delay_days": 3,
                "supplier_reliability_delta": 0.05,
            },
            "horizon_weeks": 8,
        },
    )
    payload = response.json()
    assert response.status_code == 200
    assert payload["scenario_run_id"].startswith("RUN-SCN-")
    follow_up = client.get("/api/dashboard/stockouts", params={"run_id": payload["scenario_run_id"]})
    assert follow_up.status_code == 200
    assert len(follow_up.json()["recommendations"]) >= 1


def test_parameter_apply_updates_values(client: TestClient):
    response = client.post("/api/parameters/recommendations/PR-1002/apply")
    payload = response.json()
    assert response.status_code == 200
    assert payload["status"] == "applied"
    values = client.get("/api/parameters/effective", params={"sku": "WATER-006", "location": "DC-MIA"}).json()
    assert any(item["parameter_code"] == "safety_stock_qty" and item["effective_value"] == "190" for item in values)


def test_parameter_value_grid_mutations(client: TestClient):
    rows = client.get("/api/parameters/values").json()
    assert rows
    row_id = rows[0]["id"]

    inline = client.patch(
        f"/api/parameters/values/{row_id}",
        json={
            "effective_value": "222",
            "explicit_value": "222",
            "source_type": "manual_override",
            "reason": "Inline test update",
        },
    )
    assert inline.status_code == 200
    assert inline.json()["effective_value"] == "222"

    bulk = client.post(
        "/api/parameters/values/bulk-apply",
        json={
            "record_ids": [row_id],
            "effective_value": "333",
            "source_type": "bulk_override",
            "reason": "Bulk test update",
        },
    )
    assert bulk.status_code == 200
    assert bulk.json()["updated_count"] == 1

    paste = client.post(
        "/api/parameters/values/paste",
        json={
            "rows": [
                {
                    "sku": "CHOC-001",
                    "location": "DC-ATL",
                    "parameter_code": "service_level",
                    "effective_value": "0.97",
                    "source_type": "paste_import",
                    "reason": "Paste test update",
                }
            ]
        },
    )
    assert paste.status_code == 200
    assert paste.json()["updated_count"] + paste.json()["created_count"] >= 1


def test_document_reingest(client: TestClient):
    response = client.post("/api/documents/ingest")
    payload = response.json()
    assert response.status_code == 200
    assert payload["indexed_documents"] >= 3
    assert payload["chunk_count"] >= 3


def test_master_data_options_and_search(client: TestClient):
    options = client.get("/api/master-data/options").json()
    assert any(item["sku"] == "CHOC-001" for item in options["products"])
    assert any(item["code"] == "DC-ATL" for item in options["locations"])
    assert any(item["code"] == "SWEETSOURCE" for item in options["supplier_records"])

    search = client.get("/api/master-data/search", params={"query": "Atlanta"}).json()
    assert any(item["code"] == "DC-ATL" for item in search["locations"])


def test_llm_options_and_document_search(client: TestClient):
    llm = client.get("/api/llm/options").json()
    assert llm["defaults"]["provider"] == "openai"
    assert llm["providers"][0]["models"][0]["id"]

    results = client.get("/api/documents/search", params={"query": "incoterm expedite"}).json()
    assert any("SweetSource" in item["title"] or item["vendor"] == "SweetSource" for item in results["results"])


def test_network_endpoints(client: TestClient):
    baseline = client.get("/api/network/baseline")
    assert baseline.status_code == 200
    payload = baseline.json()
    assert len(payload["nodes"]) >= 50
    assert len(payload["lanes"]) >= 150
    assert len(payload["alerts"]) >= 20

    create = client.post("/api/network/scenarios", json={"scenario_name": "Test Network Scenario", "origin_context": "manual"})
    assert create.status_code == 200
    scenario_id = create.json()["scenario_id"]

    add_node = client.post(
        f"/api/network/scenarios/{scenario_id}/changes",
        json={
            "change_type": "add_node",
            "entity_type": "node",
            "payload": {
                "node_id": "PLANNED-TEST-001",
                "name": "Planned Test Node",
                "node_type": "rdc",
                "region": "NORTHEAST",
                "lat": 36.1,
                "lon": -75.8,
                "status": "planned",
                "storage_capacity": 18000,
                "throughput_limit": 15000,
                "crossdock_capable": True,
                "holding_cost_per_unit": 1.2,
                "handling_cost_per_unit": 1.4,
                "service_level_target": 0.98,
                "production_batch_size": 0,
                "production_freeze_days": 0,
                "cycle_time_days": 0,
                "shelf_space_limit": 0,
                "default_strategy": "pull",
                "metadata_json": "{}",
            },
        },
    )
    assert add_node.status_code == 200

    detail = client.get(f"/api/network/scenarios/{scenario_id}")
    assert detail.status_code == 200
    assert any(item["node_id"] == "PLANNED-TEST-001" for item in detail.json()["nodes"])

    simulation = client.post(f"/api/network/scenarios/{scenario_id}/simulate")
    assert simulation.status_code == 200
    sim_payload = simulation.json()
    assert sim_payload["run_id"].startswith("NET-RUN-")
    assert "service_level" in sim_payload["baseline_metrics"]
    assert len(sim_payload["comparison_cards"]) >= 1

    agent = client.post(
        "/api/network/agent/analyze",
        json={
            "question": "Show me impact of the Florida DC shutdown due to flood on this quarter margins.",
            "scenario_id": scenario_id,
            "llm_provider": "openai",
            "llm_model": "gpt-4.1-mini",
        },
    )
    assert agent.status_code == 200
    assert agent.json()["recommended_option"]

    node_alert = client.get("/api/network/alerts/ALERT-NODE-001/impacted-skus")
    assert node_alert.status_code == 200
    node_payload = node_alert.json()
    assert len(node_payload) >= 1
    assert len({item["sku"] for item in node_payload}) >= 2
    assert all(item["alert_impacted_node_id"] for item in node_payload)

    sku_node_alert = client.get("/api/network/alerts/ALERT-SKUNODE-001/impacted-skus")
    assert sku_node_alert.status_code == 200
    sku_node_payload = sku_node_alert.json()
    assert len(sku_node_payload) >= 1
    target_sku = sku_node_payload[0]["alert_impacted_sku"]
    target_node = sku_node_payload[0]["alert_impacted_node_id"]
    assert all(item["sku"] == target_sku for item in sku_node_payload)
    assert all(item["impacted_node_id"] == target_node for item in sku_node_payload)

    sku_alert = client.get("/api/network/alerts/ALERT-SKU-001/impacted-skus")
    assert sku_alert.status_code == 200
    sku_payload = sku_alert.json()
    assert len(sku_payload) >= 1
    sku_target = sku_payload[0]["alert_impacted_sku"]
    assert all(item["sku"] == sku_target for item in sku_payload)
    assert len({item["impacted_node_id"] for item in sku_payload}) >= 2


def test_replenishment_orders_endpoint(client: TestClient):
    all_orders_response = client.get("/api/replenishment/orders")
    assert all_orders_response.status_code == 200
    all_payload = all_orders_response.json()
    assert len(all_payload["rows"]) >= 1500
    non_exception_count = sum(1 for row in all_payload["rows"] if not row["is_exception"])
    assert non_exception_count >= 1000
    assert all(row["alert_id"] for row in all_payload["rows"][:100])
    assert all(row["sku"] for row in all_payload["rows"][:100])
    assert all(row["ship_to_node_id"] for row in all_payload["rows"][:100])

    exception_response = client.get("/api/replenishment/orders", params={"exception_only": "true"})
    assert exception_response.status_code == 200
    exception_payload = exception_response.json()
    assert len(exception_payload["rows"]) >= 500
    assert all(row["is_exception"] for row in exception_payload["rows"])
    assert all(row["exception_reason"] for row in exception_payload["rows"][:100])


def test_network_view_endpoint(client: TestClient):
    response = client.get("/api/network/view", params={"sku": "CHOC-001", "weeks_of_coverage": 8})
    assert response.status_code == 200
    payload = response.json()
    assert payload["filters"]["weeks_of_coverage_options"] == [4, 8, 12, 16]
    assert len(payload["rows"]) >= 1
    assert all(row["sku"] == "CHOC-001" for row in payload["rows"])
    assert len(payload["graph_nodes"]) >= 1
    assert len(payload["graph_edges"]) >= 1


def test_chatbot_missing_api_key_returns_unavailable(client: TestClient):
    response = client.post(
        "/api/chatbot/query",
        json={
            "message": "Show exception orders by sku and location",
            "llm_provider": "openai",
            "llm_model": "gpt-4.1-mini",
            "openai_api_key": "",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["answer_text"] == "Bot is not available due to missing API key."
    assert payload["can_apply_filters"] is False


def test_dashboard_accepts_multi_value_filters(client: TestClient):
    response = client.get(
        "/api/dashboard/stockouts",
        params=[
            ("sku", "CHOC-001"),
            ("sku", "SNACK-003"),
            ("location", "DC-ATL"),
            ("location", "RDC-003"),
        ],
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["recommendations"] is not None
