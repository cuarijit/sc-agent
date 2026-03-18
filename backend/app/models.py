from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class ProductMaster(Base):
    __tablename__ = "products"

    sku: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)
    brand: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String, index=True)
    abc_class: Mapped[str] = mapped_column(String)
    temperature_zone: Mapped[str] = mapped_column(String)
    primary_supplier: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)


class InventoryProjectionProductConfig(Base):
    __tablename__ = "inventory_projection_product_config"

    product_id: Mapped[str] = mapped_column(ForeignKey("products.sku"), primary_key=True)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=14)
    service_level_target: Mapped[float] = mapped_column(Float, default=0.95)
    demand_std_dev: Mapped[float] = mapped_column(Float, default=25.0)


class LocationMaster(Base):
    __tablename__ = "locations"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)
    location_type: Mapped[str] = mapped_column(String)
    region: Mapped[str] = mapped_column(String, index=True)
    city: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String)
    echelon: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)


class SupplierMaster(Base):
    __tablename__ = "suppliers"

    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)
    region: Mapped[str] = mapped_column(String)
    incoterm: Mapped[str] = mapped_column(String)
    reliability_score: Mapped[float] = mapped_column(Float)
    lead_time_days: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)


class PlanningRun(Base):
    __tablename__ = "planning_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    run_type: Mapped[str] = mapped_column(String, default="baseline")
    base_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    scenario_name: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(String)
    scope_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    changes_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class Recommendation(Base):
    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("planning_runs.id"), index=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    product_name: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String, index=True)
    location: Mapped[str] = mapped_column(String, index=True)
    region: Mapped[str] = mapped_column(String, index=True)
    supplier: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, index=True)
    action: Mapped[str] = mapped_column(String)
    eta: Mapped[str] = mapped_column(String)
    incremental_cost: Mapped[float] = mapped_column(Float)
    risk_score: Mapped[float] = mapped_column(Float)
    confidence_score: Mapped[float] = mapped_column(Float)
    projected_stockout_week: Mapped[str | None] = mapped_column(String, nullable=True)
    shortage_qty: Mapped[int] = mapped_column(Integer)
    excess_qty: Mapped[int] = mapped_column(Integer, default=0)
    rationale: Mapped[str] = mapped_column(Text)

    options: Mapped[list["SourcingOption"]] = relationship(back_populates="recommendation", cascade="all, delete-orphan")
    projections: Mapped[list["ProjectionPoint"]] = relationship(back_populates="recommendation", cascade="all, delete-orphan")


class SourcingOption(Base):
    __tablename__ = "sourcing_options"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("recommendations.id"), index=True)
    option_type: Mapped[str] = mapped_column(String)
    supplier: Mapped[str | None] = mapped_column(String, nullable=True)
    from_location: Mapped[str | None] = mapped_column(String, nullable=True)
    recommended_qty: Mapped[int] = mapped_column(Integer)
    earliest_arrival_date: Mapped[str] = mapped_column(String)
    incremental_cost: Mapped[float] = mapped_column(Float)
    risk_score: Mapped[float] = mapped_column(Float)
    feasible_flag: Mapped[bool] = mapped_column(Boolean)
    rationale: Mapped[str] = mapped_column(Text)

    recommendation: Mapped["Recommendation"] = relationship(back_populates="options")


class ProjectionPoint(Base):
    __tablename__ = "inventory_projection"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[int] = mapped_column(ForeignKey("recommendations.id"), index=True)
    week_index: Mapped[int] = mapped_column(Integer)
    week_start: Mapped[str] = mapped_column(String)
    beginning_qty: Mapped[int] = mapped_column(Integer)
    inbound_qty: Mapped[int] = mapped_column(Integer)
    demand_qty: Mapped[int] = mapped_column(Integer)
    ending_qty: Mapped[int] = mapped_column(Integer)
    safety_stock_qty: Mapped[int] = mapped_column(Integer)
    stockout_flag: Mapped[bool] = mapped_column(Boolean)
    shortage_qty: Mapped[int] = mapped_column(Integer)

    recommendation: Mapped["Recommendation"] = relationship(back_populates="projections")


class InventoryLedger(Base):
    __tablename__ = "inventory_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.sku"), index=True)
    location_code: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    week_start_date: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String, index=True)  # forecast | confirmed_order | on_hand_snapshot
    quantity: Mapped[float] = mapped_column(Float, default=0.0)


class SimulationScenario(Base):
    __tablename__ = "simulation_scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scenario_id: Mapped[str] = mapped_column(String, index=True)
    user_id: Mapped[str] = mapped_column(String, index=True, default="planner")
    product_id: Mapped[str] = mapped_column(ForeignKey("products.sku"), index=True)
    location_code: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    week_offset: Mapped[int] = mapped_column(Integer, index=True)  # 1..12
    modified_forecast: Mapped[float | None] = mapped_column(Float, nullable=True)
    modified_orders: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String, index=True)


class ParameterValue(Base):
    __tablename__ = "parameter_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    location: Mapped[str] = mapped_column(String, index=True)
    parameter_code: Mapped[str] = mapped_column(String)
    parameter_name: Mapped[str] = mapped_column(String)
    inherited_from: Mapped[str] = mapped_column(String)
    effective_value: Mapped[str] = mapped_column(String)
    explicit_value: Mapped[str | None] = mapped_column(String, nullable=True)
    source_type: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(Text)


class ParameterException(Base):
    __tablename__ = "parameter_exceptions"

    recommendation_id: Mapped[str] = mapped_column(String, primary_key=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    product_name: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String, index=True)
    parameter_code: Mapped[str] = mapped_column(String)
    issue_type: Mapped[str] = mapped_column(String)
    current_effective_value: Mapped[str] = mapped_column(String)
    recommended_value: Mapped[str] = mapped_column(String)
    impact_summary: Mapped[str] = mapped_column(Text)
    confidence_score: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, index=True)


class AuditLog(Base):
    __tablename__ = "parameter_audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[str] = mapped_column(String, index=True)
    sku: Mapped[str] = mapped_column(String)
    location: Mapped[str] = mapped_column(String)
    parameter_code: Mapped[str] = mapped_column(String)
    action_type: Mapped[str] = mapped_column(String)
    notes: Mapped[str] = mapped_column(Text)
    changed_at: Mapped[str] = mapped_column(String)


class ChatbotFeedback(Base):
    __tablename__ = "chatbot_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String, index=True)
    vote: Mapped[str] = mapped_column(String, index=True)  # up | down
    answer_text: Mapped[str] = mapped_column(Text)
    generated_sql: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, index=True)


class NetworkNode(Base):
    __tablename__ = "network_nodes"

    node_id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, index=True)
    node_type: Mapped[str] = mapped_column(String, index=True)
    region: Mapped[str] = mapped_column(String, index=True)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, default="active")
    storage_capacity: Mapped[float] = mapped_column(Float, default=0.0)
    throughput_limit: Mapped[float] = mapped_column(Float, default=0.0)
    crossdock_capable: Mapped[bool] = mapped_column(Boolean, default=False)
    holding_cost_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    handling_cost_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    service_level_target: Mapped[float] = mapped_column(Float, default=0.95)
    production_batch_size: Mapped[float] = mapped_column(Float, default=0.0)
    production_freeze_days: Mapped[int] = mapped_column(Integer, default=0)
    cycle_time_days: Mapped[float] = mapped_column(Float, default=0.0)
    shelf_space_limit: Mapped[float] = mapped_column(Float, default=0.0)
    default_strategy: Mapped[str] = mapped_column(String, default="pull")
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class NetworkLane(Base):
    __tablename__ = "network_lanes"

    lane_id: Mapped[str] = mapped_column(String, primary_key=True)
    origin_node_id: Mapped[str] = mapped_column(ForeignKey("network_nodes.node_id"), index=True)
    dest_node_id: Mapped[str] = mapped_column(ForeignKey("network_nodes.node_id"), index=True)
    mode: Mapped[str] = mapped_column(String)
    lane_status: Mapped[str] = mapped_column(String, default="active")
    cost_function_type: Mapped[str] = mapped_column(String, default="linear")
    cost_per_unit: Mapped[float] = mapped_column(Float, default=0.0)
    cost_per_mile: Mapped[float] = mapped_column(Float, default=0.0)
    fixed_cost: Mapped[float] = mapped_column(Float, default=0.0)
    transit_time_mean_days: Mapped[float] = mapped_column(Float, default=0.0)
    transit_time_std_days: Mapped[float] = mapped_column(Float, default=0.0)
    capacity_limit: Mapped[float] = mapped_column(Float, default=0.0)
    is_default_route: Mapped[bool] = mapped_column(Boolean, default=True)


class NetworkNodeProductScope(Base):
    __tablename__ = "network_node_product_scope"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("network_nodes.node_id"), index=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    strategy_override: Mapped[str | None] = mapped_column(String, nullable=True)
    service_level_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    stocking_flag: Mapped[bool] = mapped_column(Boolean, default=True)
    sourcing_role: Mapped[str | None] = mapped_column(String, nullable=True)


class NetworkDemandSignal(Base):
    __tablename__ = "network_demand_signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    dest_node_id: Mapped[str] = mapped_column(ForeignKey("network_nodes.node_id"), index=True)
    week_start: Mapped[str] = mapped_column(String, index=True)
    forecast_qty: Mapped[float] = mapped_column(Float, default=0.0)
    actual_qty: Mapped[float] = mapped_column(Float, default=0.0)
    volatility_index: Mapped[float] = mapped_column(Float, default=0.0)
    demand_class: Mapped[str] = mapped_column(String, default="stable")


class NetworkSourcingRule(Base):
    __tablename__ = "network_sourcing_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    dest_node_id: Mapped[str] = mapped_column(ForeignKey("network_nodes.node_id"), index=True)
    parent_location_node_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    source_mode: Mapped[str] = mapped_column(String, default="single_source")
    primary_source_node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    secondary_source_node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    split_ratio: Mapped[float] = mapped_column(Float, default=1.0)
    incoterm: Mapped[str | None] = mapped_column(String, nullable=True)
    explicit_lead_time_days: Mapped[float | None] = mapped_column(Float, nullable=True)
    sourcing_strategy: Mapped[str] = mapped_column(String, default="pull", index=True)
    is_customer_facing_node: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class NetworkSkuLocationParameter(Base):
    __tablename__ = "network_sku_location_parameters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    location_node_id: Mapped[str] = mapped_column(String, index=True)
    parent_location_node_id: Mapped[str] = mapped_column(String, index=True)
    parameter_code: Mapped[str] = mapped_column(String, index=True)
    parameter_value: Mapped[str] = mapped_column(String)
    source_type: Mapped[str] = mapped_column(String, default="network_seed")
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)


class NetworkForecastWeekly(Base):
    __tablename__ = "network_forecast_weekly"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String, index=True)
    week_start: Mapped[str] = mapped_column(String, index=True)
    forecast_qty: Mapped[float] = mapped_column(Float, default=0.0)


class NetworkActualWeekly(Base):
    __tablename__ = "network_actual_weekly"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String, index=True)
    week_start: Mapped[str] = mapped_column(String, index=True)
    actual_qty: Mapped[float] = mapped_column(Float, default=0.0)


class NetworkInventorySnapshot(Base):
    __tablename__ = "network_inventory_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String, index=True)
    as_of_date: Mapped[str] = mapped_column(String, index=True)
    on_hand_qty: Mapped[float] = mapped_column(Float, default=0.0)


class NetworkPosWeekly(Base):
    __tablename__ = "network_pos_weekly"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    node_id: Mapped[str] = mapped_column(String, index=True)
    week_start: Mapped[str] = mapped_column(String, index=True)
    pos_qty: Mapped[float] = mapped_column(Float, default=0.0)


class NetworkBREValue(Base):
    __tablename__ = "network_bre_values"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String, index=True)
    node_type: Mapped[str | None] = mapped_column(String, nullable=True)
    region: Mapped[str | None] = mapped_column(String, nullable=True)
    mode: Mapped[str | None] = mapped_column(String, nullable=True)
    supplier: Mapped[str | None] = mapped_column(String, nullable=True)
    sku: Mapped[str | None] = mapped_column(String, nullable=True)
    value: Mapped[float] = mapped_column(Float, default=0.0)
    unit: Mapped[str] = mapped_column(String, default="unit")


class NetworkAlert(Base):
    __tablename__ = "network_alerts"

    alert_id: Mapped[str] = mapped_column(String, primary_key=True)
    alert_type: Mapped[str] = mapped_column(String, index=True)
    severity: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str] = mapped_column(Text)
    impacted_node_id: Mapped[str | None] = mapped_column(String, nullable=True)
    impacted_sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    impacted_lane_id: Mapped[str | None] = mapped_column(String, nullable=True)
    effective_from: Mapped[str] = mapped_column(String)
    effective_to: Mapped[str | None] = mapped_column(String, nullable=True)
    recommended_action_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class NetworkScenario(Base):
    __tablename__ = "network_scenarios"

    scenario_id: Mapped[str] = mapped_column(String, primary_key=True)
    scenario_name: Mapped[str] = mapped_column(String, index=True)
    base_version: Mapped[str] = mapped_column(String, default="BASELINE-V1")
    status: Mapped[str] = mapped_column(String, default="draft")
    created_at: Mapped[str] = mapped_column(String)
    created_by: Mapped[str] = mapped_column(String, default="planner")
    origin_context: Mapped[str] = mapped_column(String, default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class NetworkScenarioChange(Base):
    __tablename__ = "network_scenario_changes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("network_scenarios.scenario_id"), index=True)
    change_type: Mapped[str] = mapped_column(String)
    entity_type: Mapped[str] = mapped_column(String)
    entity_id: Mapped[str | None] = mapped_column(String, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text)


class NetworkSimulationRun(Base):
    __tablename__ = "network_simulation_runs"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    scenario_id: Mapped[str] = mapped_column(ForeignKey("network_scenarios.scenario_id"), index=True)
    run_status: Mapped[str] = mapped_column(String, default="completed")
    started_at: Mapped[str] = mapped_column(String)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    engine_version: Mapped[str] = mapped_column(String, default="network-hybrid-v1")
    summary_json: Mapped[str] = mapped_column(Text)


class NetworkSimulationMetric(Base):
    __tablename__ = "network_simulation_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("network_simulation_runs.run_id"), index=True)
    metric_name: Mapped[str] = mapped_column(String, index=True)
    baseline_value: Mapped[float] = mapped_column(Float, default=0.0)
    scenario_value: Mapped[float] = mapped_column(Float, default=0.0)
    delta_value: Mapped[float] = mapped_column(Float, default=0.0)


class NetworkAgentResult(Base):
    __tablename__ = "network_agent_results"

    agent_run_id: Mapped[str] = mapped_column(String, primary_key=True)
    scenario_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    question: Mapped[str] = mapped_column(Text)
    response_json: Mapped[str] = mapped_column(Text)
    staged_changes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    recommended_option: Mapped[str | None] = mapped_column(String, nullable=True)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=True)


class AutonomousRun(Base):
    __tablename__ = "autonomous_runs"

    run_id: Mapped[str] = mapped_column(String, primary_key=True)
    mode: Mapped[str] = mapped_column(String, default="full_autonomous", index=True)
    status: Mapped[str] = mapped_column(String, default="completed", index=True)
    started_at: Mapped[str] = mapped_column(String, index=True)
    completed_at: Mapped[str | None] = mapped_column(String, nullable=True)
    triggered_by: Mapped[str] = mapped_column(String, default="planner", index=True)
    summary_json: Mapped[str] = mapped_column(Text)


class AutonomousAction(Base):
    __tablename__ = "autonomous_actions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("autonomous_runs.run_id"), index=True)
    step_order: Mapped[int] = mapped_column(Integer, default=1)
    action_type: Mapped[str] = mapped_column(String, index=True)
    alert_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    sku: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    from_node: Mapped[str | None] = mapped_column(String, nullable=True)
    to_node: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_cost: Mapped[float] = mapped_column(Float, default=0.0)
    estimated_lead_time_days: Mapped[float] = mapped_column(Float, default=0.0)
    decision_rationale: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String, default="completed", index=True)
    executed_at: Mapped[str] = mapped_column(String, index=True)


class ReplenishmentOrder(Base):
    __tablename__ = "replenishment_orders"

    order_id: Mapped[str] = mapped_column(String, primary_key=True)
    alert_id: Mapped[str] = mapped_column(String, index=True)
    order_type: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    is_exception: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    exception_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    alert_action_taken: Mapped[str] = mapped_column(String)
    order_created_by: Mapped[str] = mapped_column(String, index=True)
    ship_to_node_id: Mapped[str] = mapped_column(String, index=True)
    ship_from_node_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    product_count: Mapped[int] = mapped_column(Integer, default=1)
    order_qty: Mapped[float] = mapped_column(Float, default=0.0)
    region: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    order_cost: Mapped[float] = mapped_column(Float, default=0.0)
    lead_time_days: Mapped[float] = mapped_column(Float, default=0.0)
    delivery_delay_days: Mapped[float] = mapped_column(Float, default=0.0)
    logistics_impact: Mapped[str | None] = mapped_column(String, nullable=True)
    production_impact: Mapped[str | None] = mapped_column(String, nullable=True)
    transit_impact: Mapped[str | None] = mapped_column(String, nullable=True)
    update_possible: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[str] = mapped_column(String)
    eta: Mapped[str] = mapped_column(String)


class ReplenishmentOrderDetail(Base):
    __tablename__ = "replenishment_order_details"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("replenishment_orders.order_id"), index=True)
    sku: Mapped[str] = mapped_column(String, index=True)
    ship_to_node_id: Mapped[str] = mapped_column(String, index=True)
    ship_from_node_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    order_qty: Mapped[float] = mapped_column(Float, default=0.0)


class ReplenishmentOrderAlertLink(Base):
    __tablename__ = "replenishment_order_alert_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    order_id: Mapped[str] = mapped_column(ForeignKey("replenishment_orders.order_id"), index=True)
    alert_id: Mapped[str] = mapped_column(String, index=True)
    link_status: Mapped[str] = mapped_column(String, default="active", index=True)  # active | fixed
    linked_scope: Mapped[str] = mapped_column(String, default="order")  # order | supply_node
    source_node_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    issue_type: Mapped[str | None] = mapped_column(String, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String, index=True)
    fixed_at: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    fixed_by: Mapped[str | None] = mapped_column(String, nullable=True)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String)
    source_path: Mapped[str] = mapped_column(String)
    document_type: Mapped[str] = mapped_column(String, default="policy")
    vendor: Mapped[str | None] = mapped_column(String, nullable=True)
    topic: Mapped[str | None] = mapped_column(String, nullable=True)
    content: Mapped[str] = mapped_column(Text)

    chunks: Mapped[list["DocumentChunk"]] = relationship(back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    keyword_blob: Mapped[str] = mapped_column(Text)

    document: Mapped["Document"] = relationship(back_populates="chunks")
