"""Deterministic problem detection for the allocation & distribution agent.

Five problem types:
  - allocation_gap           (per sku/store vs velocity fair-share)
  - store_fair_share_deviation (stronger variant with severity bands)
  - route_delivery_risk      (route ETA drifts past its general window)
  - iftar_window_miss_risk   (route ETA lands after Iftar for at least one stop)
  - expiry_risk_cluster      (batch-grain RSL <= threshold, mirrors diagnostic)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models import (
    DeliveryRoute,
    InventoryBatchSnapshot,
    NetworkInventorySnapshot,
    RamadanCalendar,
    StoreVelocity,
)
from ..inventory_diagnostic.problem_detector import ProblemInstance


@dataclass
class AllocationScope:
    skus: list[str] = field(default_factory=list)       # empty = all
    nodes: list[str] = field(default_factory=list)      # empty = all
    route_ids: list[str] = field(default_factory=list)  # empty = all
    delivery_date: str | None = None                    # ISO date, defaults to today
    window: str | None = None                           # e.g. "iftar"


def _parse_time(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Accept ISO datetime or HH:MM
        if "T" in s:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        h, m = s.split(":")[:2]
        base = datetime.now().replace(hour=int(h), minute=int(m), second=0, microsecond=0)
        return base
    except Exception:
        return None


class AllocationDetector:
    def __init__(
        self,
        db: Session,
        *,
        problem_templates: list[dict[str, Any]] | None = None,
        disabled_keys: set[str] | None = None,
        iftar_buffer_minutes: int = 15,
        rsl_days_threshold: int = 2,
    ):
        self.db = db
        self.problem_templates = problem_templates or []
        self.disabled_keys = disabled_keys or set()
        self.iftar_buffer_minutes = int(iftar_buffer_minutes)
        self.rsl_days_threshold = int(rsl_days_threshold)

    # ----------------------------------------------------------------- public

    def detect(self, scope: AllocationScope) -> list[ProblemInstance]:
        enabled = [
            t for t in self.problem_templates
            if isinstance(t, dict) and t.get("key") and t.get("key") not in self.disabled_keys
        ]
        enabled_keys = {t["key"] for t in enabled}
        problems: list[ProblemInstance] = []
        if "expiry_risk_cluster" in enabled_keys:
            problems.extend(self._detect_expiry_cluster(scope))
        if "iftar_window_miss_risk" in enabled_keys:
            problems.extend(self._detect_iftar_miss(scope))
        if "route_delivery_risk" in enabled_keys:
            problems.extend(self._detect_route_risk(scope))
        if "store_fair_share_deviation" in enabled_keys:
            problems.extend(self._detect_fair_share(scope, severity_floor_pct=0.35, key="store_fair_share_deviation"))
        if "allocation_gap" in enabled_keys:
            problems.extend(self._detect_fair_share(scope, severity_floor_pct=0.25, key="allocation_gap"))
        return problems

    # ------------------------------------------------------- expiry cluster

    def _detect_expiry_cluster(self, scope: AllocationScope) -> list[ProblemInstance]:
        q = self.db.query(InventoryBatchSnapshot)
        if scope.skus:
            q = q.filter(InventoryBatchSnapshot.sku.in_(scope.skus))
        if scope.nodes:
            q = q.filter(InventoryBatchSnapshot.node_id.in_(scope.nodes))
        rows = q.all()
        # Regex-fallback intent parsing can yield SKU/node fragments that match
        # no real row. If a narrow scope produced zero rows, fall back to an
        # unscoped scan so the planner still gets useful output.
        if not rows and (scope.skus or scope.nodes):
            rows = self.db.query(InventoryBatchSnapshot).all()
        if not rows:
            return []
        # Pick the latest snapshot per sku/node
        latest_as_of: dict[tuple[str, str], str] = {}
        for r in rows:
            key = (r.sku, r.node_id)
            if key not in latest_as_of or str(r.as_of_date) > latest_as_of[key]:
                latest_as_of[key] = str(r.as_of_date)
        today = date.today()
        out: list[ProblemInstance] = []
        seen: set[tuple[str, str]] = set()
        for r in rows:
            if latest_as_of.get((r.sku, r.node_id)) != str(r.as_of_date):
                continue
            try:
                exp = date.fromisoformat(r.expiry_date)
                as_of = date.fromisoformat(r.as_of_date)
            except (TypeError, ValueError):
                continue
            rsl = (exp - as_of).days
            if rsl > self.rsl_days_threshold and not r.quality_hold_flag:
                continue
            qty = float(r.batch_qty or 0.0)
            if qty <= 0:
                continue
            severity = "critical" if rsl <= 1 else "warning"
            evidence = {
                "batch_id": r.batch_id,
                "earliest_batch_rsl_days": rsl,
                "earliest_batch_expiry_date": exp.isoformat(),
                "as_of_date": as_of.isoformat(),
                "quality_hold_flag": bool(r.quality_hold_flag),
                "batch_qty": qty,
                "rsl_days_threshold": self.rsl_days_threshold,
            }
            # Aggregate per sku/node — keep the earliest-RSL batch only.
            key = (r.sku, r.node_id)
            if key in seen:
                continue
            seen.add(key)
            out.append(ProblemInstance(
                problem_key="expiry_risk_cluster",
                sku=r.sku,
                node_id=r.node_id,
                breach_week=None,
                breach_week_date=exp.isoformat(),
                severity=severity,
                shortage_qty=qty,
                projected_on_hand_actual_qty=qty,
                safety_stock_qty=0.0,
                reorder_point_qty=0.0,
                evidence=evidence,
            ))
        return out

    # --------------------------------------------------------- iftar miss

    def _detect_iftar_miss(self, scope: AllocationScope) -> list[ProblemInstance]:
        today_iso = scope.delivery_date or date.today().isoformat()
        q = self.db.query(DeliveryRoute).filter(DeliveryRoute.scheduled_date == today_iso)
        if scope.route_ids:
            q = q.filter(DeliveryRoute.route_id.in_(scope.route_ids))
        rows = q.all()
        if not rows:
            return []
        # Resolve iftar time for the delivery date via Ramadan calendar, else
        # fall back to a sensible buffer of 18:00 local.
        iftar_row = (
            self.db.query(RamadanCalendar)
            .filter(RamadanCalendar.calendar_date == today_iso)
            .first()
        )
        iftar_str = iftar_row.iftar_local_time if iftar_row and iftar_row.iftar_local_time else "18:00"
        iftar_dt = _parse_time(iftar_str)
        if iftar_dt is None:
            return []
        out: list[ProblemInstance] = []
        for r in rows:
            try:
                stops = json.loads(r.stops_json or "[]")
            except json.JSONDecodeError:
                stops = []
            if not isinstance(stops, list):
                continue
            for stop in stops:
                if not isinstance(stop, dict):
                    continue
                eta = _parse_time(str(stop.get("eta") or ""))
                if eta is None:
                    continue
                # Align dates so we compare minute-of-day only.
                eta_today = eta.replace(year=iftar_dt.year, month=iftar_dt.month, day=iftar_dt.day)
                delta_min = (eta_today - iftar_dt).total_seconds() / 60.0
                if delta_min >= -self.iftar_buffer_minutes:
                    # ETA within buffer minutes of Iftar OR after Iftar
                    severity = "critical" if delta_min > 0 else "warning"
                    node_id = str(stop.get("node_id") or r.route_id)
                    qty_map = stop.get("planned_qty_by_sku") or {}
                    qty_at_stake = sum(float(v or 0.0) for v in qty_map.values())
                    # Pick a representative SKU for display (largest planned qty).
                    primary_sku = ""
                    if isinstance(qty_map, dict) and qty_map:
                        primary_sku = max(qty_map.items(), key=lambda kv: float(kv[1] or 0.0))[0]
                    out.append(ProblemInstance(
                        problem_key="iftar_window_miss_risk",
                        sku=primary_sku,
                        node_id=node_id,
                        breach_week=None,
                        breach_week_date=today_iso,
                        severity=severity,
                        shortage_qty=round(qty_at_stake, 2),
                        projected_on_hand_actual_qty=qty_at_stake,
                        safety_stock_qty=0.0,
                        reorder_point_qty=0.0,
                        evidence={
                            "route_id": r.route_id,
                            "stop_node_id": node_id,
                            "planned_eta": eta_today.strftime("%H:%M"),
                            "iftar_local_time": iftar_dt.strftime("%H:%M"),
                            "minutes_vs_iftar": round(delta_min, 1),
                            "buffer_minutes": self.iftar_buffer_minutes,
                            "vehicle_id": r.vehicle_id,
                            "capacity_units": float(r.capacity_units or 0.0),
                            "qty_at_stake": round(qty_at_stake, 2),
                            "planned_qty_by_sku": qty_map,
                        },
                    ))
        return out

    # -------------------------------------------------------- route risk

    def _detect_route_risk(self, scope: AllocationScope) -> list[ProblemInstance]:
        today_iso = scope.delivery_date or date.today().isoformat()
        q = self.db.query(DeliveryRoute).filter(DeliveryRoute.scheduled_date == today_iso)
        if scope.route_ids:
            q = q.filter(DeliveryRoute.route_id.in_(scope.route_ids))
        rows = q.all()
        out: list[ProblemInstance] = []
        for r in rows:
            try:
                stops = json.loads(r.stops_json or "[]")
            except json.JSONDecodeError:
                stops = []
            if not isinstance(stops, list):
                continue
            planned_total = 0.0
            for stop in stops:
                qty_by_sku = (stop.get("planned_qty_by_sku") or {}) if isinstance(stop, dict) else {}
                planned_total += sum(float(v or 0.0) for v in qty_by_sku.values())
            capacity = float(r.capacity_units or 0.0)
            # Capacity overrun = route_delivery_risk (warning).
            if capacity > 0 and planned_total > capacity:
                out.append(ProblemInstance(
                    problem_key="route_delivery_risk",
                    sku="",
                    node_id=r.origin_node_id or r.route_id,
                    breach_week=None,
                    breach_week_date=today_iso,
                    severity="warning",
                    shortage_qty=round(planned_total - capacity, 2),
                    projected_on_hand_actual_qty=planned_total,
                    safety_stock_qty=0.0,
                    reorder_point_qty=capacity,
                    evidence={
                        "route_id": r.route_id,
                        "planned_units": round(planned_total, 2),
                        "capacity_units": capacity,
                        "overrun_units": round(planned_total - capacity, 2),
                        "vehicle_id": r.vehicle_id,
                        "stop_count": len(stops),
                    },
                ))
        return out

    # ------------------------------------------------------ fair share

    def _detect_fair_share(
        self,
        scope: AllocationScope,
        *,
        severity_floor_pct: float,
        key: str,
    ) -> list[ProblemInstance]:
        """Compute velocity-weighted fair share across stores for each SKU and
        emit a problem where on-hand deviates from the fair share by more than
        ``severity_floor_pct``. Uses StoreVelocity + NetworkInventorySnapshot."""
        vq = self.db.query(StoreVelocity)
        iq = self.db.query(NetworkInventorySnapshot)
        if scope.skus:
            vq = vq.filter(StoreVelocity.sku.in_(scope.skus))
            iq = iq.filter(NetworkInventorySnapshot.sku.in_(scope.skus))
        if scope.nodes:
            vq = vq.filter(StoreVelocity.node_id.in_(scope.nodes))
            iq = iq.filter(NetworkInventorySnapshot.node_id.in_(scope.nodes))
        velocity_rows = vq.all()
        inv_rows = iq.all()
        if not velocity_rows or not inv_rows:
            return []

        # velocity_by_sku_node: latest date per (sku,node).
        vel_by_pair: dict[tuple[str, str], float] = {}
        vel_date: dict[tuple[str, str], str] = {}
        for v in velocity_rows:
            pkey = (v.sku, v.node_id)
            if pkey not in vel_date or str(v.date) > vel_date[pkey]:
                vel_date[pkey] = str(v.date)
                vel_by_pair[pkey] = float(v.units_per_hour_avg or 0.0)

        # latest on-hand per (sku,node).
        on_hand: dict[tuple[str, str], float] = {}
        inv_date: dict[tuple[str, str], str] = {}
        for r in inv_rows:
            pkey = (r.sku, r.node_id)
            if pkey not in inv_date or str(r.as_of_date) > inv_date[pkey]:
                inv_date[pkey] = str(r.as_of_date)
                on_hand[pkey] = float(r.on_hand_qty or 0.0)

        # Group by sku → compute fair share proportional to velocity.
        by_sku: dict[str, list[str]] = {}
        for (sku, node) in vel_by_pair.keys():
            by_sku.setdefault(sku, []).append(node)

        out: list[ProblemInstance] = []
        for sku, nodes in by_sku.items():
            total_velocity = sum(vel_by_pair[(sku, n)] for n in nodes)
            total_on_hand = sum(on_hand.get((sku, n), 0.0) for n in nodes)
            if total_velocity <= 0 or total_on_hand <= 0:
                continue
            for node in nodes:
                velocity = vel_by_pair[(sku, node)]
                fair_share_qty = total_on_hand * (velocity / total_velocity)
                actual = on_hand.get((sku, node), 0.0)
                if fair_share_qty <= 0:
                    continue
                deviation = (actual - fair_share_qty) / fair_share_qty
                if abs(deviation) < severity_floor_pct:
                    continue
                # Per-template severity banding.
                severity = "warning"
                if key == "store_fair_share_deviation":
                    if abs(deviation) >= 0.5:
                        severity = "critical"
                out.append(ProblemInstance(
                    problem_key=key,
                    sku=sku,
                    node_id=node,
                    breach_week=None,
                    breach_week_date=None,
                    severity=severity,
                    shortage_qty=round(abs(actual - fair_share_qty), 2),
                    projected_on_hand_actual_qty=actual,
                    safety_stock_qty=0.0,
                    reorder_point_qty=round(fair_share_qty, 2),
                    evidence={
                        "fair_share_qty": round(fair_share_qty, 2),
                        "actual_on_hand_qty": round(actual, 2),
                        "deviation_pct": round(deviation, 3),
                        "velocity_units_per_hour": velocity,
                        "total_sku_velocity": total_velocity,
                        "total_sku_on_hand": total_on_hand,
                        "sibling_nodes": [n for n in nodes if n != node],
                    },
                ))
        return out
