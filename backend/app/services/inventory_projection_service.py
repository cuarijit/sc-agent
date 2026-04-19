from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from statistics import NormalDist
from typing import Any

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models import (
    InventoryBatchSnapshot,
    InventoryProjectionProductConfig,
    NetworkForecastWeekly,
    NetworkInventorySnapshot,
    NetworkSourcingRule,
    ParameterValue,
    PosHourlyActual,
    ProductMaster,
    RamadanCalendar,
    ReplenishmentOrder,
    ReplenishmentOrderAlertLink,
    ReplenishmentOrderDetail,
    SimulationScenario,
)


DEFAULT_BASE_WEEK = date(2026, 3, 8)


class InventoryProjectionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _iso_week(self, base_week: date, week_offset: int) -> str:
        return (base_week + timedelta(days=7 * (week_offset - 1))).isoformat()

    def _z_score(self, service_level: float) -> float:
        bounded = min(0.999, max(0.5, service_level))
        return float(NormalDist().inv_cdf(bounded))

    def _available_skus(self) -> list[str]:
        rows = self.db.query(ProductMaster.sku).order_by(ProductMaster.sku.asc()).all()
        return [row[0] for row in rows]

    def _available_nodes(self, sku: str | None = None) -> list[str]:
        query = self.db.query(NetworkSourcingRule.dest_node_id).distinct().order_by(NetworkSourcingRule.dest_node_id.asc())
        if sku:
            query = query.filter(NetworkSourcingRule.sku == sku)
        return [row[0] for row in query.all() if row[0]]

    def _demo_examples(self) -> list[dict[str, object]]:
        pairs = {
            (row[0], row[1])
            for row in self.db.query(NetworkSourcingRule.sku, NetworkSourcingRule.dest_node_id).distinct().all()
        }
        available_skus = self._available_skus()
        fallback_sku = available_skus[0] if available_skus else "SKU-000"
        fallback_node = self._available_nodes(fallback_sku)[0] if self._available_nodes(fallback_sku) else "NODE-000"

        # Pinned demo pairs for deterministic Help cards.
        pinned: dict[str, tuple[str, str]] = {
            "stockout_1": ("BAR-002", "STORE-001"),
            "stockout_2": ("BAR-002", "STORE-002"),
            "below_rop_1": ("BAR-002", "RDC-001"),
            "below_rop_2": ("BAR-002", "RDC-002"),
            "excess_1": ("BAR-002", "CDC-001"),
            "excess_2": ("BAR-002", "CDC-002"),
            "perfect_sawtooth_1": ("BAR-002", "CDC-001"),
            "perfect_sawtooth_2": ("BAR-002", "CDC-002"),
            "perfect_sawtooth_3": ("BAR-002", "RDC-003"),
        }

        def resolve_pair(key: str) -> tuple[str, str]:
            candidate = pinned[key]
            if candidate in pairs:
                return candidate
            return (fallback_sku, fallback_node)

        stk1 = resolve_pair("stockout_1")
        stk2 = resolve_pair("stockout_2")
        brop1 = resolve_pair("below_rop_1")
        brop2 = resolve_pair("below_rop_2")
        ex1 = resolve_pair("excess_1")
        ex2 = resolve_pair("excess_2")
        saw1 = resolve_pair("perfect_sawtooth_1")
        saw2 = resolve_pair("perfect_sawtooth_2")
        saw3 = resolve_pair("perfect_sawtooth_3")

        return [
            {
                "key": "stockout_next_2_3_weeks_1",
                "label": "Stock out in next 2-3 weeks (Example 1)",
                "sku": stk1[0],
                "location": stk1[1],
                "node": stk1[1],
                "alert_id": "ALERT-INV-STOCKOUT-001",
            },
            {
                "key": "stockout_next_2_3_weeks_2",
                "label": "Stock out in next 2-3 weeks (Example 2)",
                "sku": stk2[0],
                "location": stk2[1],
                "node": stk2[1],
                "alert_id": "ALERT-INV-STOCKOUT-002",
            },
            {
                "key": "below_rop_no_future_orders_1",
                "label": "Stock below re-order point without future orders (Example 1)",
                "sku": brop1[0],
                "location": brop1[1],
                "node": brop1[1],
                "alert_id": "ALERT-INV-LOW-001",
            },
            {
                "key": "below_rop_no_future_orders_2",
                "label": "Stock below re-order point without future orders (Example 2)",
                "sku": brop2[0],
                "location": brop2[1],
                "node": brop2[1],
                "alert_id": "ALERT-INV-LOW-002",
            },
            {
                "key": "excess_inventory_low_forecast_1",
                "label": "Excess inventory with low/zero forecast (Example 1)",
                "sku": ex1[0],
                "location": ex1[1],
                "node": ex1[1],
                "alert_id": None,
            },
            {
                "key": "excess_inventory_low_forecast_2",
                "label": "Excess inventory with low/zero forecast (Example 2)",
                "sku": ex2[0],
                "location": ex2[1],
                "node": ex2[1],
                "alert_id": None,
            },
            {
                "key": "perfect_sawtooth_no_stockout_1",
                "label": "Perfect saw-tooth (no stockout, all 12 weeks) - Example 1",
                "sku": saw1[0],
                "location": saw1[1],
                "node": saw1[1],
                "alert_id": None,
            },
            {
                "key": "perfect_sawtooth_no_stockout_2",
                "label": "Perfect saw-tooth (no stockout, all 12 weeks) - Example 2",
                "sku": saw2[0],
                "location": saw2[1],
                "node": saw2[1],
                "alert_id": None,
            },
            {
                "key": "perfect_sawtooth_no_stockout_3",
                "label": "Perfect saw-tooth (no stockout, all 12 weeks) - Example 3",
                "sku": saw3[0],
                "location": saw3[1],
                "node": saw3[1],
                "alert_id": None,
            },
        ]

    def _config_for(self, sku: str) -> InventoryProjectionProductConfig:
        config = self.db.query(InventoryProjectionProductConfig).filter(InventoryProjectionProductConfig.product_id == sku).first()
        if config:
            return config
        config = InventoryProjectionProductConfig(product_id=sku, lead_time_days=14, service_level_target=0.95, demand_std_dev=25.0)
        self.db.add(config)
        self.db.flush()
        return config

    def _base_week_for(self, sku: str, node: str | None) -> date:
        query = self.db.query(NetworkForecastWeekly.week_start).filter(NetworkForecastWeekly.sku == sku)
        if node:
            query = query.filter(NetworkForecastWeekly.node_id == node)
        row = query.order_by(NetworkForecastWeekly.week_start.asc()).first()
        if row and row[0]:
            try:
                return date.fromisoformat(row[0])
            except ValueError:
                return DEFAULT_BASE_WEEK
        return DEFAULT_BASE_WEEK

    def _forecast_map(self, sku: str, node: str | None, base_week: date) -> dict[int, float]:
        query = self.db.query(NetworkForecastWeekly).filter(NetworkForecastWeekly.sku == sku)
        if node:
            query = query.filter(NetworkForecastWeekly.node_id == node)
        rows = query.all()
        output: dict[int, float] = {}
        for row in rows:
            try:
                week = date.fromisoformat(row.week_start)
            except ValueError:
                continue
            delta_days = (week - base_week).days
            if delta_days % 7 != 0:
                continue
            week_offset = (delta_days // 7) + 1
            if 1 <= week_offset <= 12:
                output[week_offset] = float(row.forecast_qty)
        return output

    def _orders_map(
        self,
        sku: str,
        node: str | None,
        base_week: date,
    ) -> tuple[dict[int, float], dict[int, float], dict[int, float], dict[int, list[str]], dict[int, list[str]]]:
        query = (
            self.db.query(ReplenishmentOrderDetail, ReplenishmentOrder)
            .join(ReplenishmentOrder, ReplenishmentOrder.order_id == ReplenishmentOrderDetail.order_id)
            .filter(ReplenishmentOrderDetail.sku == sku)
        )
        if node:
            query = query.filter(ReplenishmentOrderDetail.ship_to_node_id == node)
        rows = query.all()
        demo_rows = [row for row in rows if str(row[0].order_id).startswith("RO-PROJ-")]
        autonomous_rows = [row for row in rows if str(row[0].order_id).startswith("AUTO-RO-")]
        if demo_rows:
            # Keep demo-baseline orders for stable walkthroughs, but always include
            # autonomous orders so Workflow 3 visibly improves projections.
            rows = demo_rows + autonomous_rows
        # Orders with active alert links are treated as exceptions for projection rendering.
        alert_linked_order_ids: set[str] = set()
        all_order_ids = {str(r[0].order_id) for r in rows}
        if all_order_ids:
            alert_linked_order_ids = {
                str(link.order_id)
                for link in self.db.query(ReplenishmentOrderAlertLink)
                .filter(
                    ReplenishmentOrderAlertLink.order_id.in_(list(all_order_ids)),
                    ReplenishmentOrderAlertLink.link_status == "active",
                )
                .all()
            }
        qty_map: dict[int, float] = {}
        qty_non_exception_map: dict[int, float] = {}
        qty_exception_map: dict[int, float] = {}
        id_map: dict[int, list[str]] = {}
        exception_id_map: dict[int, list[str]] = {}
        for detail_row, header_row in rows:
            eta_raw = header_row.eta
            if not eta_raw:
                continue
            eta = eta_raw.split("T")[0]
            try:
                eta_day = date.fromisoformat(eta)
            except ValueError:
                continue
            delta_days = (eta_day - base_week).days
            if delta_days < 0:
                continue
            week_offset = (delta_days // 7) + 1
            if not (1 <= week_offset <= 12):
                continue
            detail_qty = float(detail_row.order_qty)
            qty_map[week_offset] = qty_map.get(week_offset, 0.0) + detail_qty
            id_map.setdefault(week_offset, []).append(str(detail_row.order_id))
            is_exc = bool(header_row.is_exception) or str(detail_row.order_id) in alert_linked_order_ids
            if is_exc:
                qty_exception_map[week_offset] = qty_exception_map.get(week_offset, 0.0) + detail_qty
                exception_id_map.setdefault(week_offset, []).append(str(detail_row.order_id))
            else:
                qty_non_exception_map[week_offset] = qty_non_exception_map.get(week_offset, 0.0) + detail_qty

        for week_offset in id_map:
            id_map[week_offset] = sorted(set(id_map[week_offset]))
        for week_offset in exception_id_map:
            exception_id_map[week_offset] = sorted(set(exception_id_map[week_offset]))
        return qty_map, qty_non_exception_map, qty_exception_map, id_map, exception_id_map

    def _opening_stock(self, sku: str, node: str | None, base_week: date) -> float:
        query = self.db.query(NetworkInventorySnapshot).filter(NetworkInventorySnapshot.sku == sku)
        if node:
            query = query.filter(NetworkInventorySnapshot.node_id == node)
        rows = query.all()
        best_qty: float | None = None
        best_date: date | None = None
        for row in rows:
            try:
                as_of = date.fromisoformat(row.as_of_date)
            except ValueError:
                continue
            if as_of > base_week:
                continue
            if best_date is None or as_of > best_date:
                best_date = as_of
                best_qty = float(row.on_hand_qty)
        return best_qty if best_qty is not None else 0.0

    def _batches_for(self, sku: str, node: str | None, base_week: date) -> list[dict[str, Any]]:
        """Return all batches for sku/node as of the latest snapshot on-or-before base_week.

        Each batch row is returned as a plain dict with parsed expiry/received dates
        and a derived ``rsl_days`` (remaining shelf life vs base_week).
        """
        query = self.db.query(InventoryBatchSnapshot).filter(InventoryBatchSnapshot.sku == sku)
        if node:
            query = query.filter(InventoryBatchSnapshot.node_id == node)
        rows = query.all()
        if not rows:
            return []
        # Pick the most-recent as_of_date <= base_week (per-sku/node).
        by_pair: dict[tuple[str, str], list[InventoryBatchSnapshot]] = {}
        for row in rows:
            try:
                as_of = date.fromisoformat(row.as_of_date)
            except (TypeError, ValueError):
                continue
            if as_of > base_week:
                continue
            by_pair.setdefault((row.sku, row.node_id), []).append(row)
        # For each (sku,node) pair, keep the rows belonging to the max as_of_date.
        selected: list[InventoryBatchSnapshot] = []
        for pair_rows in by_pair.values():
            latest = max(pair_rows, key=lambda r: r.as_of_date)
            for r in pair_rows:
                if r.as_of_date == latest.as_of_date:
                    selected.append(r)
        out: list[dict[str, Any]] = []
        for r in selected:
            try:
                exp = date.fromisoformat(r.expiry_date)
            except (TypeError, ValueError):
                continue
            try:
                received = date.fromisoformat(r.received_date) if r.received_date else None
            except (TypeError, ValueError):
                received = None
            out.append({
                "batch_id": r.batch_id,
                "sku": r.sku,
                "node_id": r.node_id,
                "batch_qty": float(r.batch_qty or 0.0),
                "expiry_date": exp,
                "received_date": received,
                "quality_hold_flag": bool(r.quality_hold_flag),
                "rsl_days": (exp - base_week).days,
            })
        # Sort by expiry ascending so "oldest first" consumption is natural.
        out.sort(key=lambda b: b["expiry_date"])
        return out

    def _sellable_on_hand(
        self,
        batches: list[dict[str, Any]],
        as_of_date: date,
    ) -> float:
        """Sum batch_qty for batches with expiry strictly after as_of_date and no quality hold."""
        total = 0.0
        for b in batches:
            if b["quality_hold_flag"]:
                continue
            if b["expiry_date"] > as_of_date:
                total += b["batch_qty"]
        return total

    def _consume_batches_fefo(
        self,
        remaining_batches: list[dict[str, Any]],
        consume_qty: float,
        inbound_qty: float,
        week_start: date,
        week_end: date,
    ) -> tuple[list[dict[str, Any]], float, float]:
        """Apply a week of demand to the batch pool using First-Expire-First-Out.

        Returns ``(remaining_batches, expired_qty_this_week, sellable_ending)``.
        Batches expiring on-or-before ``week_end`` that are NOT consumed during
        the week are written off as ``expired_qty``. Inbound supply is treated
        as a fresh batch with expiry 30 days after the week (the product's
        shelf_life_days gates this more precisely in practice; we use a safe
        default so generic non-perishable flows keep working).
        """
        # 1) Add inbound as a single fresh batch (if any).
        if inbound_qty > 0:
            remaining_batches = list(remaining_batches) + [{
                "batch_id": f"INBOUND-{week_start.isoformat()}",
                "sku": remaining_batches[0]["sku"] if remaining_batches else None,
                "node_id": remaining_batches[0]["node_id"] if remaining_batches else None,
                "batch_qty": float(inbound_qty),
                "expiry_date": week_end + timedelta(days=30),
                "received_date": week_start,
                "quality_hold_flag": False,
                "rsl_days": 30 + (week_end - week_start).days,
            }]
            remaining_batches.sort(key=lambda b: b["expiry_date"])

        # 2) Consume in FEFO order across the week, skipping already-expired
        # and quality-held batches (quality holds are not sellable).
        to_consume = max(0.0, float(consume_qty))
        updated: list[dict[str, Any]] = []
        for b in remaining_batches:
            if b["batch_qty"] <= 0:
                continue
            # Quality-held batches are never consumed — kept in pool untouched.
            if b.get("quality_hold_flag"):
                updated.append(b)
                continue
            # A batch expiring on-or-before week_start is already unusable when
            # demand starts accruing — treat as pre-waste (handled below).
            if b["expiry_date"] <= week_start:
                updated.append(b)
                continue
            if to_consume <= 0:
                updated.append(b)
                continue
            take = min(to_consume, b["batch_qty"])
            new_qty = b["batch_qty"] - take
            to_consume -= take
            if new_qty > 0:
                nb = dict(b)
                nb["batch_qty"] = new_qty
                updated.append(nb)
        # 3) Compute expired qty = any remaining batch whose expiry falls in
        # (week_start, week_end] or before. Drop them from the pool.
        expired_qty = 0.0
        kept: list[dict[str, Any]] = []
        for b in updated:
            if b["expiry_date"] <= week_end:
                expired_qty += b["batch_qty"]
            else:
                kept.append(b)
        sellable_ending = sum(b["batch_qty"] for b in kept if not b["quality_hold_flag"])
        return kept, round(expired_qty, 2), round(sellable_ending, 2)

    def _parameter_float(self, sku: str, node: str | None, code: str) -> float | None:
        if not node:
            return None
        row = (
            self.db.query(ParameterValue)
            .filter(
                and_(
                    ParameterValue.sku == sku,
                    ParameterValue.location == node,
                    ParameterValue.parameter_code == code,
                )
            )
            .first()
        )
        if not row:
            return None
        try:
            return float(row.effective_value)
        except (TypeError, ValueError):
            return None

    def _saved_overrides(self, sku: str, node: str | None, scenario_id: str | None) -> dict[int, tuple[float | None, float | None]]:
        if not scenario_id:
            return {}
        query = self.db.query(SimulationScenario).filter(
            and_(
                SimulationScenario.scenario_id == scenario_id,
                SimulationScenario.product_id == sku,
            )
        )
        if node:
            query = query.filter(SimulationScenario.location_code == node)
        rows = query.all()
        return {int(row.week_offset): (row.modified_forecast, row.modified_orders) for row in rows}

    def get_projection(
        self,
        sku: str,
        location: str | None = None,
        scenario_id: str | None = None,
        runtime_overrides: dict[int, tuple[float | None, float | None]] | None = None,
        include_demo_examples: bool = True,
    ) -> dict[str, object]:
        node = location
        product = self.db.query(ProductMaster).filter(ProductMaster.sku == sku).first()
        if product is None:
            raise KeyError(f"Unknown SKU: {sku}")

        base_week = self._base_week_for(sku, node)
        config = self._config_for(sku)
        forecast_map = self._forecast_map(sku, node, base_week)
        (
            orders_map,
            orders_non_exception_map,
            orders_exception_map,
            order_ids_map,
            order_exception_ids_map,
        ) = self._orders_map(sku, node, base_week)
        opening_stock = self._opening_stock(sku, node, base_week)
        batches = self._batches_for(sku, node, base_week)
        batch_mode = bool(batches)
        opening_sellable = self._sellable_on_hand(batches, base_week) if batch_mode else opening_stock

        demand_values = [value for value in forecast_map.values() if value > 0]
        avg_weekly_demand = sum(demand_values) / len(demand_values) if demand_values else 100.0
        lead_time_weeks = max(1.0, config.lead_time_days / 7.0)

        ss_from_param = self._parameter_float(sku, node, "safety_stock_qty")
        rop_from_param = self._parameter_float(sku, node, "reorder_point_qty")

        if ss_from_param is None:
            sigma = config.demand_std_dev if config.demand_std_dev > 0 else max(1.0, avg_weekly_demand * 0.25)
            safety_stock = round(self._z_score(config.service_level_target) * sigma * math.sqrt(lead_time_weeks), 2)
        else:
            safety_stock = round(ss_from_param, 2)

        if rop_from_param is None:
            reorder_point = round((avg_weekly_demand * lead_time_weeks) + safety_stock, 2)
        else:
            reorder_point = round(rop_from_param, 2)

        saved = self._saved_overrides(sku, node, scenario_id)
        live = runtime_overrides or {}
        merged_overrides = {**saved, **live}

        rows: list[dict[str, object]] = []
        running_planned = opening_stock
        running_actual = opening_stock
        running_sellable = opening_sellable
        running_batches = list(batches) if batch_mode else []
        total_expired = 0.0
        # Earliest RSL across ALL base-week batches (regardless of quality hold)
        # — used by the expiring_batch_risk detector so a fresh batch consumed
        # in week 1 doesn't hide the fact that we had RSL=1 stock on-hand today.
        base_earliest_rsl_days: int | None = None
        base_earliest_expiry_date: str | None = None
        if batch_mode and batches:
            first_base = batches[0]
            base_earliest_rsl_days = first_base["rsl_days"]
            base_earliest_expiry_date = first_base["expiry_date"].isoformat()
        for week_offset in range(1, 13):
            forecast = float(forecast_map.get(week_offset, 0.0))
            orders = float(orders_map.get(week_offset, 0.0))
            orders_non_exception = float(orders_non_exception_map.get(week_offset, 0.0))
            orders_exception = float(orders_exception_map.get(week_offset, 0.0))
            order_ids = order_ids_map.get(week_offset, [])
            order_exception_ids = order_exception_ids_map.get(week_offset, [])
            simulated = False
            if week_offset in merged_overrides:
                override_forecast, override_orders = merged_overrides[week_offset]
                if override_forecast is not None:
                    forecast = float(override_forecast)
                    simulated = True
                if override_orders is not None:
                    orders = float(override_orders)
                    # Preserve exception split as much as possible when planners override total orders.
                    orders_exception = min(orders_exception, max(0.0, orders))
                    orders_non_exception = max(0.0, orders - orders_exception)
                    order_ids = []
                    order_exception_ids = []
                    simulated = True

            projected_planned = round(running_planned - forecast + orders, 2)
            projected_actual = round(running_actual - forecast + orders_non_exception, 2)

            # Shelf-life-aware projection (batch-grain, FEFO consumption).
            week_start = date.fromisoformat(self._iso_week(base_week, week_offset))
            week_end = week_start + timedelta(days=6)
            expired_qty_week = 0.0
            sellable_ending = projected_actual
            if batch_mode:
                running_batches, expired_qty_week, sellable_ending = self._consume_batches_fefo(
                    running_batches,
                    consume_qty=max(0.0, forecast),
                    inbound_qty=max(0.0, orders_non_exception),
                    week_start=week_start,
                    week_end=week_end,
                )
                total_expired += expired_qty_week

            earliest_exp: str | None = None
            batch_rsl_min: int | None = None
            if batch_mode and running_batches:
                first = running_batches[0]
                earliest_exp = first["expiry_date"].isoformat()
                batch_rsl_min = max(0, (first["expiry_date"] - week_start).days)

            rows.append(
                {
                    "week_offset": week_offset,
                    "week_start_date": week_start.isoformat(),
                    "current_on_hand_qty": opening_stock if week_offset == 1 else None,
                    "current_sellable_on_hand_qty": opening_sellable if week_offset == 1 else None,
                    "forecast_qty": forecast,
                    "orders_qty": orders,
                    "orders_non_exception_qty": orders_non_exception,
                    "orders_exception_qty": orders_exception,
                    "order_ids": order_ids,
                    "order_exception_ids": order_exception_ids,
                    "safety_stock_qty": safety_stock,
                    "reorder_point_qty": reorder_point,
                    "projected_on_hand_actual_qty": projected_actual,
                    "projected_on_hand_planned_qty": projected_planned,
                    # Keep legacy field as planned projection for backward compatibility.
                    "projected_on_hand_qty": projected_planned,
                    "sellable_on_hand_qty": round(sellable_ending, 2),
                    "expired_qty_week": round(expired_qty_week, 2),
                    "earliest_batch_expiry_date": earliest_exp,
                    "earliest_batch_rsl_days": batch_rsl_min,
                    "base_earliest_rsl_days": base_earliest_rsl_days,
                    "base_earliest_expiry_date": base_earliest_expiry_date,
                    "batch_mode": batch_mode,
                    "below_rop": projected_actual < reorder_point,
                    "below_safety_stock": projected_actual < safety_stock,
                    "stockout": projected_actual < 0,
                    "sellable_below_forecast": batch_mode and sellable_ending < forecast,
                    "simulated": simulated,
                }
            )
            running_planned = projected_planned
            running_actual = projected_actual
            running_sellable = sellable_ending

        batch_summary: list[dict[str, Any]] = []
        if batch_mode:
            for b in batches:
                batch_summary.append({
                    "batch_id": b["batch_id"],
                    "batch_qty": b["batch_qty"],
                    "expiry_date": b["expiry_date"].isoformat(),
                    "received_date": b["received_date"].isoformat() if b["received_date"] else None,
                    "rsl_days": b["rsl_days"],
                    "quality_hold_flag": b["quality_hold_flag"],
                })
        return {
            "sku": sku,
            "product_name": product.name,
            "location": node,
            "opening_stock": opening_stock,
            "opening_sellable_on_hand": opening_sellable,
            "batch_mode": batch_mode,
            "shelf_life_days": getattr(product, "shelf_life_days", None),
            "cold_chain_flag": bool(getattr(product, "cold_chain_flag", False)),
            "batches_at_base_week": batch_summary,
            "total_expired_qty_in_horizon": round(total_expired, 2) if batch_mode else 0.0,
            "lead_time_days": config.lead_time_days,
            "service_level_target": config.service_level_target,
            "safety_stock_method": "parameter_or_z_sigma_sqrt_lt",
            "generated_at": datetime.utcnow().isoformat(),
            "weeks": rows,
            "available_skus": self._available_skus(),
            "available_nodes": self._available_nodes(sku),
            "scenario_id": scenario_id,
            "demo_examples": self._demo_examples() if include_demo_examples else [],
        }

    # ------------------------------------------------------------------
    # Hourly projection — used by the Demand Sensing Agent to detect
    # real-time shortage in the next N hours given the latest on-hand +
    # rolling POS velocity.
    # ------------------------------------------------------------------

    def project_hourly(
        self,
        sku: str,
        node: str,
        *,
        horizon_hours: int = 6,
        as_of: datetime | None = None,
        uplift_multiplier: float = 1.0,
    ) -> dict[str, Any]:
        """Project on-hand at hourly grain for the next ``horizon_hours``.

        Inputs:
          - Latest ``PosHourlyActual.on_hand_snapshot_qty`` for this sku/node, or
            falls back to ``NetworkInventorySnapshot.on_hand_qty``.
          - Rolling per-hour units_sold from ``PosHourlyActual`` over the last
            48 hours → used as baseline velocity, optionally boosted by
            ``uplift_multiplier`` for what-if scenarios.
          - Ramadan Iftar lookup: if today is a Ramadan day, Iftar hours get a
            1.4x spike; if today's hour matches ``peak_hour_local`` in
            StoreVelocity (optional), apply 1.2x.

        Returns ``{as_of, on_hand_start, hours: [...], iftar_local_time,
        ramadan_day, predicted_shortage_hour, predicted_shortage_qty}``.
        Each hour row: ``{hour_offset, hour_label, pos_predicted_units,
        on_hand_ending, shortage_flag, iftar_in_window}``.
        """
        now = as_of or datetime.now().replace(second=0, microsecond=0)
        horizon_hours = max(1, int(horizon_hours))
        pos_rows = (
            self.db.query(PosHourlyActual)
            .filter(
                PosHourlyActual.sku == sku,
                PosHourlyActual.node_id == node,
            )
            .order_by(PosHourlyActual.timestamp_hour.desc())
            .limit(48)
            .all()
        )
        if not pos_rows:
            baseline_uph = 0.0
            latest_on_hand: float | None = None
        else:
            recent = pos_rows[:24]
            total_units = sum(float(r.units_sold or 0.0) for r in recent)
            baseline_uph = total_units / max(1, len(recent))
            latest_on_hand = float(pos_rows[0].on_hand_snapshot_qty or 0.0)
        if latest_on_hand is None or latest_on_hand <= 0:
            latest_on_hand = self._opening_stock(sku, node, now.date())
        hourly_rate = baseline_uph * max(0.0, float(uplift_multiplier))

        today_iso = now.date().isoformat()
        ramadan = (
            self.db.query(RamadanCalendar)
            .filter(RamadanCalendar.calendar_date == today_iso)
            .first()
        )
        iftar_hour: int | None = None
        iftar_local_time: str | None = None
        ramadan_day: int | None = None
        if ramadan is not None and ramadan.ramadan_day:
            ramadan_day = int(ramadan.ramadan_day)
            iftar_local_time = ramadan.iftar_local_time
            try:
                if ramadan.iftar_local_time:
                    iftar_hour = int(ramadan.iftar_local_time.split(":")[0])
            except (ValueError, AttributeError):
                iftar_hour = None

        running_on_hand = float(latest_on_hand)
        hours: list[dict[str, Any]] = []
        shortage_hour: int | None = None
        shortage_qty: float = 0.0
        for offset in range(horizon_hours):
            hour_start = now + timedelta(hours=offset)
            hour_of_day = hour_start.hour
            iftar_in_window = (
                iftar_hour is not None and iftar_hour - 1 <= hour_of_day <= iftar_hour + 1
            )
            mult = 1.4 if iftar_in_window else 1.0
            predicted = hourly_rate * mult
            running_on_hand = round(running_on_hand - predicted, 2)
            row = {
                "hour_offset": offset,
                "hour_label": hour_start.strftime("%H:00"),
                "hour_start_iso": hour_start.isoformat(),
                "pos_predicted_units": round(predicted, 2),
                "on_hand_ending": running_on_hand,
                "shortage_flag": running_on_hand < 0,
                "iftar_in_window": iftar_in_window,
            }
            hours.append(row)
            if running_on_hand < 0 and shortage_hour is None:
                shortage_hour = offset
                shortage_qty = abs(running_on_hand)
        return {
            "sku": sku,
            "node_id": node,
            "as_of": now.isoformat(),
            "on_hand_start": round(float(latest_on_hand), 2),
            "baseline_units_per_hour": round(baseline_uph, 2),
            "uplift_multiplier": uplift_multiplier,
            "hours": hours,
            "iftar_local_time": iftar_local_time,
            "iftar_hour_local": iftar_hour,
            "ramadan_day": ramadan_day,
            "predicted_shortage_hour": shortage_hour,
            "predicted_shortage_qty": round(shortage_qty, 2),
        }

    # ------------------------------------------------------------------

    def save_scenario(
        self,
        sku: str,
        location: str | None,
        user_id: str,
        overrides: list[dict[str, object]],
        scenario_id: str | None = None,
    ) -> dict[str, object]:
        node = location
        now = datetime.utcnow()
        resolved_scenario_id = scenario_id or f"SCN-INV-{now.strftime('%Y%m%d%H%M%S')}"
        query = self.db.query(SimulationScenario).filter(
            and_(
                SimulationScenario.scenario_id == resolved_scenario_id,
                SimulationScenario.product_id == sku,
            )
        )
        if node:
            query = query.filter(SimulationScenario.location_code == node)
        query.delete()

        created_at = now.isoformat()
        inserted = 0
        for item in overrides:
            week_offset = int(item.get("week_offset", 0))
            if week_offset < 1 or week_offset > 12:
                continue
            self.db.add(
                SimulationScenario(
                    scenario_id=resolved_scenario_id,
                    user_id=user_id,
                    product_id=sku,
                    location_code=node,
                    week_offset=week_offset,
                    modified_forecast=item.get("modified_forecast"),
                    modified_orders=item.get("modified_orders"),
                    created_at=created_at,
                )
            )
            inserted += 1
        self.db.commit()
        return {"scenario_id": resolved_scenario_id, "saved_rows": inserted, "created_at": created_at}
