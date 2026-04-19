"""Module + Page admin store for scp-0312.

CRUD over the 6 module_* tables. Sits next to AuthStore so it can reuse
the same DB session pattern. Auto-generates entitlements per page-type
(mirrors puls8-primo's _PAGE_TYPE_ENTITLEMENT_TEMPLATES).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# Per-page-type auto-generated entitlement suffixes
PAGE_TYPE_ENTITLEMENT_TEMPLATES: dict[str, list[str]] = {
    "overview": ["view"],
    "analytics": ["view", "export"],
    "workbench": ["view", "edit", "submit", "export"],
    "module_configurator": ["view", "edit"],
    "custom": ["view"],
}


class ModuleConfigService:
    def __init__(self, db: Session):
        self.db = db

    # =================================================================
    # MODULES
    # =================================================================
    def list_modules(self) -> list[dict[str, Any]]:
        rows = self.db.execute(text("""
            SELECT id, module_slug, label, description, documentation, config_root,
                   is_active, icon, sort_order, landing_page_slug, module_logo,
                   created_at, updated_at
            FROM modules ORDER BY sort_order, module_slug
        """)).fetchall()
        return [self._module_dict(r) for r in rows]

    def get_module(self, slug: str) -> dict[str, Any] | None:
        row = self._module_row(slug)
        if not row:
            return None
        d = self._module_dict(row)
        d["pages"] = self.list_pages(slug)
        d["role_access"] = self._module_role_ids(d["id"])
        return d

    def create_module(self, payload: dict[str, Any]) -> dict[str, Any]:
        slug = str(payload.get("module_slug") or "").strip()
        if not slug:
            raise ValueError("module_slug is required")
        if self._module_row(slug):
            raise ValueError(f"module_slug '{slug}' already exists")
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO modules (module_slug, label, description, documentation, config_root,
                                 is_active, icon, sort_order, landing_page_slug, module_logo,
                                 created_at, updated_at)
            VALUES (:s, :lab, :d, :doc, :cr, :ia, :ic, :so, :lp, :ml, :now, :now)
        """), dict(
            s=slug,
            lab=str(payload.get("label") or slug),
            d=payload.get("description"),
            doc=payload.get("documentation"),
            cr=payload.get("config_root"),
            ia=1 if payload.get("is_active", True) else 0,
            ic=payload.get("icon"),
            so=int(payload.get("sort_order") or 0),
            lp=payload.get("landing_page_slug"),
            ml=payload.get("module_logo"),
            now=now,
        ))
        self.db.commit()
        return self.get_module(slug) or {}

    def update_module(self, slug: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        row = self._module_row(slug)
        if not row:
            return None
        fields = []
        params: dict[str, Any] = {"slug": slug, "now": _now_iso()}
        for col in ("label", "description", "documentation", "config_root", "icon",
                    "landing_page_slug", "module_logo"):
            if col in payload:
                fields.append(f"{col} = :{col}")
                params[col] = payload[col]
        if "is_active" in payload:
            fields.append("is_active = :ia")
            params["ia"] = 1 if payload["is_active"] else 0
        if "sort_order" in payload:
            fields.append("sort_order = :so")
            params["so"] = int(payload["sort_order"])
        if fields:
            stmt = f"UPDATE modules SET {', '.join(fields)}, updated_at = :now WHERE module_slug = :slug"
            self.db.execute(text(stmt), params)
            self.db.commit()
        return self.get_module(slug)

    def delete_module(self, slug: str) -> bool:
        row = self._module_row(slug)
        if not row:
            return False
        mid = row[0]
        self.db.execute(text("DELETE FROM module_pages WHERE module_id = :i"), dict(i=mid))
        self.db.execute(text("DELETE FROM module_role_access WHERE module_id = :i"), dict(i=mid))
        self.db.execute(text("DELETE FROM module_entitlements WHERE module_id = :i"), dict(i=mid))
        self.db.execute(text("DELETE FROM modules WHERE id = :i"), dict(i=mid))
        self.db.commit()
        return True

    # =================================================================
    # PAGES
    # =================================================================
    def list_pages(self, module_slug: str) -> list[dict[str, Any]]:
        row = self._module_row(module_slug)
        if not row:
            return []
        page_rows = self.db.execute(text("""
            SELECT id, module_id, page_slug, label, page_type, config_ref, icon,
                   sort_order, is_active, created_at, updated_at
            FROM module_pages WHERE module_id = :mid ORDER BY sort_order, page_slug
        """), dict(mid=row[0])).fetchall()
        result = []
        for p in page_rows:
            d = self._page_dict(p)
            d["role_access"] = self._page_role_ids(d["id"])
            d["agent_instance_ids"] = self._page_agent_instance_ids(d["id"])
            result.append(d)
        return result

    def create_page(self, module_slug: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        row = self._module_row(module_slug)
        if not row:
            return None
        page_slug = str(payload.get("page_slug") or "").strip()
        if not page_slug:
            raise ValueError("page_slug is required")
        existing = self.db.execute(text(
            "SELECT id FROM module_pages WHERE module_id = :m AND page_slug = :p"
        ), dict(m=row[0], p=page_slug)).first()
        if existing:
            raise ValueError(f"page_slug '{page_slug}' already exists in module")
        now = _now_iso()
        self.db.execute(text("""
            INSERT INTO module_pages (module_id, page_slug, label, page_type, config_ref, icon,
                                      sort_order, is_active, created_at, updated_at)
            VALUES (:m, :s, :lab, :pt, :cr, :ic, :so, :ia, :now, :now)
        """), dict(
            m=row[0], s=page_slug,
            lab=str(payload.get("label") or page_slug),
            pt=str(payload.get("page_type") or "custom"),
            cr=payload.get("config_ref"),
            ic=payload.get("icon"),
            so=int(payload.get("sort_order") or 0),
            ia=1 if payload.get("is_active", True) else 0,
            now=now,
        ))
        self.db.commit()
        return next((p for p in self.list_pages(module_slug) if p["page_slug"] == page_slug), None)

    def update_page(self, module_slug: str, page_slug: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        mrow = self._module_row(module_slug)
        if not mrow:
            return None
        page = self.db.execute(text(
            "SELECT id FROM module_pages WHERE module_id = :m AND page_slug = :p"
        ), dict(m=mrow[0], p=page_slug)).first()
        if not page:
            return None
        fields = []
        params: dict[str, Any] = {"id": page[0], "now": _now_iso()}
        for col in ("label", "page_type", "config_ref", "icon"):
            if col in payload:
                fields.append(f"{col} = :{col}")
                params[col] = payload[col]
        if "sort_order" in payload:
            fields.append("sort_order = :so")
            params["so"] = int(payload["sort_order"])
        if "is_active" in payload:
            fields.append("is_active = :ia")
            params["ia"] = 1 if payload["is_active"] else 0
        if fields:
            stmt = f"UPDATE module_pages SET {', '.join(fields)}, updated_at = :now WHERE id = :id"
            self.db.execute(text(stmt), params)
            self.db.commit()
        return next((p for p in self.list_pages(module_slug) if p["page_slug"] == page_slug), None)

    def delete_page(self, module_slug: str, page_slug: str) -> bool:
        mrow = self._module_row(module_slug)
        if not mrow:
            return False
        page = self.db.execute(text(
            "SELECT id FROM module_pages WHERE module_id = :m AND page_slug = :p"
        ), dict(m=mrow[0], p=page_slug)).first()
        if not page:
            return False
        pid = page[0]
        self.db.execute(text("DELETE FROM module_page_role_access WHERE page_id = :i"), dict(i=pid))
        self.db.execute(text("DELETE FROM module_page_agent_instances WHERE page_id = :i"), dict(i=pid))
        self.db.execute(text("DELETE FROM module_entitlements WHERE page_id = :i"), dict(i=pid))
        self.db.execute(text("DELETE FROM module_pages WHERE id = :i"), dict(i=pid))
        self.db.commit()
        return True

    # =================================================================
    # ROLE ACCESS
    # =================================================================
    def set_module_roles(self, module_slug: str, role_ids: list[int]) -> bool:
        row = self._module_row(module_slug)
        if not row:
            return False
        mid = row[0]
        self.db.execute(text("DELETE FROM module_role_access WHERE module_id = :m"), dict(m=mid))
        now = _now_iso()
        for rid in role_ids:
            self.db.execute(text("""
                INSERT OR IGNORE INTO module_role_access (module_id, role_id, created_at)
                VALUES (:m, :r, :now)
            """), dict(m=mid, r=int(rid), now=now))
        self.db.commit()
        return True

    def set_page_roles(self, module_slug: str, page_slug: str, role_ids: list[int]) -> bool:
        mrow = self._module_row(module_slug)
        if not mrow:
            return False
        page = self.db.execute(text(
            "SELECT id FROM module_pages WHERE module_id = :m AND page_slug = :p"
        ), dict(m=mrow[0], p=page_slug)).first()
        if not page:
            return False
        pid = page[0]
        self.db.execute(text("DELETE FROM module_page_role_access WHERE page_id = :p"), dict(p=pid))
        now = _now_iso()
        for rid in role_ids:
            self.db.execute(text("""
                INSERT OR IGNORE INTO module_page_role_access (page_id, role_id, created_at)
                VALUES (:p, :r, :now)
            """), dict(p=pid, r=int(rid), now=now))
        self.db.commit()
        return True

    def set_page_agents(self, module_slug: str, page_slug: str, agent_instance_ids: list[int]) -> bool:
        mrow = self._module_row(module_slug)
        if not mrow:
            return False
        page = self.db.execute(text(
            "SELECT id FROM module_pages WHERE module_id = :m AND page_slug = :p"
        ), dict(m=mrow[0], p=page_slug)).first()
        if not page:
            return False
        pid = page[0]
        self.db.execute(text("DELETE FROM module_page_agent_instances WHERE page_id = :p"), dict(p=pid))
        now = _now_iso()
        for sort, aid in enumerate(agent_instance_ids):
            self.db.execute(text("""
                INSERT OR IGNORE INTO module_page_agent_instances
                       (page_id, agent_instance_id, sort_order, created_at)
                VALUES (:p, :a, :s, :now)
            """), dict(p=pid, a=int(aid), s=sort, now=now))
        self.db.commit()
        return True

    # =================================================================
    # SEED DEFAULTS
    # =================================================================
    def seed_default_modules(self) -> dict[str, list[str]]:
        """Idempotent: insert 4 system modules + their pages mirroring
        frontend/src/app/navigation.ts so the new admin page has data."""
        created = []
        skipped = []
        defaults = [
            {
                "module_slug": "smart-execution",
                "label": "Smart Execution",
                "description": "Dashboard, Network, Parameters, Replenishment, Analytics",
                "icon": "DashboardOutlinedIcon", "sort_order": 1,
                "pages": [
                    ("dashboard", "Dashboard", "DashboardOutlinedIcon"),
                    ("network", "Network", "HubOutlinedIcon"),
                    ("parameters", "Parameters", "SettingsSuggestOutlinedIcon"),
                    ("replenishment", "Replenishment", "LocalShippingOutlinedIcon"),
                    ("maintenance", "Analytics", "TableViewOutlinedIcon"),
                ],
            },
            {
                "module_slug": "intelligent-planning",
                "label": "Intelligent Planning",
                "description": "Forecasting, S&OP, financial, trade promotion",
                "icon": "TrendingUpOutlinedIcon", "sort_order": 2,
                "pages": [
                    ("demand-forecasting", "Demand Forecasting", "TrendingUpOutlinedIcon"),
                    ("collaborative-planning", "Collaborative Planning", "GroupsOutlinedIcon"),
                    ("forecast-accuracy", "Forecast Accuracy", "TrackChangesOutlinedIcon"),
                    ("sop-ibp", "S&OP / IBP", "EventNoteOutlinedIcon"),
                    ("supply-integration", "Supply Integration", "SyncAltOutlinedIcon"),
                    ("financial-planning", "Financial Planning", "AttachMoneyOutlinedIcon"),
                    ("trade-promotion", "Trade Promotion", "CampaignOutlinedIcon"),
                    ("ibp-analytics", "Planning Analytics", "AssessmentOutlinedIcon"),
                    ("customer-hierarchy", "Customers", "PeopleOutlineOutlinedIcon"),
                ],
            },
            {
                "module_slug": "agentic-ai",
                "label": "Puls8 Agents",
                "description": "Configurable supply-chain agents (diagnostic, demand sensing, allocation & distribution)",
                "icon": "SettingsApplicationsOutlinedIcon", "sort_order": 3,
                "pages": [
                    ("agent-configuration", "Agent Configurator", "SettingsApplicationsOutlinedIcon"),
                    ("inventory-diagnostic", "Inventory Diagnostic", "Inventory2OutlinedIcon"),
                    ("demand-sensing", "Demand Sensing", "TrendingUpOutlinedIcon"),
                    ("allocation-distribution", "Allocation & Distribution", "LocalShippingOutlinedIcon"),
                    ("global-filter-compliance", "Filter Compliance", "FactCheckOutlinedIcon"),
                ],
            },
            {
                "module_slug": "administration",
                "label": "Administration",
                "description": "Users, roles, modules, branding",
                "icon": "AdminPanelSettingsOutlinedIcon", "sort_order": 4,
                "pages": [
                    ("admin-users", "Users & Roles", "PeopleAltOutlinedIcon"),
                    ("admin-modules", "Modules & Pages", "ViewModuleOutlinedIcon"),
                    ("admin-branding", "Branding & Logos", "PaletteOutlinedIcon"),
                ],
            },
        ]
        for mod in defaults:
            slug = mod["module_slug"]
            existing = self._module_row(slug)
            if existing is None:
                self.create_module({
                    "module_slug": slug,
                    "label": mod["label"],
                    "description": mod["description"],
                    "icon": mod["icon"],
                    "sort_order": mod["sort_order"],
                    "is_active": True,
                })
                created.append(slug)
            else:
                # Upgrade: ship label/description/icon updates (e.g. Agentic AI
                # → Puls8 Agents) without clobbering admin-edited rows silently.
                now = _now_iso()
                self.db.execute(text(
                    "UPDATE modules SET label = :l, description = :d, icon = :i, updated_at = :u "
                    "WHERE module_slug = :s"
                ), dict(l=mod["label"], d=mod["description"], i=mod["icon"], u=now, s=slug))
                self.db.commit()
                skipped.append(slug)
            # Always upsert pages — this is how we ship new pages without a
            # destructive reseed.
            for sort, (pslug, plabel, picon) in enumerate(mod["pages"]):
                try:
                    self.create_page(slug, {
                        "page_slug": pslug,
                        "label": plabel,
                        "icon": picon,
                        "sort_order": sort,
                        "page_type": "custom",
                        "is_active": True,
                    })
                except ValueError:
                    # Page already exists — keep its current label/icon/sort but
                    # ensure it's active so shipped pages are visible on upgrade.
                    self.db.execute(text(
                        "UPDATE module_pages SET is_active = 1, updated_at = :u "
                        "WHERE page_slug = :s AND module_id = ("
                        "  SELECT id FROM modules WHERE module_slug = :m)"
                    ), dict(u=_now_iso(), s=pslug, m=slug))
                    self.db.commit()
        return {"created": created, "skipped": skipped}

    # =================================================================
    # HELPERS
    # =================================================================
    def _module_row(self, slug: str) -> Any:
        return self.db.execute(text(
            "SELECT id, module_slug, label, description, documentation, config_root, "
            "is_active, icon, sort_order, landing_page_slug, module_logo, "
            "created_at, updated_at FROM modules WHERE module_slug = :s"
        ), dict(s=slug)).first()

    def _module_dict(self, row: Any) -> dict[str, Any]:
        return {
            "id": row[0], "module_slug": row[1], "label": row[2],
            "description": row[3] or "", "documentation": row[4] or "",
            "config_root": row[5], "is_active": bool(row[6]),
            "icon": row[7], "sort_order": row[8],
            "landing_page_slug": row[9], "module_logo": row[10],
            "created_at": row[11], "updated_at": row[12],
        }

    def _page_dict(self, row: Any) -> dict[str, Any]:
        return {
            "id": row[0], "module_id": row[1], "page_slug": row[2],
            "label": row[3], "page_type": row[4],
            "config_ref": row[5], "icon": row[6],
            "sort_order": row[7], "is_active": bool(row[8]),
            "created_at": row[9], "updated_at": row[10],
        }

    def _module_role_ids(self, module_id: int) -> list[int]:
        rows = self.db.execute(text(
            "SELECT role_id FROM module_role_access WHERE module_id = :m"
        ), dict(m=module_id)).fetchall()
        return [r[0] for r in rows]

    def _page_role_ids(self, page_id: int) -> list[int]:
        rows = self.db.execute(text(
            "SELECT role_id FROM module_page_role_access WHERE page_id = :p"
        ), dict(p=page_id)).fetchall()
        return [r[0] for r in rows]

    def _page_agent_instance_ids(self, page_id: int) -> list[int]:
        rows = self.db.execute(text(
            "SELECT agent_instance_id FROM module_page_agent_instances "
            "WHERE page_id = :p ORDER BY sort_order"
        ), dict(p=page_id)).fetchall()
        return [r[0] for r in rows]
