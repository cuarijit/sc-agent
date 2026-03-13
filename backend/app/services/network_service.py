from __future__ import annotations

import json
from datetime import date, datetime, timedelta

from sqlalchemy import and_
from sqlalchemy.orm import Session

from ..models import (
    NetworkAgentResult,
    NetworkAlert,
    NetworkActualWeekly,
    NetworkDemandSignal,
    NetworkForecastWeekly,
    NetworkInventorySnapshot,
    NetworkLane,
    NetworkNode,
    NetworkPosWeekly,
    NetworkScenario,
    NetworkScenarioChange,
    NetworkSimulationMetric,
    NetworkSimulationRun,
    NetworkSkuLocationParameter,
    NetworkSourcingRule,
    ProductMaster,
    ReplenishmentOrder,
)
from .llm_service import resolve_llm_selection


NOW = datetime(2026, 3, 8, 10, 0, 0)


def _ts(offset_minutes: int = 0) -> str:
    return (NOW + timedelta(minutes=offset_minutes)).isoformat()


class NetworkService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _node_payload(self, row: NetworkNode) -> dict[str, object]:
        return {
            "node_id": row.node_id,
            "name": row.name,
            "node_type": row.node_type,
            "region": row.region,
            "lat": row.lat,
            "lon": row.lon,
            "status": row.status,
            "storage_capacity": row.storage_capacity,
            "throughput_limit": row.throughput_limit,
            "crossdock_capable": row.crossdock_capable,
            "holding_cost_per_unit": row.holding_cost_per_unit,
            "handling_cost_per_unit": row.handling_cost_per_unit,
            "service_level_target": row.service_level_target,
            "production_batch_size": row.production_batch_size,
            "production_freeze_days": row.production_freeze_days,
            "cycle_time_days": row.cycle_time_days,
            "shelf_space_limit": row.shelf_space_limit,
            "default_strategy": row.default_strategy,
            "metadata_json": row.metadata_json,
        }

    def _lane_payload(self, row: NetworkLane) -> dict[str, object]:
        return {
            "lane_id": row.lane_id,
            "origin_node_id": row.origin_node_id,
            "dest_node_id": row.dest_node_id,
            "mode": row.mode,
            "lane_status": row.lane_status,
            "cost_function_type": row.cost_function_type,
            "cost_per_unit": row.cost_per_unit,
            "cost_per_mile": row.cost_per_mile,
            "fixed_cost": row.fixed_cost,
            "transit_time_mean_days": row.transit_time_mean_days,
            "transit_time_std_days": row.transit_time_std_days,
            "capacity_limit": row.capacity_limit,
            "is_default_route": row.is_default_route,
        }

    def _alert_payload(self, row: NetworkAlert) -> dict[str, object]:
        return {
            "alert_id": row.alert_id,
            "alert_type": row.alert_type,
            "severity": row.severity,
            "title": row.title,
            "description": row.description,
            "impacted_node_id": row.impacted_node_id,
            "impacted_sku": row.impacted_sku,
            "impacted_lane_id": row.impacted_lane_id,
            "effective_from": row.effective_from,
            "effective_to": row.effective_to,
            "recommended_action_json": row.recommended_action_json,
        }

    def _saved_scenarios(self) -> list[dict[str, object]]:
        return [
            {
                "scenario_id": item.scenario_id,
                "scenario_name": item.scenario_name,
                "status": item.status,
                "created_at": item.created_at,
                "origin_context": item.origin_context,
            }
            for item in self.db.query(NetworkScenario).filter(NetworkScenario.status == "saved").order_by(NetworkScenario.created_at.desc()).all()
        ]

    @staticmethod
    def _normalize_list(values: str | list[str] | None) -> list[str]:
        if values is None:
            return []
        if isinstance(values, list):
            return [str(item).strip() for item in values if str(item).strip()]
        value = str(values).strip()
        return [value] if value else []

    def get_baseline_network(
        self,
        region: str | None = None,
        product: str | None = None,
        scenario_id: str | None = None,
        alert_id: str | list[str] | None = None,
        alert_type: str | list[str] | None = None,
        severity: str | list[str] | None = None,
    ) -> dict[str, object]:
        nodes_query = self.db.query(NetworkNode)
        if region:
            nodes_query = nodes_query.filter(NetworkNode.region == region)
        nodes = nodes_query.order_by(NetworkNode.node_type.asc(), NetworkNode.name.asc()).all()
        if region and not nodes:
            nodes = self.db.query(NetworkNode).order_by(NetworkNode.node_type.asc(), NetworkNode.name.asc()).all()
        node_ids = {item.node_id for item in nodes}
        lanes = self.db.query(NetworkLane).filter(and_(NetworkLane.origin_node_id.in_(node_ids), NetworkLane.dest_node_id.in_(node_ids))).all() if node_ids else []
        alerts_query = self.db.query(NetworkAlert)
        alert_ids = self._normalize_list(alert_id)
        if alert_ids:
            alerts_query = alerts_query.filter(NetworkAlert.alert_id.in_(alert_ids))
        alert_types = self._normalize_list(alert_type)
        if alert_types:
            alerts_query = alerts_query.filter(NetworkAlert.alert_type.in_(alert_types))
        severities = self._normalize_list(severity)
        if severities:
            alerts_query = alerts_query.filter(NetworkAlert.severity.in_(severities))
        alerts = alerts_query.order_by(NetworkAlert.severity.desc()).all()
        demand_query = self.db.query(NetworkDemandSignal)
        if product:
            demand_query = demand_query.filter(NetworkDemandSignal.sku == product)
        demand_rows = demand_query.all()
        total_forecast = sum(item.forecast_qty for item in demand_rows)
        total_actual = sum(item.actual_qty for item in demand_rows)
        sourcing_rows = self.db.query(NetworkSourcingRule).all()
        parameter_rows = self.db.query(NetworkSkuLocationParameter).all()
        sourcing_keys = {
            (item.sku, item.dest_node_id, item.parent_location_node_id or "")
            for item in sourcing_rows
        }
        parameter_keys = {
            (item.sku, item.location_node_id, item.parent_location_node_id)
            for item in parameter_rows
        }
        aligned_keys = sourcing_keys.intersection(parameter_keys)
        summary_metrics = {
            "node_count": float(len(nodes)),
            "lane_count": float(len(lanes)),
            "active_alerts": float(len(alerts)),
            "weekly_forecast_qty": round(total_forecast, 2),
            "weekly_actual_qty": round(total_actual, 2),
            "sku_node_sourcing_rows": float(len(sourcing_rows)),
            "sku_node_parameter_rows": float(len(parameter_rows)),
            "sku_node_alignment_keys": float(len(aligned_keys)),
            "sku_node_alignment_gap": float(abs(len(sourcing_keys) - len(parameter_keys))),
        }
        return {
            "nodes": [self._node_payload(item) for item in nodes],
            "lanes": [self._lane_payload(item) for item in lanes],
            "alerts": [self._alert_payload(item) for item in alerts],
            "summary_metrics": summary_metrics,
            "saved_scenarios": self._saved_scenarios(),
        }

    def get_network_options(self) -> dict[str, object]:
        regions = sorted({item.region for item in self.db.query(NetworkNode).all()})
        products = sorted({item.sku for item in self.db.query(ProductMaster).all()})
        return {
            "node_types": ["supplier", "plant", "cdc", "rdc", "online_rdc", "store", "3pl", "customer"],
            "transport_modes": ["tl", "ltl", "parcel", "intermodal", "ocean", "air"],
            "strategy_options": ["push", "pull", "hybrid"],
            "service_level_presets": [0.9, 0.95, 0.97, 0.99],
            "regions": regions,
            "products": products,
            "location_types": ["supplier", "plant", "distribution", "store", "customer", "3pl"],
        }

    def create_network_scenario(self, payload: dict[str, object]) -> dict[str, object]:
        next_index = self.db.query(NetworkScenario).count() + 1
        scenario_id = f"NET-SCN-{next_index:03d}"
        row = NetworkScenario(
            scenario_id=scenario_id,
            scenario_name=str(payload["scenario_name"]),
            base_version="BASELINE-V1",
            status="draft",
            created_at=_ts(next_index),
            created_by="planner",
            origin_context=str(payload.get("origin_context") or "manual"),
            notes=str(payload.get("notes")) if payload.get("notes") else None,
        )
        self.db.add(row)
        self.db.commit()
        return {
            "scenario_id": scenario_id,
            "status": "draft",
            "draft_summary": {
                "scenario_name": row.scenario_name,
                "origin_context": row.origin_context,
                "source_alert_id": payload.get("source_alert_id"),
                "change_count": 0,
            },
        }

    def update_network_scenario(self, scenario_id: str, payload: dict[str, object]) -> dict[str, object]:
        row = self.db.query(NetworkScenario).filter(NetworkScenario.scenario_id == scenario_id).first()
        if row is None:
            raise KeyError(scenario_id)
        if payload.get("scenario_name"):
            row.scenario_name = str(payload["scenario_name"])
        if payload.get("notes") is not None:
            row.notes = str(payload["notes"])
        if payload.get("status"):
            row.status = str(payload["status"])
        self.db.commit()
        return {
            "scenario_id": row.scenario_id,
            "status": row.status,
            "draft_summary": {
                "scenario_name": row.scenario_name,
                "origin_context": row.origin_context,
                "change_count": self.db.query(NetworkScenarioChange).filter(NetworkScenarioChange.scenario_id == scenario_id).count(),
            },
        }

    def apply_network_change(self, scenario_id: str, payload: dict[str, object]) -> dict[str, object]:
        if self.db.query(NetworkScenario).filter(NetworkScenario.scenario_id == scenario_id).first() is None:
            raise KeyError(scenario_id)
        change = NetworkScenarioChange(
            scenario_id=scenario_id,
            change_type=str(payload["change_type"]),
            entity_type=str(payload["entity_type"]),
            entity_id=str(payload["entity_id"]) if payload.get("entity_id") else None,
            payload_json=json.dumps(payload.get("payload") or {}),
        )
        self.db.add(change)
        self.db.commit()
        return {"scenario_id": scenario_id, "change_id": change.id, "status": "applied"}

    def _apply_changes(self, nodes: list[dict[str, object]], lanes: list[dict[str, object]], changes: list[NetworkScenarioChange]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
        node_map = {item["node_id"]: dict(item) for item in nodes}
        lane_map = {item["lane_id"]: dict(item) for item in lanes}
        for change in changes:
            payload = json.loads(change.payload_json or "{}")
            if change.change_type == "add_node":
                node_id = str(payload["node_id"])
                node_map[node_id] = payload
            elif change.change_type == "update_node" and change.entity_id and change.entity_id in node_map:
                node_map[change.entity_id].update(payload)
            elif change.change_type == "add_lane":
                lane_id = str(payload["lane_id"])
                lane_map[lane_id] = payload
            elif change.change_type == "update_lane" and change.entity_id and change.entity_id in lane_map:
                lane_map[change.entity_id].update(payload)
            elif change.change_type == "remove_lane" and change.entity_id:
                lane_map.pop(change.entity_id, None)
            elif change.change_type == "outage" and change.entity_type == "node" and change.entity_id and change.entity_id in node_map:
                node_map[change.entity_id]["status"] = "disrupted"
            elif change.change_type == "outage" and change.entity_type == "lane" and change.entity_id and change.entity_id in lane_map:
                lane_map[change.entity_id]["lane_status"] = "disrupted"
        return list(node_map.values()), list(lane_map.values())

    def get_network_scenario(self, scenario_id: str) -> dict[str, object]:
        scenario = self.db.query(NetworkScenario).filter(NetworkScenario.scenario_id == scenario_id).first()
        if scenario is None:
            raise KeyError(scenario_id)
        baseline = self.get_baseline_network()
        changes = self.db.query(NetworkScenarioChange).filter(NetworkScenarioChange.scenario_id == scenario_id).order_by(NetworkScenarioChange.id.asc()).all()
        nodes, lanes = self._apply_changes(baseline["nodes"], baseline["lanes"], changes)
        latest_run = self.db.query(NetworkSimulationRun).filter(NetworkSimulationRun.scenario_id == scenario_id).order_by(NetworkSimulationRun.started_at.desc()).first()
        latest_simulation = json.loads(latest_run.summary_json) if latest_run else None
        return {
            "scenario": {
                "scenario_id": scenario.scenario_id,
                "scenario_name": scenario.scenario_name,
                "status": scenario.status,
                "created_at": scenario.created_at,
                "origin_context": scenario.origin_context,
            },
            "nodes": nodes,
            "lanes": lanes,
            "changes": [
                {
                    "id": item.id,
                    "change_type": item.change_type,
                    "entity_type": item.entity_type,
                    "entity_id": item.entity_id,
                    "payload": json.loads(item.payload_json or "{}"),
                }
                for item in changes
            ],
            "latest_simulation": latest_simulation,
        }

    def simulate_network_scenario(self, scenario_id: str) -> dict[str, object]:
        scenario_view = self.get_network_scenario(scenario_id)
        baseline = self.get_baseline_network()
        baseline_nodes = baseline["nodes"]
        baseline_lanes = baseline["lanes"]
        scenario_nodes = scenario_view["nodes"]
        scenario_lanes = scenario_view["lanes"]
        demand_rows = self.db.query(NetworkDemandSignal).all()
        total_actual = sum(item.actual_qty for item in demand_rows)
        total_forecast = sum(item.forecast_qty for item in demand_rows)
        avg_volatility = (sum(item.volatility_index for item in demand_rows) / len(demand_rows)) if demand_rows else 0.0

        def _calc_metrics(nodes: list[dict[str, object]], lanes: list[dict[str, object]], disruption_penalty: float) -> dict[str, float]:
            active_lanes = [item for item in lanes if item.get("lane_status") != "inactive"]
            disrupted_nodes = [item for item in nodes if item.get("status") == "disrupted"]
            transport = sum(float(item["cost_per_unit"]) * 1000.0 + float(item["fixed_cost"]) for item in active_lanes)
            lead_time_factor = sum(float(item["transit_time_mean_days"]) for item in active_lanes) / max(len(active_lanes), 1)
            service_level = max(0.7, min(0.999, 0.985 - (len(disrupted_nodes) * 0.007) - disruption_penalty - (avg_volatility * 0.005)))
            safety_stock = (total_forecast * 0.07) + (len(nodes) * 220.0) + (lead_time_factor * 40.0)
            inventory_cost = safety_stock * 1.15
            margin_delta = -(transport * 0.00009) - (inventory_cost * 0.00002) - (len(disrupted_nodes) * 0.45)
            throughput_utilization = min(0.99, 0.55 + (total_actual / (max(len(nodes), 1) * 3000.0)))
            return {
                "service_level": round(service_level, 4),
                "transport_cost": round(transport, 2),
                "inventory_cost": round(inventory_cost, 2),
                "total_safety_stock": round(safety_stock, 2),
                "throughput_utilization": round(throughput_utilization, 4),
                "margin_delta": round(margin_delta, 4),
                "lead_time_delta": round((lead_time_factor - 4.0), 3),
                "node_count": float(len(nodes)),
                "lane_count": float(len(lanes)),
            }

        baseline_metrics = _calc_metrics(baseline_nodes, baseline_lanes, disruption_penalty=0.0)
        scenario_metrics = _calc_metrics(scenario_nodes, scenario_lanes, disruption_penalty=0.01 if any(item.get("status") == "disrupted" for item in scenario_nodes) else 0.0)
        deltas = {key: round(scenario_metrics[key] - baseline_metrics.get(key, 0.0), 4) for key in scenario_metrics}
        run_id = f"NET-RUN-{self.db.query(NetworkSimulationRun).count() + 1:04d}"
        summary = {
            "scenario_id": scenario_id,
            "run_id": run_id,
            "baseline_metrics": baseline_metrics,
            "scenario_metrics": scenario_metrics,
            "deltas": deltas,
        }
        self.db.add(
            NetworkSimulationRun(
                run_id=run_id,
                scenario_id=scenario_id,
                run_status="completed",
                started_at=_ts(0),
                completed_at=_ts(3),
                engine_version="network-hybrid-v1",
                summary_json=json.dumps(summary),
            )
        )
        for metric_name, scenario_value in scenario_metrics.items():
            baseline_value = baseline_metrics.get(metric_name, 0.0)
            self.db.add(
                NetworkSimulationMetric(
                    run_id=run_id,
                    metric_name=metric_name,
                    baseline_value=baseline_value,
                    scenario_value=scenario_value,
                    delta_value=round(scenario_value - baseline_value, 4),
                )
            )
        scenario = self.db.query(NetworkScenario).filter(NetworkScenario.scenario_id == scenario_id).first()
        if scenario:
            scenario.status = "simulated"
        self.db.commit()
        node_impacts = [
            {
                "node_id": item["node_id"],
                "name": item["name"],
                "status": item.get("status", "active"),
                "service_level_target": item.get("service_level_target", 0.95),
                "strategy": item.get("default_strategy", "pull"),
            }
            for item in scenario_nodes[:25]
        ]
        lane_impacts = [
            {
                "lane_id": item["lane_id"],
                "origin_node_id": item["origin_node_id"],
                "dest_node_id": item["dest_node_id"],
                "mode": item["mode"],
                "lane_status": item.get("lane_status", "active"),
                "transit_time_mean_days": item["transit_time_mean_days"],
            }
            for item in scenario_lanes[:30]
        ]
        comparison_cards = [
            {"title": "Service Level", "baseline": baseline_metrics["service_level"], "scenario": scenario_metrics["service_level"], "delta": deltas["service_level"]},
            {"title": "Transport Cost", "baseline": baseline_metrics["transport_cost"], "scenario": scenario_metrics["transport_cost"], "delta": deltas["transport_cost"]},
            {"title": "Inventory Cost", "baseline": baseline_metrics["inventory_cost"], "scenario": scenario_metrics["inventory_cost"], "delta": deltas["inventory_cost"]},
            {"title": "Margin Delta", "baseline": baseline_metrics["margin_delta"], "scenario": scenario_metrics["margin_delta"], "delta": deltas["margin_delta"]},
        ]
        return {
            "scenario_id": scenario_id,
            "run_id": run_id,
            "baseline_metrics": baseline_metrics,
            "scenario_metrics": scenario_metrics,
            "deltas": deltas,
            "node_impacts": node_impacts,
            "lane_impacts": lane_impacts,
            "comparison_cards": comparison_cards,
        }

    def save_network_scenario(self, scenario_id: str) -> dict[str, object]:
        scenario = self.db.query(NetworkScenario).filter(NetworkScenario.scenario_id == scenario_id).first()
        if scenario is None:
            raise KeyError(scenario_id)
        scenario.status = "saved"
        self.db.commit()
        return {"scenario_id": scenario.scenario_id, "status": scenario.status}

    def analyze_network_question(self, payload: dict[str, object]) -> dict[str, object]:
        question = str(payload["question"])
        selected_provider, selected_model = resolve_llm_selection(payload.get("llm_provider"), payload.get("llm_model"))
        lowered = question.lower()
        if "florida" in lowered and ("flood" in lowered or "shutdown" in lowered):
            impact_assessment = {
                "margin_drop_pct": 4.0,
                "service_risk": "elevated",
                "inventory_risk": "medium",
            }
            options = [
                {"id": "opt_1", "title": "Air expedite", "cost_impact": 200000, "risk": "low", "notes": "Fastest recovery but expensive."},
                {"id": "opt_2", "title": "Draw down safety stock", "cost_impact": 65000, "risk": "high", "notes": "Protects margin short-term, risks stockout."},
                {"id": "opt_3", "title": "Shift production to Mexico", "cost_impact": 98000, "risk": "medium", "notes": "Best margin/service trade-off."},
            ]
            recommended_option = "opt_3"
        else:
            impact_assessment = {
                "margin_drop_pct": 1.2,
                "service_risk": "moderate",
                "inventory_risk": "low",
            }
            options = [
                {"id": "opt_1", "title": "Rebalance lanes", "cost_impact": 35000, "risk": "low", "notes": "Minor rerouting across active RDCs."},
                {"id": "opt_2", "title": "Activate backup 3PL", "cost_impact": 70000, "risk": "medium", "notes": "Increases handling cost, improves resilience."},
                {"id": "opt_3", "title": "Adjust push-pull boundary", "cost_impact": 42000, "risk": "medium", "notes": "Lower inventory and better service in priority regions."},
            ]
            recommended_option = "opt_1"

        staged_changes = [
            {
                "change_type": "strategy_change",
                "entity_type": "node",
                "entity_id": "RDC-FL-001",
                "payload": {"default_strategy": "pull"},
            },
            {
                "change_type": "add_lane",
                "entity_type": "lane",
                "entity_id": None,
                "payload": {
                    "lane_id": "LANE-MX-RDCFL-AIR",
                    "origin_node_id": "PLANT-MX-001",
                    "dest_node_id": "RDC-FL-001",
                    "mode": "air",
                    "lane_status": "active",
                    "cost_function_type": "linear",
                    "cost_per_unit": 4.2,
                    "cost_per_mile": 0.9,
                    "fixed_cost": 1800.0,
                    "transit_time_mean_days": 2.0,
                    "transit_time_std_days": 0.5,
                    "capacity_limit": 20000.0,
                    "is_default_route": False,
                },
            },
        ]
        if payload.get("scenario_id"):
            for item in staged_changes:
                self.db.add(
                    NetworkScenarioChange(
                        scenario_id=str(payload["scenario_id"]),
                        change_type=item["change_type"],
                        entity_type=item["entity_type"],
                        entity_id=item.get("entity_id"),
                        payload_json=json.dumps(item["payload"]),
                    )
                )
        agent_run_id = f"NET-AGENT-{self.db.query(NetworkAgentResult).count() + 1:04d}"
        response = {
            "summary": "I predict a margin impact and prepared three orchestration options with trade-offs.",
            "impact_assessment": impact_assessment,
            "options": options,
            "recommended_option": recommended_option,
            "staged_changes": staged_changes,
            "requires_user_approval": True,
            "selected_llm_provider": selected_provider,
            "selected_llm_model": selected_model,
        }
        self.db.add(
            NetworkAgentResult(
                agent_run_id=agent_run_id,
                scenario_id=str(payload["scenario_id"]) if payload.get("scenario_id") else None,
                question=question,
                response_json=json.dumps(response),
                staged_changes_json=json.dumps(staged_changes),
                recommended_option=recommended_option,
                requires_approval=True,
            )
        )
        self.db.commit()
        return response

    def get_alert_impacted_skus(self, alert_id: str) -> list[dict[str, object]]:
        alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
        if alert is None:
            raise KeyError(alert_id)
        impacted_node_id = alert.impacted_node_id
        impacted_sku = alert.impacted_sku
        all_sourcing = self.db.query(NetworkSourcingRule).all()

        matched_sourcing: list[NetworkSourcingRule]
        if impacted_node_id and impacted_sku:
            matched_sourcing = [
                row
                for row in all_sourcing
                if row.sku == impacted_sku and row.dest_node_id == impacted_node_id
            ]
        elif impacted_node_id:
            matched_sourcing = [
                row
                for row in all_sourcing
                if row.dest_node_id == impacted_node_id or (row.parent_location_node_id or "") == impacted_node_id
            ]
        elif impacted_sku:
            matched_sourcing = [row for row in all_sourcing if row.sku == impacted_sku]
        else:
            matched_sourcing = all_sourcing[:120]

        # Deduplicate by canonical sourcing grain.
        canonical_map: dict[tuple[str, str, str], NetworkSourcingRule] = {}
        for row in matched_sourcing:
            key = (row.sku, row.dest_node_id, row.parent_location_node_id or "")
            if key not in canonical_map:
                canonical_map[key] = row

        product_by_sku = {item.sku: item for item in self.db.query(ProductMaster).all()}
        demand_rows = self.db.query(NetworkDemandSignal).all()
        demand_by_key: dict[tuple[str, str], dict[str, float | str]] = {}
        for row in demand_rows:
            key = (row.sku, row.dest_node_id)
            metric = demand_by_key.setdefault(
                key,
                {
                    "forecast_qty": 0.0,
                    "actual_qty": 0.0,
                    "volatility_total": 0.0,
                    "count": 0.0,
                    "demand_class": row.demand_class,
                },
            )
            metric["forecast_qty"] = float(metric["forecast_qty"]) + row.forecast_qty
            metric["actual_qty"] = float(metric["actual_qty"]) + row.actual_qty
            metric["volatility_total"] = float(metric["volatility_total"]) + row.volatility_index
            metric["count"] = float(metric["count"]) + 1

        results: list[dict[str, object]] = []
        sorted_keys = sorted(
            canonical_map.keys(),
            key=lambda item: float(demand_by_key.get((item[0], item[1]), {"forecast_qty": 0.0})["forecast_qty"]),
            reverse=True,
        )[:180]
        for sku, location_node_id, parent_location_node_id in sorted_keys:
            source = canonical_map[(sku, location_node_id, parent_location_node_id)]
            param_query = self.db.query(NetworkSkuLocationParameter).filter(
                NetworkSkuLocationParameter.sku == sku,
                NetworkSkuLocationParameter.location_node_id == location_node_id,
                NetworkSkuLocationParameter.parent_location_node_id == parent_location_node_id,
            )
            params = {item.parameter_code: item.parameter_value for item in param_query.all()}
            product = product_by_sku.get(sku)
            demand_metric = demand_by_key.get((sku, location_node_id), {"forecast_qty": 0.0, "actual_qty": 0.0, "volatility_total": 0.0, "count": 1.0, "demand_class": "stable"})
            avg_volatility = float(demand_metric["volatility_total"]) / max(float(demand_metric["count"]), 1.0)
            results.append(
                {
                    "id": f"{alert_id}|{sku}|{location_node_id}|{parent_location_node_id}",
                    "alert_id": alert_id,
                    "sku": sku,
                    "product_name": product.name if product else sku,
                    "brand": product.brand if product else "Unknown",
                    "category": product.category if product else "Unknown",
                    "impacted_node_id": location_node_id,
                    "alert_impacted_node_id": impacted_node_id,
                    "alert_impacted_sku": impacted_sku,
                    "parent_location_node_id": parent_location_node_id,
                    "source_mode": source.source_mode,
                    "service_level_target": float(params["service_level_target"]) if "service_level_target" in params else None,
                    "lead_time_days": float(params["lead_time_days"]) if "lead_time_days" in params else None,
                    "min_batch_size": float(params["min_batch_size"]) if "min_batch_size" in params else None,
                    "forecast_qty": round(float(demand_metric["forecast_qty"]), 2),
                    "actual_qty": round(float(demand_metric["actual_qty"]), 2),
                    "volatility_index": round(avg_volatility, 3),
                    "demand_class": str(demand_metric["demand_class"]),
                }
            )
        return results

    def get_network_view(
        self,
        sku: str | None = None,
        node: str | None = None,
        alert_id: str | None = None,
        weeks_of_coverage: int = 8,
    ) -> dict[str, object]:
        filters = {
            "skus": sorted({row.sku for row in self.db.query(NetworkSourcingRule).all()}),
            "nodes": sorted({row.node_id for row in self.db.query(NetworkNode).all()}),
            "alert_ids": sorted({row.alert_id for row in self.db.query(NetworkAlert).all()}),
            "weeks_of_coverage_options": [4, 8, 12, 16],
        }
        sourcing_rows = self.db.query(NetworkSourcingRule).all()
        if sku:
            sourcing_rows = [row for row in sourcing_rows if row.sku == sku]
        if node:
            sourcing_rows = [row for row in sourcing_rows if row.dest_node_id == node or (row.parent_location_node_id or "") == node]
        if alert_id:
            alert = self.db.query(NetworkAlert).filter(NetworkAlert.alert_id == alert_id).first()
            if alert:
                matched = _match_sourcing_for_alert(alert, sourcing_rows)
                sourcing_rows = matched if matched else sourcing_rows

        node_map = {row.node_id: row for row in self.db.query(NetworkNode).all()}
        start_future = NOW.date()
        end_future = start_future + timedelta(days=7 * max(weeks_of_coverage, 1))
        start_past = NOW.date() - timedelta(days=7 * max(weeks_of_coverage, 1))

        forecast_rows = self.db.query(NetworkForecastWeekly).all()
        actual_rows = self.db.query(NetworkActualWeekly).all()
        pos_rows = self.db.query(NetworkPosWeekly).all()
        inventory_rows = self.db.query(NetworkInventorySnapshot).all()
        order_rows = self.db.query(ReplenishmentOrder).all()
        param_rows = self.db.query(NetworkSkuLocationParameter).all()

        def _in_window(value: str, start: date, end: date) -> bool:
            try:
                dt = datetime.fromisoformat(value).date()
            except ValueError:
                return False
            return start <= dt <= end

        def _sum_forecast(sku_key: str, node_key: str) -> float:
            return round(sum(row.forecast_qty for row in forecast_rows if row.sku == sku_key and row.node_id == node_key and _in_window(row.week_start, start_future, end_future)), 2)

        def _sum_actual(sku_key: str, node_key: str) -> float:
            return round(sum(row.actual_qty for row in actual_rows if row.sku == sku_key and row.node_id == node_key and _in_window(row.week_start, start_past, NOW.date())), 2)

        def _sum_pos(sku_key: str, node_key: str) -> float:
            return round(sum(row.pos_qty for row in pos_rows if row.sku == sku_key and row.node_id == node_key and _in_window(row.week_start, start_past, NOW.date())), 2)

        def _inventory(sku_key: str, node_key: str) -> float:
            matches = [row.on_hand_qty for row in inventory_rows if row.sku == sku_key and row.node_id == node_key]
            return round(matches[-1], 2) if matches else 0.0

        def _orders_on_way(sku_key: str, node_key: str) -> float:
            return round(
                sum(
                    row.order_qty
                    for row in order_rows
                    if row.sku == sku_key
                    and row.ship_to_node_id == node_key
                    and _in_window(row.eta, start_future, end_future)
                ),
                2,
            )

        rows: list[dict[str, object]] = []
        seen_keys: set[tuple[str, str, str]] = set()
        for source in sourcing_rows:
            key = (source.sku, source.dest_node_id, source.parent_location_node_id or "")
            if key in seen_keys:
                continue
            seen_keys.add(key)
            params = [
                item for item in param_rows
                if item.sku == source.sku
                and (
                    item.location_node_id == source.dest_node_id
                    or item.parent_location_node_id == source.dest_node_id
                )
            ]
            rows.append(
                {
                    "id": f"{source.sku}|{source.dest_node_id}|{source.parent_location_node_id or ''}",
                    "sku": source.sku,
                    "node_id": source.dest_node_id,
                    "source_node_id": source.parent_location_node_id,
                    "sourcing_strategy": source.sourcing_strategy,
                    "customer_facing_node": source.is_customer_facing_node,
                    "forecast_qty": _sum_forecast(source.sku, source.dest_node_id),
                    "actual_qty": _sum_actual(source.sku, source.dest_node_id),
                    "inventory_on_hand": _inventory(source.sku, source.dest_node_id),
                    "pos_qty": _sum_pos(source.sku, source.dest_node_id),
                    "orders_on_way_qty": _orders_on_way(source.sku, source.dest_node_id),
                    "parameter_count": len(params),
                    "parameter_codes": sorted({item.parameter_code for item in params}),
                }
            )

        graph_edges = [
            {
                "edge_id": f"{row.sku}|{row.parent_location_node_id or 'NONE'}|{row.dest_node_id}",
                "sku": row.sku,
                "source_node_id": row.parent_location_node_id or "",
                "target_node_id": row.dest_node_id,
                "sourcing_strategy": row.sourcing_strategy,
            }
            for row in sourcing_rows
            if row.parent_location_node_id
        ]
        graph_node_ids = sorted({item["target_node_id"] for item in graph_edges} | {item["source_node_id"] for item in graph_edges if item["source_node_id"]})
        graph_nodes = [
            {
                "node_id": node_id,
                "name": node_map[node_id].name if node_id in node_map else node_id,
                "node_type": node_map[node_id].node_type if node_id in node_map else "unknown",
                "region": node_map[node_id].region if node_id in node_map else "UNKNOWN",
                "status": node_map[node_id].status if node_id in node_map else "unknown",
                "lat": node_map[node_id].lat if node_id in node_map else 0.0,
                "lon": node_map[node_id].lon if node_id in node_map else 0.0,
            }
            for node_id in graph_node_ids
        ]
        node_insights = [
            {
                "node_id": row["node_id"],
                "sku": row["sku"],
                "forecast_qty": row["forecast_qty"],
                "actual_qty": row["actual_qty"],
                "inventory_on_hand": row["inventory_on_hand"],
                "pos_qty": row["pos_qty"],
                "orders_on_way_qty": row["orders_on_way_qty"],
                "parameters": [
                    {
                        "parameter_code": item.parameter_code,
                        "parameter_value": item.parameter_value,
                    }
                    for item in param_rows
                    if item.sku == row["sku"] and item.location_node_id == row["node_id"]
                ],
            }
            for row in rows
        ]
        return {
            "filters": filters,
            "rows": rows,
            "graph_nodes": graph_nodes if sku else [],
            "graph_edges": graph_edges if sku else [],
            "node_insights": node_insights if sku else [],
        }


def _match_sourcing_for_alert(alert: NetworkAlert, source_rows: list[NetworkSourcingRule]) -> list[NetworkSourcingRule]:
    if alert.impacted_node_id and alert.impacted_sku:
        return [
            row
            for row in source_rows
            if row.sku == alert.impacted_sku
            and (row.dest_node_id == alert.impacted_node_id or (row.parent_location_node_id or "") == alert.impacted_node_id)
        ]
    if alert.impacted_node_id:
        return [
            row
            for row in source_rows
            if row.dest_node_id == alert.impacted_node_id or (row.parent_location_node_id or "") == alert.impacted_node_id
        ]
    if alert.impacted_sku:
        return [row for row in source_rows if row.sku == alert.impacted_sku]
    return source_rows
