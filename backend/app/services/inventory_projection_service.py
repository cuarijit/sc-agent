from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from statistics import NormalDist

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models import (
    InventoryProjectionProductConfig,
    NetworkForecastWeekly,
    NetworkInventorySnapshot,
    NetworkSourcingRule,
    ParameterValue,
    ProductMaster,
    ReplenishmentOrder,
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
        if demo_rows:
            rows = demo_rows
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
            if bool(header_row.is_exception):
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
            rows.append(
                {
                    "week_offset": week_offset,
                    "week_start_date": self._iso_week(base_week, week_offset),
                    "current_on_hand_qty": opening_stock if week_offset == 1 else None,
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
                    "below_rop": projected_actual < reorder_point,
                    "below_safety_stock": projected_actual < safety_stock,
                    "stockout": projected_actual < 0,
                    "simulated": simulated,
                }
            )
            running_planned = projected_planned
            running_actual = projected_actual

        return {
            "sku": sku,
            "product_name": product.name,
            "location": node,
            "opening_stock": opening_stock,
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
