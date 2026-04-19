"""End-to-end auth tests with SCP_AUTH_ENABLED=true.

Exercises:
- login/logout/me/change-password
- session expiry + revoke
- role-based access (admin/planner/analyst)
- entitlement-based gating on existing routes
- bad-password / nonexistent-user / brute-force resilience
- admin user/role/DAG CRUD round-trips
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def fresh_app(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Force-reload backend.app.* modules so each test gets a fresh engine
    bound to its own tmp_path SQLite file. Without this, the SQLAlchemy
    engine is cached at first import and subsequent tests collide."""
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    monkeypatch.setenv("SCP_AUTH_COOKIE_SECURE", "false")
    import sys
    # Drop cached modules so engine + bootstrap re-run for this test.
    for mod_name in list(sys.modules):
        if mod_name.startswith("backend.app"):
            del sys.modules[mod_name]
    from backend.app.main import app  # re-imports + re-creates engine

    with TestClient(app) as client:
        yield client


@pytest.fixture()
def admin(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    return fresh_app


@pytest.fixture()
def planner(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "planner", "password": "planner"})
    assert r.status_code == 200
    return fresh_app


@pytest.fixture()
def analyst(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "analyst", "password": "analyst"})
    assert r.status_code == 200
    return fresh_app


# ----- Phase 1: auth router -----

def test_login_admin_returns_session_and_entitlements(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "admin", "password": "admin123"})
    assert r.status_code == 200
    body = r.json()
    assert body["authenticated"] is True
    assert body["username"] == "admin"
    assert "admin" in body["roles"]
    assert len(body["entitlements"]) >= 50
    # Cookie should be set on the response
    assert any("scp_session" in h for h in r.headers.get("set-cookie", "").split(";"))


def test_login_bad_password_returns_401(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "admin", "password": "wrong"})
    assert r.status_code == 401


def test_login_nonexistent_user_returns_401(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": "nobody", "password": "x"})
    assert r.status_code == 401


def test_login_missing_fields_returns_400(fresh_app: TestClient):
    r = fresh_app.post("/auth/login", json={"username": ""})
    assert r.status_code == 400


def test_me_with_cookie_returns_user(admin: TestClient):
    r = admin.get("/auth/me")
    assert r.status_code == 200
    assert r.json()["username"] == "admin"


def test_me_without_cookie_returns_401(fresh_app: TestClient):
    r = fresh_app.get("/auth/me")
    assert r.status_code == 401


def test_logout_revokes_session(admin: TestClient):
    r1 = admin.get("/auth/me")
    assert r1.status_code == 200
    r2 = admin.post("/auth/logout")
    assert r2.status_code == 200
    r3 = admin.get("/auth/me")
    assert r3.status_code == 401


def test_change_password_round_trip(fresh_app: TestClient):
    fresh_app.post("/auth/login", json={"username": "analyst", "password": "analyst"})
    r1 = fresh_app.post("/auth/change-password", json={
        "currentPassword": "analyst", "newPassword": "newpass456",
    })
    assert r1.status_code == 200
    fresh_app.post("/auth/logout")
    r2 = fresh_app.post("/auth/login", json={"username": "analyst", "password": "analyst"})
    assert r2.status_code == 401  # old password rejected
    r3 = fresh_app.post("/auth/login", json={"username": "analyst", "password": "newpass456"})
    assert r3.status_code == 200


def test_change_password_wrong_current_returns_401(admin: TestClient):
    r = admin.post("/auth/change-password", json={
        "currentPassword": "WRONG", "newPassword": "newpass456",
    })
    assert r.status_code == 401


def test_change_password_too_short_returns_400(admin: TestClient):
    r = admin.post("/auth/change-password", json={
        "currentPassword": "admin123", "newPassword": "x",
    })
    assert r.status_code == 400


def test_brute_force_does_not_500(fresh_app: TestClient):
    """50 wrong-password attempts return 401 each, no 500."""
    for _ in range(50):
        r = fresh_app.post("/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401


# ----- Phase 2: admin router -----

def test_admin_lists_users(admin: TestClient):
    r = admin.get("/admin/users")
    assert r.status_code == 200
    users = {u["username"] for u in r.json()}
    assert {"admin", "planner", "analyst"} <= users


def test_admin_user_crud_round_trip(admin: TestClient):
    # CREATE
    r = admin.post("/admin/users", json={
        "username": "tempuser", "password": "tempPW1!", "name": "Temp", "email": "t@t.com",
        "roles": ["user"],
    })
    assert r.status_code == 201
    uid = r.json()["id"]
    # GET
    r = admin.get(f"/admin/users/{uid}")
    assert r.status_code == 200
    assert r.json()["username"] == "tempuser"
    assert r.json()["roles"] == ["user"]
    # UPDATE PROFILE
    r = admin.post(f"/admin/users/{uid}/profile", json={"name": "Renamed"})
    assert r.status_code == 200
    assert r.json()["name"] == "Renamed"
    # CHANGE ROLE
    r = admin.post(f"/admin/users/{uid}/role", json={"role": "super_user"})
    assert r.status_code == 200
    assert "super_user" in r.json()["roles"]
    # RESET PASSWORD
    r = admin.post(f"/admin/users/{uid}/reset-password", json={"new_password": "ResetPW1!"})
    assert r.status_code == 200
    # DELETE
    r = admin.delete(f"/admin/users/{uid}")
    assert r.status_code == 200
    r = admin.get(f"/admin/users/{uid}")
    assert r.status_code == 404


def test_admin_role_crud_round_trip(admin: TestClient):
    r = admin.post("/admin/roles", json={"name": "viewer", "entitlements": ["page.dashboard"]})
    assert r.status_code == 201
    rid = r.json()["id"]
    # PUT add entitlement
    r = admin.put(f"/admin/roles/{rid}", json={"entitlements": ["page.dashboard", "page.replenishment"]})
    assert r.status_code == 200
    assert sorted(r.json()["entitlements"]) == ["page.dashboard", "page.replenishment"]
    # DELETE
    r = admin.delete(f"/admin/roles/{rid}")
    assert r.status_code == 200


def test_cannot_delete_system_role(admin: TestClient):
    roles = admin.get("/admin/roles").json()
    admin_role = next(r for r in roles if r["name"] == "admin")
    r = admin.delete(f"/admin/roles/{admin_role['id']}")
    assert r.status_code == 400


def test_admin_dag_crud_with_user_assignment(admin: TestClient):
    # Create DAG
    r = admin.post("/admin/data-access-groups", json={"name": "NORAM", "description": "North America"})
    assert r.status_code == 201
    # Create test user
    u = admin.post("/admin/users", json={
        "username": "dagtest", "password": "test12345", "roles": ["user"],
    }).json()
    # Assign DAG
    r = admin.post(f"/admin/users/{u['id']}/data-access-groups", json={"groups": ["NORAM"]})
    assert r.status_code == 200
    assert "NORAM" in r.json()["data_access_groups"]
    # Cleanup
    admin.delete(f"/admin/users/{u['id']}")


def test_planner_blocked_from_admin_users(planner: TestClient):
    assert planner.get("/admin/users").status_code == 403


def test_analyst_blocked_from_admin_users(analyst: TestClient):
    assert analyst.get("/admin/users").status_code == 403


def test_admin_lists_50plus_entitlements(admin: TestClient):
    r = admin.get("/admin/entitlements")
    assert r.status_code == 200
    assert len(r.json()) >= 50


# ----- Phase 3: existing-route gating via middleware -----

def test_logged_out_blocked_from_dashboard(fresh_app: TestClient):
    assert fresh_app.get("/api/dashboard/stockouts").status_code == 401


def test_logged_out_blocked_from_network_baseline(fresh_app: TestClient):
    assert fresh_app.get("/api/network/baseline").status_code == 401


def test_logged_out_blocked_from_agent_templates(fresh_app: TestClient):
    assert fresh_app.get("/admin/agent-templates").status_code == 401


def test_logged_out_blocked_from_inventory_diagnostic(fresh_app: TestClient):
    r = fresh_app.post("/api/inventory-diagnostic/query", json={})
    assert r.status_code == 401


def test_admin_can_hit_dashboard(admin: TestClient):
    assert admin.get("/api/dashboard/stockouts").status_code == 200


def test_analyst_blocked_from_create_agent_instance(analyst: TestClient):
    r = analyst.post("/admin/agent-instances", json={"agent_type": "x"})
    assert r.status_code == 403


def test_admin_can_create_agent_instance(admin: TestClient):
    # Need real payload; this tests entitlement passes (will likely 400 from validation, NOT 403)
    r = admin.post("/admin/agent-instances", json={})
    assert r.status_code != 403  # entitlement check passed


# ----- Public endpoints -----

def test_health_is_public(fresh_app: TestClient):
    assert fresh_app.get("/api/health").status_code == 200


def test_branding_is_public(fresh_app: TestClient):
    r = fresh_app.get("/api/branding")
    assert r.status_code == 200
    assert "app_name" in r.json()


def test_help_is_public(fresh_app: TestClient):
    r = fresh_app.get("/api/help/page__dashboard")
    assert r.status_code == 200


def test_help_invalid_slug_returns_400(fresh_app: TestClient):
    r = fresh_app.get("/api/help/invalid-slug-with-dashes")
    assert r.status_code == 400


def test_help_nonexistent_returns_404(fresh_app: TestClient):
    r = fresh_app.get("/api/help/page__nonexistent_xyz")
    assert r.status_code == 404


# ----- Schema -----

def test_password_hash_uses_pbkdf2_sha256(admin: TestClient):
    """Verify password hash format via SQLAlchemy ORM through the API session."""
    from backend.app.database import SessionLocal
    from sqlalchemy import text as _t
    db = SessionLocal()
    try:
        row = db.execute(_t("SELECT password_hash FROM users WHERE username='admin'")).first()
        assert row is not None
        assert row[0].startswith("pbkdf2_sha256$310000$")
    finally:
        db.close()


def test_three_system_roles_seeded(admin: TestClient):
    roles = admin.get("/admin/roles").json()
    system_roles = [r for r in roles if r["is_system"]]
    assert len(system_roles) == 3
    names = {r["name"] for r in system_roles}
    assert names == {"admin", "super_user", "user"}


def test_entitlement_catalog_seeded(admin: TestClient):
    ents = admin.get("/admin/entitlements").json()
    assert len(ents) >= 50


def test_admin_role_has_all_entitlements(admin: TestClient):
    roles = admin.get("/admin/roles").json()
    ents = admin.get("/admin/entitlements").json()
    admin_role = next(r for r in roles if r["name"] == "admin")
    assert len(admin_role["entitlements"]) == len(ents)


# ----- Concurrent sessions + revoke-all -----

def test_two_concurrent_sessions(fresh_app: TestClient):
    """Two TestClients can each log in admin and both work independently."""
    from backend.app.main import app
    with TestClient(app) as c1, TestClient(app) as c2:
        r1 = c1.post("/auth/login", json={"username": "admin", "password": "admin123"})
        r2 = c2.post("/auth/login", json={"username": "admin", "password": "admin123"})
        assert r1.status_code == 200 and r2.status_code == 200
        assert c1.get("/auth/me").status_code == 200
        assert c2.get("/auth/me").status_code == 200
        # c1 logout doesn't affect c2
        c1.post("/auth/logout")
        assert c1.get("/auth/me").status_code == 401
        assert c2.get("/auth/me").status_code == 200


# ----- TTL expiry -----

def test_session_ttl_expiry(tmp_path, monkeypatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    monkeypatch.setenv("SCP_AUTH_SESSION_TTL_SECONDS", "1")
    from backend.app.main import app
    with TestClient(app) as c:
        r = c.post("/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        assert c.get("/auth/me").status_code == 200
        time.sleep(2)
        assert c.get("/auth/me").status_code == 401


# ----- DAG and user-assignment full round-trip -----

def test_cors_strict_when_origins_configured(tmp_path, monkeypatch):
    """When SCP_CORS_ORIGINS is set, cross-origin requests from disallowed
    origins must NOT receive Access-Control-Allow-Origin echoing the bad origin."""
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    monkeypatch.setenv("SCP_CORS_ORIGINS", "http://allowed.example.com")
    import sys
    for mod_name in list(sys.modules):
        if mod_name.startswith("backend.app"):
            del sys.modules[mod_name]
    from backend.app.main import app

    with TestClient(app) as c:
        # Preflight from disallowed origin
        r = c.options("/api/dashboard/stockouts", headers={
            "Origin": "http://evil.com",
            "Access-Control-Request-Method": "GET",
        })
        # Disallowed origin must not be echoed back
        ac_origin = r.headers.get("access-control-allow-origin", "")
        assert ac_origin != "http://evil.com"
        # Preflight from allowed origin should be echoed
        r2 = c.options("/api/dashboard/stockouts", headers={
            "Origin": "http://allowed.example.com",
            "Access-Control-Request-Method": "GET",
        })
        assert r2.headers.get("access-control-allow-origin") == "http://allowed.example.com"


def test_cookie_secure_flag_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("ASC_DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")
    monkeypatch.setenv("SCP_AUTH_ENABLED", "true")
    monkeypatch.setenv("SCP_AUTH_COOKIE_SECURE", "true")
    import sys
    for mod_name in list(sys.modules):
        if mod_name.startswith("backend.app"):
            del sys.modules[mod_name]
    from backend.app.main import app

    with TestClient(app) as c:
        r = c.post("/auth/login", json={"username": "admin", "password": "admin123"})
        assert r.status_code == 200
        cookie = r.headers.get("set-cookie", "")
        assert "Secure" in cookie
        assert "HttpOnly" in cookie
        assert "SameSite=lax" in cookie.lower() or "samesite=lax" in cookie.lower()


def test_cookie_httponly_flag_set(admin: TestClient):
    """Even with SCP_AUTH_COOKIE_SECURE=false, HttpOnly should always be set."""
    # admin fixture already logged in. Re-login to capture set-cookie header.
    r = admin.post("/auth/login", json={"username": "admin", "password": "admin123"})
    cookie = r.headers.get("set-cookie", "")
    assert "HttpOnly" in cookie


def test_user_dag_assignment_appears_in_get_user(admin: TestClient):
    admin.post("/admin/data-access-groups", json={"name": "EMEA"})
    u = admin.post("/admin/users", json={
        "username": "emeauser", "password": "test12345", "roles": ["user"],
    }).json()
    admin.post(f"/admin/users/{u['id']}/data-access-groups", json={"groups": ["EMEA"]})
    r = admin.get(f"/admin/users/{u['id']}")
    assert r.status_code == 200
    assert "EMEA" in r.json()["data_access_groups"]
    admin.delete(f"/admin/users/{u['id']}")


# ----- LLM-path / inventory diagnostic with auth context -----

def test_inventory_diagnostic_agent_runs_under_auth(admin: TestClient):
    """Logged-in admin can run a diagnostic query. No LLM keys needed —
    the agent has a deterministic fallback path."""
    # Seed the demo data first
    seed = admin.post("/admin/inventory-diagnostic/seed-demo")
    assert seed.status_code == 200
    summary = seed.json()["summary"]
    assert "rows" in summary
    # Run a query
    r = admin.post("/api/inventory-diagnostic/query", json={
        "instance_id": "inventory-diagnostic-demo",
        "message": "show inventory for BAR-002",
    })
    assert r.status_code == 200
    body = r.json()
    assert "run_id" in body
    assert body["intent_mode"] in {"show", "diagnose", "solve", "simulate", "execute"}
    assert "structured" in body
    assert "narrative" in body
    # Verify the run was recorded
    run_id = body["run_id"]
    r2 = admin.get(f"/api/inventory-diagnostic/runs/{run_id}")
    assert r2.status_code == 200


def test_analyst_can_query_but_cannot_dispatch(fresh_app: TestClient):
    """Analyst can read diagnostic queries (page entitlement) but cannot
    dispatch action plans (action entitlement). Single fresh_app so both
    sessions share the same DB (where seed-demo lives)."""
    # Login as admin to seed demo
    fresh_app.post("/auth/login", json={"username": "admin", "password": "admin123"})
    fresh_app.post("/admin/inventory-diagnostic/seed-demo")
    fresh_app.post("/auth/logout")
    # Login as analyst
    fresh_app.post("/auth/login", json={"username": "analyst", "password": "analyst"})
    # Analyst can query
    r = fresh_app.post("/api/inventory-diagnostic/query", json={
        "instance_id": "inventory-diagnostic-demo",
        "message": "show inventory",
    })
    assert r.status_code == 200, r.text
    # Analyst tries to dispatch a fake plan (should be 403 from entitlement, not 404)
    r = fresh_app.post("/api/inventory-diagnostic/action-plans/fake-plan-id/dispatch")
    assert r.status_code == 403
