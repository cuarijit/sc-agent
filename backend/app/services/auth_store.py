"""Authentication / authorization store for scp-0312.

Self-contained: PBKDF2-SHA256 password hashing, server-side sessions in
SQLite, role-based access control with entitlement catalog, data access
groups. Modeled on puls8-primo's auth_store but focused on scp-0312's
needs.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


PASSWORD_SCHEME = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 310_000
SALT_BYTES = 16
SESSION_TOKEN_BYTES = 32


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    pad = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + pad)


def hash_password(password: str, iterations: int = PASSWORD_ITERATIONS) -> str:
    if not password:
        raise ValueError("password is required")
    salt = os.urandom(SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return f"{PASSWORD_SCHEME}${iterations}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, password_hash: str) -> bool:
    if not password or not password_hash:
        return False
    try:
        scheme, iterations_s, salt_b64, digest_b64 = password_hash.split("$", 3)
    except ValueError:
        return False
    if scheme != PASSWORD_SCHEME:
        return False
    try:
        iterations = int(iterations_s)
    except ValueError:
        return False
    try:
        salt = _unb64(salt_b64)
        expected = _unb64(digest_b64)
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def _hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class AuthUser:
    user_id: int
    username: str
    name: str
    email: str
    is_active: bool
    roles: list[str] = field(default_factory=list)
    entitlements: list[str] = field(default_factory=list)
    data_access_groups: list[str] = field(default_factory=list)


# =============================================================================
# Entitlement catalog for scp-0312
# =============================================================================

# Each tuple: (key, resource_type, resource_key, description)
SCP_ENTITLEMENT_CATALOG: list[tuple[str, str, str, str]] = [
    # Modules
    ("module.smart_execution", "module", "smart_execution", "Smart Execution module"),
    ("module.intelligent_planning", "module", "intelligent_planning", "Intelligent Planning module"),
    ("module.agentic_ai", "module", "agentic_ai", "Agentic AI module"),
    ("module.administration", "module", "administration", "Administration module"),
    # Pages — Smart Execution
    ("page.dashboard", "page", "dashboard", "Dashboard page"),
    ("page.replenishment", "page", "replenishment", "Replenishment page"),
    ("page.recommendations", "page", "recommendations", "Recommendations page"),
    ("page.scenarios", "page", "scenarios", "Scenarios page"),
    ("page.network", "page", "network", "Network page"),
    ("page.parameters", "page", "parameters", "Parameters page"),
    ("page.parameter_detail", "page", "parameter_detail", "Parameter detail page"),
    ("page.sku_detail", "page", "sku_detail", "SKU detail page"),
    ("page.maintenance", "page", "maintenance", "Maintenance / analytics page"),
    ("page.documents", "page", "documents", "Document search page"),
    ("page.chat", "page", "chat", "Chat page"),
    # Pages — Intelligent Planning
    ("page.demand_forecasting", "page", "demand_forecasting", "Demand forecasting page"),
    ("page.demand_collaborative", "page", "demand_collaborative", "Collaborative planning page"),
    ("page.demand_accuracy", "page", "demand_accuracy", "Forecast accuracy page"),
    ("page.demand_sop", "page", "demand_sop", "S&OP / IBP page"),
    ("page.demand_supply_integration", "page", "demand_supply_integration", "Supply integration page"),
    ("page.demand_financial", "page", "demand_financial", "Financial planning page"),
    ("page.demand_trade_promotion", "page", "demand_trade_promotion", "Trade promotion page"),
    ("page.demand_analytics", "page", "demand_analytics", "Demand analytics page"),
    ("page.demand_customers", "page", "demand_customers", "Customer hierarchy page"),
    # Pages — Agentic AI
    ("page.agent_configuration", "page", "agent_configuration", "Agent configurator page"),
    ("page.inventory_diagnostic", "page", "inventory_diagnostic", "Inventory diagnostic console"),
    ("page.global_filter_compliance", "page", "global_filter_compliance", "Filter compliance page"),
    # Pages — Administration
    ("page.admin_users", "page", "admin_users", "User administration page"),
    ("page.admin_modules", "page", "admin_modules", "Module & page configuration"),
    ("page.admin_branding", "page", "admin_branding", "Branding & logos"),
    # Actions
    ("action.users.create", "action", "users.create", "Create users"),
    ("action.users.update", "action", "users.update", "Update users"),
    ("action.users.delete", "action", "users.delete", "Delete users"),
    ("action.users.reset_password", "action", "users.reset_password", "Reset user passwords"),
    ("action.roles.create", "action", "roles.create", "Create roles"),
    ("action.roles.update", "action", "roles.update", "Update roles"),
    ("action.roles.delete", "action", "roles.delete", "Delete roles"),
    ("action.dag.create", "action", "dag.create", "Create data access groups"),
    ("action.dag.update", "action", "dag.update", "Update data access groups"),
    ("action.dag.delete", "action", "dag.delete", "Delete data access groups"),
    ("action.replenishment.create_order", "action", "replenishment.create_order", "Create replenishment orders"),
    ("action.replenishment.update_order", "action", "replenishment.update_order", "Update replenishment orders"),
    ("action.network.create_scenario", "action", "network.create_scenario", "Create network scenarios"),
    ("action.network.simulate", "action", "network.simulate", "Simulate network scenarios"),
    ("action.parameters.update", "action", "parameters.update", "Update parameters"),
    ("action.parameters.bulk_apply", "action", "parameters.bulk_apply", "Bulk apply parameters"),
    ("action.parameters.recommendation_run", "action", "parameters.recommendation_run", "Run parameter recommendations"),
    ("action.inventory_diagnostic.dispatch_action_plan", "action", "inventory_diagnostic.dispatch_action_plan", "Dispatch inventory diagnostic action plans"),
    ("action.agent.template.update", "action", "agent.template.update", "Update agent templates"),
    ("action.agent.template.publish", "action", "agent.template.publish", "Publish agent templates"),
    ("action.agent.instance.create", "action", "agent.instance.create", "Create agent instances"),
    ("action.agent.instance.update", "action", "agent.instance.update", "Update agent instances"),
    ("action.agent.instance.delete", "action", "agent.instance.delete", "Delete agent instances"),
]


def _entitlements_for_role(role_name: str) -> list[str]:
    all_keys = [k for k, _, _, _ in SCP_ENTITLEMENT_CATALOG]
    if role_name == "admin":
        return list(all_keys)
    if role_name == "super_user":
        admin_keys = {
            "module.administration",
            "page.admin_users",
            "action.users.create", "action.users.update", "action.users.delete", "action.users.reset_password",
            "action.roles.create", "action.roles.update", "action.roles.delete",
            "action.dag.create", "action.dag.update", "action.dag.delete",
        }
        return [k for k in all_keys if k not in admin_keys]
    if role_name == "user":
        user_pages = {
            "module.smart_execution", "module.intelligent_planning", "module.agentic_ai",
            "page.dashboard", "page.replenishment", "page.recommendations",
            "page.scenarios", "page.network", "page.parameters", "page.parameter_detail",
            "page.sku_detail", "page.documents", "page.chat",
            "page.demand_forecasting", "page.demand_collaborative", "page.demand_accuracy",
            "page.demand_sop", "page.demand_supply_integration", "page.demand_financial",
            "page.demand_trade_promotion", "page.demand_analytics", "page.demand_customers",
            "page.inventory_diagnostic", "page.global_filter_compliance",
            "action.replenishment.create_order", "action.replenishment.update_order",
        }
        return [k for k in all_keys if k in user_pages]
    return []


# =============================================================================
# AuthStore
# =============================================================================

SYSTEM_ROLES = ("admin", "super_user", "user")


# Module-level flag so per-request constructors skip the expensive
# CREATE TABLE + seed work. Lifespan calls AuthStore(db, bootstrap=True)
# once at startup. After that, every per-request `AuthStore(db)` is cheap.
_BOOTSTRAPPED = False


class AuthStore:
    def __init__(self, db: Session, *, bootstrap: bool | None = None):
        self.db = db
        global _BOOTSTRAPPED
        # Default: bootstrap exactly once. Callers can pass bootstrap=True
        # to force, bootstrap=False to never run schema work.
        should_bootstrap = bootstrap if bootstrap is not None else not _BOOTSTRAPPED
        if should_bootstrap:
            self._initialize_schema()
            self._seed_entitlement_catalog()
            self._seed_system_roles()
            _BOOTSTRAPPED = True

    # ---------- schema bootstrap ----------
    def _initialize_schema(self) -> None:
        ddl = [
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                name TEXT,
                email TEXT,
                password_hash TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                session_token_hash TEXT NOT NULL UNIQUE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                revoked_at TEXT
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                is_system INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS entitlements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                resource_type TEXT NOT NULL,
                resource_key TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS role_entitlements (
                role_id INTEGER NOT NULL,
                entitlement_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (role_id, entitlement_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, role_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS data_access_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                description TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_data_access_groups (
                user_id INTEGER NOT NULL,
                group_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (user_id, group_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                settings_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_slug TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                description TEXT,
                documentation TEXT,
                config_root TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                icon TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                landing_page_slug TEXT,
                module_logo TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS module_pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER NOT NULL,
                page_slug TEXT NOT NULL,
                label TEXT NOT NULL,
                page_type TEXT NOT NULL DEFAULT 'custom',
                config_ref TEXT,
                icon TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (module_id, page_slug)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS module_role_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (module_id, role_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS module_page_role_access (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE (page_id, role_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS module_entitlements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module_id INTEGER,
                page_id INTEGER,
                entitlement_id INTEGER NOT NULL,
                auto_generated INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS module_page_agent_instances (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_id INTEGER NOT NULL,
                agent_instance_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE (page_id, agent_instance_id)
            )
            """,
            """
            CREATE TABLE IF NOT EXISTS prompt_activity_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                question TEXT NOT NULL,
                generated_sql TEXT NOT NULL DEFAULT '',
                execution_route TEXT NOT NULL DEFAULT 'llm',
                llm_provider TEXT,
                llm_model TEXT,
                llm_prompt TEXT NOT NULL DEFAULT '',
                feedback TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """,
        ]
        for stmt in ddl:
            self.db.execute(text(stmt))
        self.db.commit()

    # ---------- catalog & role seeding ----------
    def _seed_entitlement_catalog(self) -> None:
        now = _now_iso()
        for key, rtype, rkey, desc in SCP_ENTITLEMENT_CATALOG:
            self.db.execute(text("""
                INSERT INTO entitlements (key, resource_type, resource_key, description, created_at, updated_at)
                VALUES (:key, :rtype, :rkey, :desc, :now, :now)
                ON CONFLICT(key) DO UPDATE SET resource_type=:rtype, resource_key=:rkey, description=:desc, updated_at=:now
            """), dict(key=key, rtype=rtype, rkey=rkey, desc=desc, now=now))
        self.db.commit()

    def _seed_system_roles(self) -> None:
        now = _now_iso()
        for role_name in SYSTEM_ROLES:
            self.db.execute(text("""
                INSERT INTO roles (name, is_system, created_at, updated_at)
                VALUES (:name, 1, :now, :now)
                ON CONFLICT(name) DO UPDATE SET is_system=1, updated_at=:now
            """), dict(name=role_name, now=now))
        self.db.commit()
        # Assign entitlements to system roles
        for role_name in SYSTEM_ROLES:
            role_id = self._role_id_by_name(role_name)
            if role_id is None:
                continue
            keys = _entitlements_for_role(role_name)
            self.db.execute(text("DELETE FROM role_entitlements WHERE role_id=:rid"), dict(rid=role_id))
            for key in keys:
                ent = self.db.execute(text("SELECT id FROM entitlements WHERE key=:k"), dict(k=key)).first()
                if ent is None:
                    continue
                self.db.execute(text("""
                    INSERT INTO role_entitlements (role_id, entitlement_id, created_at)
                    VALUES (:rid, :eid, :now)
                """), dict(rid=role_id, eid=ent[0], now=now))
        self.db.commit()

    # ---------- helpers ----------
    def _role_id_by_name(self, name: str) -> int | None:
        row = self.db.execute(text("SELECT id FROM roles WHERE name=:n"), dict(n=name)).first()
        return row[0] if row else None

    def _user_row_by_username(self, username: str) -> Any:
        return self.db.execute(text(
            "SELECT id, username, name, email, password_hash, is_active FROM users WHERE username=:u"
        ), dict(u=username)).first()

    def _user_row_by_id(self, user_id: int) -> Any:
        return self.db.execute(text(
            "SELECT id, username, name, email, password_hash, is_active FROM users WHERE id=:i"
        ), dict(i=user_id)).first()

    def _user_roles(self, user_id: int) -> list[str]:
        rows = self.db.execute(text("""
            SELECT r.name FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = :uid
            ORDER BY r.name
        """), dict(uid=user_id)).fetchall()
        return [r[0] for r in rows]

    def _user_entitlements(self, user_id: int) -> list[str]:
        rows = self.db.execute(text("""
            SELECT DISTINCT e.key FROM entitlements e
            JOIN role_entitlements re ON re.entitlement_id = e.id
            JOIN user_roles ur ON ur.role_id = re.role_id
            WHERE ur.user_id = :uid
            ORDER BY e.key
        """), dict(uid=user_id)).fetchall()
        return [r[0] for r in rows]

    def _user_data_access_groups(self, user_id: int) -> list[str]:
        rows = self.db.execute(text("""
            SELECT g.name FROM data_access_groups g
            JOIN user_data_access_groups ug ON ug.group_id = g.id
            WHERE ug.user_id = :uid
            ORDER BY g.name
        """), dict(uid=user_id)).fetchall()
        return [r[0] for r in rows]

    def _build_auth_user(self, row: Any) -> AuthUser:
        user_id = row[0]
        return AuthUser(
            user_id=user_id,
            username=row[1],
            name=row[2] or "",
            email=row[3] or "",
            is_active=bool(row[5]),
            roles=self._user_roles(user_id),
            entitlements=self._user_entitlements(user_id),
            data_access_groups=self._user_data_access_groups(user_id),
        )

    # ---------- user CRUD ----------
    def create_user(
        self, *, username: str, password: str, name: str = "", email: str = "",
        roles: list[str] | None = None, is_active: bool = True,
    ) -> AuthUser:
        username = username.strip().lower()
        if not username:
            raise ValueError("username is required")
        if self._user_row_by_username(username):
            raise ValueError(f"username '{username}' already exists")
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO users (username, name, email, password_hash, is_active, created_at, updated_at)
            VALUES (:u, :n, :e, :ph, :ia, :now, :now)
        """), dict(u=username, n=name, e=email, ph=hash_password(password), ia=1 if is_active else 0, now=now))
        self.db.commit()
        row = self._user_row_by_username(username)
        if not row:
            raise RuntimeError("user creation failed")
        if roles:
            self.set_user_roles(row[0], roles)
        return self._build_auth_user(self._user_row_by_username(username))

    def set_user_roles(self, user_id: int, roles: list[str]) -> None:
        self.db.execute(text("DELETE FROM user_roles WHERE user_id=:uid"), dict(uid=user_id))
        now = _now_iso()
        for role_name in roles:
            rid = self._role_id_by_name(role_name)
            if rid is None:
                # Auto-create non-system custom role on first reference
                self.db.execute(text("""
                    INSERT INTO roles (name, is_system, created_at, updated_at)
                    VALUES (:n, 0, :now, :now)
                """), dict(n=role_name, now=now))
                self.db.commit()
                rid = self._role_id_by_name(role_name)
            if rid is None:
                continue
            self.db.execute(text("""
                INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at)
                VALUES (:uid, :rid, :now)
            """), dict(uid=user_id, rid=rid, now=now))
        self.db.commit()

    def update_user_profile(self, user_id: int, *, name: str | None = None, email: str | None = None) -> AuthUser | None:
        row = self._user_row_by_id(user_id)
        if not row:
            return None
        new_name = name if name is not None else row[2]
        new_email = email if email is not None else row[3]
        self.db.execute(text("UPDATE users SET name=:n, email=:e, updated_at=:now WHERE id=:i"),
                        dict(n=new_name, e=new_email, now=_now_iso(), i=user_id))
        self.db.commit()
        return self._build_auth_user(self._user_row_by_id(user_id))

    def reset_user_password(self, user_id: int, new_password: str) -> bool:
        row = self._user_row_by_id(user_id)
        if not row:
            return False
        self.db.execute(text("UPDATE users SET password_hash=:ph, updated_at=:now WHERE id=:i"),
                        dict(ph=hash_password(new_password), now=_now_iso(), i=user_id))
        self.db.commit()
        return True

    def change_password(self, user_id: int, current_password: str, new_password: str) -> bool:
        row = self._user_row_by_id(user_id)
        if not row:
            return False
        if not verify_password(current_password, row[4]):
            return False
        return self.reset_user_password(user_id, new_password)

    def set_user_active(self, user_id: int, is_active: bool) -> bool:
        row = self._user_row_by_id(user_id)
        if not row:
            return False
        self.db.execute(text("UPDATE users SET is_active=:ia, updated_at=:now WHERE id=:i"),
                        dict(ia=1 if is_active else 0, now=_now_iso(), i=user_id))
        self.db.commit()
        return True

    def delete_user(self, user_id: int) -> bool:
        row = self._user_row_by_id(user_id)
        if not row:
            return False
        self.db.execute(text("DELETE FROM user_roles WHERE user_id=:i"), dict(i=user_id))
        self.db.execute(text("DELETE FROM user_data_access_groups WHERE user_id=:i"), dict(i=user_id))
        self.db.execute(text("DELETE FROM sessions WHERE user_id=:i"), dict(i=user_id))
        self.db.execute(text("DELETE FROM user_settings WHERE user_id=:i"), dict(i=user_id))
        self.db.execute(text("DELETE FROM users WHERE id=:i"), dict(i=user_id))
        self.db.commit()
        return True

    def list_users(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT id, username, name, email, is_active, created_at, updated_at
            FROM users ORDER BY username
        """)).fetchall()
        result = []
        for r in rows:
            result.append({
                "id": r[0], "username": r[1], "name": r[2] or "", "email": r[3] or "",
                "is_active": bool(r[4]), "created_at": r[5], "updated_at": r[6],
                "roles": self._user_roles(r[0]),
                "data_access_groups": self._user_data_access_groups(r[0]),
            })
        return result

    def get_user(self, user_id: int) -> dict[str, Any] | None:
        r = self._user_row_by_id(user_id)
        if not r:
            return None
        return {
            "id": r[0], "username": r[1], "name": r[2] or "", "email": r[3] or "",
            "is_active": bool(r[5]),
            "roles": self._user_roles(r[0]),
            "data_access_groups": self._user_data_access_groups(r[0]),
        }

    # ---------- role CRUD ----------
    def list_roles(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT id, name, is_system, created_at, updated_at FROM roles ORDER BY name
        """)).fetchall()
        result = []
        for r in rows:
            ents = self.db.execute(text("""
                SELECT e.key FROM entitlements e
                JOIN role_entitlements re ON re.entitlement_id = e.id
                WHERE re.role_id = :rid ORDER BY e.key
            """), dict(rid=r[0])).fetchall()
            keys = [e[0] for e in ents]
            result.append({
                "id": r[0], "name": r[1], "is_system": bool(r[2]),
                "created_at": r[3], "updated_at": r[4],
                # Provide both keys so puls8-style consumers (entitlement_keys)
                # and scp-0312 admin UI (entitlements) both work.
                "entitlements": keys,
                "entitlement_keys": keys,
            })
        return result

    def create_role(self, name: str, entitlements: list[str] | None = None) -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("role name is required")
        if self._role_id_by_name(name):
            raise ValueError(f"role '{name}' already exists")
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO roles (name, is_system, created_at, updated_at)
            VALUES (:n, 0, :now, :now)
        """), dict(n=name, now=now))
        self.db.commit()
        rid = self._role_id_by_name(name)
        if rid and entitlements:
            self.set_role_entitlements(rid, entitlements)
        return {"id": rid, "name": name, "is_system": False, "entitlements": entitlements or []}

    def update_role(self, role_id: int, *, name: str | None = None, entitlements: list[str] | None = None) -> dict[str, Any] | None:
        row = self.db.execute(text("SELECT id, name, is_system FROM roles WHERE id=:i"), dict(i=role_id)).first()
        if not row:
            return None
        if name and name != row[1]:
            self.db.execute(text("UPDATE roles SET name=:n, updated_at=:now WHERE id=:i"),
                            dict(n=name, now=_now_iso(), i=role_id))
            self.db.commit()
        if entitlements is not None:
            self.set_role_entitlements(role_id, entitlements)
        return next((r for r in self.list_roles() if r["id"] == role_id), None)

    def delete_role(self, role_id: int) -> bool:
        row = self.db.execute(text("SELECT is_system FROM roles WHERE id=:i"), dict(i=role_id)).first()
        if not row:
            return False
        if int(row[0]) == 1:
            raise ValueError("cannot delete a system role")
        self.db.execute(text("DELETE FROM role_entitlements WHERE role_id=:i"), dict(i=role_id))
        self.db.execute(text("DELETE FROM user_roles WHERE role_id=:i"), dict(i=role_id))
        self.db.execute(text("DELETE FROM roles WHERE id=:i"), dict(i=role_id))
        self.db.commit()
        return True

    def set_role_entitlements(self, role_id: int, entitlement_keys: list[str]) -> None:
        self.db.execute(text("DELETE FROM role_entitlements WHERE role_id=:rid"), dict(rid=role_id))
        now = _now_iso()
        for key in entitlement_keys:
            ent = self.db.execute(text("SELECT id FROM entitlements WHERE key=:k"), dict(k=key)).first()
            if ent is None:
                continue
            self.db.execute(text("""
                INSERT OR IGNORE INTO role_entitlements (role_id, entitlement_id, created_at)
                VALUES (:rid, :eid, :now)
            """), dict(rid=role_id, eid=ent[0], now=now))
        self.db.commit()

    def list_entitlements(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT key, resource_type, resource_key, description FROM entitlements
            ORDER BY resource_type, resource_key
        """)).fetchall()
        return [{"key": r[0], "resource_type": r[1], "resource_key": r[2], "description": r[3] or ""} for r in rows]

    # ---------- data access groups ----------
    def list_data_access_groups(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT id, name, description, created_at, updated_at FROM data_access_groups ORDER BY name
        """)).fetchall()
        return [{"id": r[0], "name": r[1], "description": r[2] or "", "created_at": r[3], "updated_at": r[4]} for r in rows]

    def create_data_access_group(self, name: str, description: str = "") -> dict[str, Any]:
        name = name.strip()
        if not name:
            raise ValueError("name is required")
        existing = self.db.execute(text("SELECT id FROM data_access_groups WHERE name=:n"), dict(n=name)).first()
        if existing:
            raise ValueError(f"data access group '{name}' already exists")
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO data_access_groups (name, description, created_at, updated_at)
            VALUES (:n, :d, :now, :now)
        """), dict(n=name, d=description, now=now))
        self.db.commit()
        row = self.db.execute(text("SELECT id, name, description FROM data_access_groups WHERE name=:n"), dict(n=name)).first()
        return {"id": row[0], "name": row[1], "description": row[2] or ""}

    def update_data_access_group(self, group_id: int, *, name: str | None = None, description: str | None = None) -> dict[str, Any] | None:
        row = self.db.execute(text("SELECT id, name, description FROM data_access_groups WHERE id=:i"), dict(i=group_id)).first()
        if not row:
            return None
        new_name = name if name is not None else row[1]
        new_desc = description if description is not None else row[2]
        self.db.execute(text("UPDATE data_access_groups SET name=:n, description=:d, updated_at=:now WHERE id=:i"),
                        dict(n=new_name, d=new_desc, now=_now_iso(), i=group_id))
        self.db.commit()
        return {"id": group_id, "name": new_name, "description": new_desc or ""}

    def set_user_data_access_groups(self, user_id: int, group_names: list[str]) -> bool:
        if not self.get_user(user_id):
            return False
        self.db.execute(text("DELETE FROM user_data_access_groups WHERE user_id=:i"), dict(i=user_id))
        now = _now_iso()
        for name in group_names:
            row = self.db.execute(text("SELECT id FROM data_access_groups WHERE name=:n"), dict(n=name)).first()
            if row is None:
                continue
            self.db.execute(text("""
                INSERT OR IGNORE INTO user_data_access_groups (user_id, group_id, created_at)
                VALUES (:uid, :gid, :now)
            """), dict(uid=user_id, gid=row[0], now=now))
        self.db.commit()
        return True

    def delete_data_access_group(self, group_id: int) -> bool:
        row = self.db.execute(text("SELECT id FROM data_access_groups WHERE id=:i"), dict(i=group_id)).first()
        if not row:
            return False
        self.db.execute(text("DELETE FROM user_data_access_groups WHERE group_id=:i"), dict(i=group_id))
        self.db.execute(text("DELETE FROM data_access_groups WHERE id=:i"), dict(i=group_id))
        self.db.commit()
        return True

    # ---------- session lifecycle ----------
    def authenticate(self, username: str, password: str) -> AuthUser | None:
        row = self._user_row_by_username(username.strip().lower())
        if not row:
            return None
        if not row[5]:  # is_active
            return None
        if not verify_password(password, row[4]):
            return None
        return self._build_auth_user(row)

    def create_session(self, user_id: int, ttl_seconds: int = 28800) -> str:
        token = secrets.token_urlsafe(SESSION_TOKEN_BYTES)
        token_hash = _hash_session_token(token)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        expires = now + timedelta(seconds=ttl_seconds)
        self.db.execute(text("""
            INSERT INTO sessions (user_id, session_token_hash, expires_at, created_at)
            VALUES (:uid, :th, :exp, :now)
        """), dict(uid=user_id, th=token_hash, exp=expires.isoformat().replace("+00:00", "Z"),
                   now=now.isoformat().replace("+00:00", "Z")))
        self.db.commit()
        return token

    def validate_session(self, token: str) -> AuthUser | None:
        if not token:
            return None
        token_hash = _hash_session_token(token)
        row = self.db.execute(text("""
            SELECT s.user_id, s.expires_at, s.revoked_at
            FROM sessions s
            WHERE s.session_token_hash = :th
        """), dict(th=token_hash)).first()
        if not row:
            return None
        if row[2]:  # revoked
            return None
        try:
            expires = datetime.fromisoformat(row[1].replace("Z", "+00:00"))
        except ValueError:
            return None
        if expires < datetime.now(timezone.utc):
            return None
        user_row = self._user_row_by_id(row[0])
        if not user_row or not user_row[5]:
            return None
        return self._build_auth_user(user_row)

    def revoke_session(self, token: str) -> None:
        token_hash = _hash_session_token(token)
        self.db.execute(text("UPDATE sessions SET revoked_at=:now WHERE session_token_hash=:th"),
                        dict(now=_now_iso(), th=token_hash))
        self.db.commit()

    def revoke_all_user_sessions(self, user_id: int) -> None:
        self.db.execute(text("UPDATE sessions SET revoked_at=:now WHERE user_id=:uid AND revoked_at IS NULL"),
                        dict(now=_now_iso(), uid=user_id))
        self.db.commit()

    # ---------- user settings ----------
    def get_user_settings(self, user_id: int) -> dict[str, Any]:
        row = self.db.execute(text("SELECT settings_json FROM user_settings WHERE user_id=:i"), dict(i=user_id)).first()
        if not row:
            return {}
        try:
            import json
            return json.loads(row[0])
        except Exception:
            return {}

    def save_user_settings(self, user_id: int, settings: dict[str, Any]) -> None:
        import json
        payload = json.dumps(settings)
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO user_settings (user_id, settings_json, created_at, updated_at)
            VALUES (:i, :p, :now, :now)
            ON CONFLICT(user_id) DO UPDATE SET settings_json=:p, updated_at=:now
        """), dict(i=user_id, p=payload, now=now))
        self.db.commit()

    # ---------- bootstrap ----------
    def bootstrap_admin_if_missing(
        self, *,
        username: str = "admin",
        password: str = "admin123",
        name: str = "System Admin",
        email: str = "admin@local",
        seed_demo_users: bool = True,
    ) -> dict[str, Any]:
        created = []
        skipped = []
        if not self._user_row_by_username(username):
            self.create_user(username=username, password=password, name=name, email=email, roles=["admin"])
            created.append(username)
        else:
            skipped.append(username)
        if seed_demo_users:
            for demo_user, demo_pw, demo_role, demo_name in [
                ("planner", "planner", "super_user", "Demo Planner"),
                ("analyst", "analyst", "user", "Demo Analyst"),
            ]:
                if not self._user_row_by_username(demo_user):
                    self.create_user(username=demo_user, password=demo_pw, name=demo_name,
                                     email=f"{demo_user}@local", roles=[demo_role])
                    created.append(demo_user)
                else:
                    skipped.append(demo_user)
        return {"created": created, "skipped": skipped}
