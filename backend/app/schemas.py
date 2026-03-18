from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class FilterState(BaseModel):
    run_id: str | list[str] | None = None
    region: str | list[str] | None = None
    location: str | list[str] | None = None
    sku: str | list[str] | None = None
    category: str | list[str] | None = None
    supplier: str | list[str] | None = None
    horizon_weeks: int = 8
    exception_status: str | list[str] | None = None
    recommendation_id: str | list[str] | None = None
    alert_id: str | list[str] | None = None
    alert_type: str | list[str] | None = None
    severity: str | list[str] | None = None
    order_id: str | list[str] | None = None
    order_type: str | list[str] | None = None
    status: str | list[str] | None = None
    exception_reason: str | list[str] | None = None
    ship_from_node_id: str | list[str] | None = None
    ship_to_node_id: str | list[str] | None = None
    parameter_code: str | list[str] | None = None
    issue_type: str | list[str] | None = None
    source_mode: str | list[str] | None = None
    node_type: str | list[str] | None = None


class KpiCard(BaseModel):
    label: str
    value: str
    detail: str
    tone: Literal["neutral", "positive", "warning", "critical"]


class RecommendationSummary(BaseModel):
    run_id: str
    sku: str
    product_name: str
    category: str
    location: str
    region: str
    projected_stockout_week: str | None = None
    shortage_qty: int
    excess_qty: int = 0
    action: str
    eta: str
    incremental_cost: float
    risk_score: float
    confidence_score: float
    status: Literal["at_risk", "excess", "no_safe_action"]
    rationale: str


class OptionDetail(BaseModel):
    option_type: str
    supplier: str | None = None
    from_location: str | None = None
    recommended_qty: int
    earliest_arrival_date: str
    incremental_cost: float
    risk_score: float
    feasible_flag: bool
    rationale: str


class ProjectionPoint(BaseModel):
    week_start: str
    beginning_qty: int
    inbound_qty: int
    demand_qty: int
    ending_qty: int
    safety_stock_qty: int
    stockout_flag: bool
    shortage_qty: int


class PolicySnippet(BaseModel):
    title: str
    excerpt: str
    source_type: str


class SkuDetailResponse(BaseModel):
    run_id: str
    recommendation: RecommendationSummary
    ranked_options: list[OptionDetail]
    projection: list[ProjectionPoint]
    policy_snippets: list[PolicySnippet]


class DashboardResponse(BaseModel):
    run_id: str
    generated_at: str
    kpis: list[KpiCard]
    recommendations: list[RecommendationSummary]
    alerts: list[str]


class ScenarioChange(BaseModel):
    forecast_multiplier: float = 1.0
    forecast_error_multiplier: float = 1.0
    lead_time_delay_days: int = 0
    supplier_reliability_delta: float = 0.0


class ScenarioRequest(BaseModel):
    scenario_name: str
    scope: dict[str, str] = Field(default_factory=dict)
    changes: ScenarioChange
    horizon_weeks: int = 8


class ScenarioResponse(BaseModel):
    baseline_run_id: str
    scenario_run_id: str
    deltas: list[RecommendationSummary]
    summary: str


class ChatRequest(BaseModel):
    question: str
    run_id: str | None = None
    sku: str | None = None
    location: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[PolicySnippet]
    structured_output: dict[str, Any]
    selected_llm_provider: str
    selected_llm_model: str
    llm_invoked: bool


class ChatbotApplyCandidate(BaseModel):
    sku: str
    location: str


class ChatbotTable(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ChatbotDiagnostics(BaseModel):
    intent: str = "db-query"
    generated_sql: str | None = None
    prompt_used: str | None = None
    confidence_score: float | None = None
    reasoning_summary: str | None = None
    warnings: list[str] = Field(default_factory=list)
    row_count: int = 0
    llm_invoked: bool = False
    conversation_id: str | None = None
    history_cursor: int | None = None


class ChatbotRequest(BaseModel):
    message: str
    conversation_id: str | None = None
    context_cursor: int | None = None
    assistant_mode: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    openai_api_key: str | None = None


class ChatbotResponse(BaseModel):
    answer_text: str
    follow_up_questions: list[str] = Field(default_factory=list)
    table: ChatbotTable = Field(default_factory=ChatbotTable)
    apply_candidates: list[ChatbotApplyCandidate] = Field(default_factory=list)
    apply_filters: dict[str, list[str]] = Field(default_factory=dict)
    can_apply_filters: bool = False
    diagnostics: ChatbotDiagnostics = Field(default_factory=ChatbotDiagnostics)
    citations: list[PolicySnippet] = Field(default_factory=list)


class ChatbotFeedbackRequest(BaseModel):
    conversation_id: str
    vote: Literal["up", "down"]
    answer_text: str
    generated_sql: str | None = None
    user_message: str | None = None


class ChatbotFeedbackResponse(BaseModel):
    status: str = "ok"
    feedback_id: int


class EffectiveParameterValue(BaseModel):
    parameter_code: str
    parameter_name: str
    inherited_from: str
    effective_value: str
    explicit_value: str | None = None
    source_type: str
    reason: str


class ParameterException(BaseModel):
    recommendation_id: str
    sku: str
    product_name: str
    location: str
    parameter_code: str
    issue_type: Literal["missing", "stale", "invalid", "misaligned"]
    current_effective_value: str
    recommended_value: str
    impact_summary: str
    confidence_score: float
    status: Literal["open", "accepted", "applied"]


class ParameterRecommendationRunRequest(BaseModel):
    parameter_codes: list[str] = Field(default_factory=list)
    scope_filters: dict[str, str] = Field(default_factory=dict)


class ParameterApplyResponse(BaseModel):
    recommendation_id: str
    status: str
    updated_effective_values: list[EffectiveParameterValue]
    audit_message: str


class ParameterValueRecord(BaseModel):
    id: int
    sku: str
    location: str
    region: str | None = None
    parameter_code: str
    parameter_name: str
    inherited_from: str
    effective_value: str
    explicit_value: str | None = None
    source_type: str
    reason: str


class ParameterValueUpdateRequest(BaseModel):
    effective_value: str
    explicit_value: str | None = None
    source_type: str | None = None
    reason: str | None = None


class ParameterValueBulkApplyRequest(BaseModel):
    record_ids: list[int] = Field(default_factory=list)
    effective_value: str
    source_type: str = "bulk_override"
    reason: str = "Bulk parameter update from parameter workbench."


class ParameterValuePasteRow(BaseModel):
    sku: str
    location: str
    parameter_code: str
    effective_value: str
    explicit_value: str | None = None
    source_type: str | None = None
    reason: str | None = None


class ParameterValuePasteRequest(BaseModel):
    rows: list[ParameterValuePasteRow]


class ParameterValueMutationResponse(BaseModel):
    updated_count: int
    created_count: int = 0
    message: str


class LlmModelOption(BaseModel):
    id: str
    label: str


class LlmProviderOption(BaseModel):
    id: str
    label: str
    models: list[LlmModelOption]


class LlmOptionsResponse(BaseModel):
    providers: list[LlmProviderOption]
    defaults: dict[str, str]


class LlmConnectionTestRequest(BaseModel):
    provider: str
    model: str
    api_key: str


class LlmConnectionTestResponse(BaseModel):
    ok: bool
    message: str


class DocumentSearchResult(BaseModel):
    title: str
    vendor: str | None = None
    topic: str | None = None
    document_type: str
    source_path: str
    excerpt: str
    score: float


class DocumentSearchResponse(BaseModel):
    results: list[DocumentSearchResult]


class NetworkNode(BaseModel):
    node_id: str
    name: str
    node_type: str
    region: str
    lat: float
    lon: float
    status: str
    storage_capacity: float
    throughput_limit: float
    crossdock_capable: bool
    holding_cost_per_unit: float
    handling_cost_per_unit: float
    service_level_target: float
    production_batch_size: float
    production_freeze_days: int
    cycle_time_days: float
    shelf_space_limit: float
    default_strategy: str
    metadata_json: str | None = None


class NetworkLane(BaseModel):
    lane_id: str
    origin_node_id: str
    dest_node_id: str
    mode: str
    lane_status: str
    cost_function_type: str
    cost_per_unit: float
    cost_per_mile: float
    fixed_cost: float
    transit_time_mean_days: float
    transit_time_std_days: float
    capacity_limit: float
    is_default_route: bool


class NetworkAlert(BaseModel):
    alert_id: str
    alert_type: str
    severity: str
    title: str
    description: str
    impacted_node_id: str | None = None
    impacted_sku: str | None = None
    impacted_lane_id: str | None = None
    effective_from: str
    effective_to: str | None = None
    recommended_action_json: str | None = None
    linked_order_ids: list[str] = Field(default_factory=list)
    linked_supply_nodes: list[str] = Field(default_factory=list)


class DemoAlertRecord(NetworkAlert):
    status: Literal["active", "archived"]
    weeks_to_stockout: float | None = None


class DemoAlertsResponse(BaseModel):
    active: list[DemoAlertRecord]
    archived: list[DemoAlertRecord]
    summary: dict[str, float]


class ProjectedInventoryAlertRecord(DemoAlertRecord):
    match_source: Literal["direct", "expanded_scope"]


class NetworkScenarioSummary(BaseModel):
    scenario_id: str
    scenario_name: str
    status: str
    created_at: str
    origin_context: str


class NetworkBaselineResponse(BaseModel):
    nodes: list[NetworkNode]
    lanes: list[NetworkLane]
    alerts: list[NetworkAlert]
    summary_metrics: dict[str, float]
    saved_scenarios: list[NetworkScenarioSummary]


class NetworkOptionsResponse(BaseModel):
    node_types: list[str]
    transport_modes: list[str]
    strategy_options: list[str]
    service_level_presets: list[float]
    regions: list[str]
    products: list[str]
    location_types: list[str]


class NetworkScenarioCreateRequest(BaseModel):
    scenario_name: str
    origin_context: str = "manual"
    source_alert_id: str | None = None
    notes: str | None = None


class NetworkScenarioUpdateRequest(BaseModel):
    scenario_name: str | None = None
    notes: str | None = None
    status: str | None = None


class NetworkScenarioResponse(BaseModel):
    scenario_id: str
    status: str
    draft_summary: dict[str, Any]


class NetworkChangeRequest(BaseModel):
    change_type: str
    entity_type: str
    entity_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class NetworkScenarioDetailResponse(BaseModel):
    scenario: NetworkScenarioSummary
    nodes: list[NetworkNode]
    lanes: list[NetworkLane]
    changes: list[dict[str, Any]]
    latest_simulation: dict[str, Any] | None = None


class NetworkSimulationResponse(BaseModel):
    scenario_id: str
    run_id: str
    baseline_metrics: dict[str, float]
    scenario_metrics: dict[str, float]
    deltas: dict[str, float]
    node_impacts: list[dict[str, Any]]
    lane_impacts: list[dict[str, Any]]
    comparison_cards: list[dict[str, Any]]


class NetworkAgentRequest(BaseModel):
    question: str
    scenario_id: str | None = None
    alert_id: str | None = None
    llm_provider: str | None = None
    llm_model: str | None = None


class NetworkAgentResponse(BaseModel):
    summary: str
    impact_assessment: dict[str, Any]
    options: list[dict[str, Any]]
    recommended_option: str
    staged_changes: list[dict[str, Any]]
    requires_user_approval: bool
    selected_llm_provider: str
    selected_llm_model: str


class NetworkImpactedSkuRecord(BaseModel):
    id: str
    alert_id: str
    sku: str
    product_name: str
    brand: str
    category: str
    impacted_node_id: str
    alert_impacted_node_id: str | None = None
    alert_impacted_sku: str | None = None
    parent_location_node_id: str | None = None
    source_mode: str | None = None
    service_level_target: float | None = None
    lead_time_days: float | None = None
    min_batch_size: float | None = None
    forecast_qty: float
    actual_qty: float
    volatility_index: float
    demand_class: str


class ReplenishmentOrderRecord(BaseModel):
    order_id: str
    alert_id: str
    alert_ids: list[str] = Field(default_factory=list)
    fixed_alert_ids: list[str] = Field(default_factory=list)
    order_type: str
    status: str
    is_exception: bool
    exception_reason: str | None = None
    alert_action_taken: str
    order_created_by: str
    ship_to_node_id: str
    ship_from_node_id: str | None = None
    sku: str | None = None
    product_count: int
    order_qty: float
    region: str | None = None
    order_cost: float
    lead_time_days: float
    delivery_delay_days: float
    logistics_impact: str | None = None
    production_impact: str | None = None
    transit_impact: str | None = None
    update_possible: bool
    created_at: str
    eta: str


class ReplenishmentOrdersResponse(BaseModel):
    rows: list[ReplenishmentOrderRecord]
    summary: dict[str, float]


class DemoOrdersResponse(BaseModel):
    rows: list[ReplenishmentOrderRecord]
    summary: dict[str, float]


class ReplenishmentOrderDetailRecord(BaseModel):
    id: int
    order_id: str
    sku: str
    ship_to_node_id: str
    ship_from_node_id: str | None = None
    order_qty: float
    alert_id: str
    order_type: str
    status: str
    is_exception: bool
    exception_reason: str | None = None
    created_at: str
    eta: str


class ReplenishmentOrderDetailsResponse(BaseModel):
    rows: list[ReplenishmentOrderDetailRecord]
    summary: dict[str, float]


class ReplenishmentOrderDetailInput(BaseModel):
    sku: str
    order_qty: float
    ship_to_node_id: str | None = None
    ship_from_node_id: str | None = None


class ReplenishmentOrderCreateRequest(BaseModel):
    order_id: str | None = None
    alert_id: str | None = None
    order_type: str = "Stock Transfer"
    status: str = "created"
    is_exception: bool = False
    exception_reason: str | None = None
    alert_action_taken: str = "execute_planned_replenishment"
    order_created_by: str = "manual"
    ship_to_node_id: str
    ship_from_node_id: str | None = None
    eta: str
    created_at: str | None = None
    region: str | None = None
    order_cost: float | None = None
    lead_time_days: float = 0.0
    delivery_delay_days: float = 0.0
    logistics_impact: str | None = None
    production_impact: str | None = None
    transit_impact: str | None = None
    update_possible: bool = True
    details: list[ReplenishmentOrderDetailInput] = Field(default_factory=list)


class ReplenishmentOrderUpdateRequest(BaseModel):
    order_qty: float | None = None
    eta: str | None = None
    details: list[ReplenishmentOrderDetailInput] | None = None
    alert_id: str | None = None
    mark_alert_fixed: bool | None = None
    fixed_alert_id: str | None = None
    create_new_alert: bool | None = None
    new_alert_id: str | None = None
    new_alert_type: str | None = None
    new_alert_severity: str | None = None
    new_alert_title: str | None = None
    new_alert_description: str | None = None
    new_alert_impacted_node_id: str | None = None
    new_alert_issue_type: str | None = None


class ReplenishmentOrderMutationResponse(BaseModel):
    order_id: str
    message: str
    product_count: int
    order_qty: float
    eta: str
    detail_rows: int


class InventoryProjectionWeek(BaseModel):
    week_offset: int
    week_start_date: str
    current_on_hand_qty: float | None = None
    forecast_qty: float
    orders_qty: float
    orders_non_exception_qty: float = 0.0
    orders_exception_qty: float = 0.0
    order_ids: list[str] = Field(default_factory=list)
    order_exception_ids: list[str] = Field(default_factory=list)
    safety_stock_qty: float
    reorder_point_qty: float
    projected_on_hand_actual_qty: float
    projected_on_hand_planned_qty: float
    projected_on_hand_qty: float
    below_rop: bool
    below_safety_stock: bool
    stockout: bool
    simulated: bool = False


class InventoryProjectionDemoExample(BaseModel):
    key: str
    label: str
    sku: str
    location: str | None = None
    node: str | None = None
    alert_id: str | None = None


class InventoryProjectionResponse(BaseModel):
    sku: str
    product_name: str
    location: str | None = None
    opening_stock: float
    lead_time_days: int
    service_level_target: float
    safety_stock_method: str
    generated_at: str
    weeks: list[InventoryProjectionWeek]
    available_skus: list[str] = Field(default_factory=list)
    available_nodes: list[str] = Field(default_factory=list)
    scenario_id: str | None = None
    demo_examples: list[InventoryProjectionDemoExample] = Field(default_factory=list)


class InventorySimulationSaveOverride(BaseModel):
    week_offset: int
    modified_forecast: float | None = None
    modified_orders: float | None = None


class InventorySimulationSaveRequest(BaseModel):
    scenario_id: str | None = None
    user_id: str = "planner"
    sku: str
    location: str | None = None
    overrides: list[InventorySimulationSaveOverride] = Field(default_factory=list)


class InventorySimulationSaveResponse(BaseModel):
    scenario_id: str
    saved_rows: int
    created_at: str


class NetworkViewFilterOptions(BaseModel):
    skus: list[str]
    nodes: list[str]
    alert_ids: list[str]
    weeks_of_coverage_options: list[int]


class NetworkViewGridRow(BaseModel):
    id: str
    sku: str
    node_id: str
    source_node_id: str | None = None
    sourcing_strategy: str
    customer_facing_node: bool
    forecast_qty: float
    actual_qty: float
    inventory_on_hand: float
    pos_qty: float
    orders_on_way_qty: float
    parameter_count: int
    parameter_codes: list[str]


class NetworkViewGraphNode(BaseModel):
    node_id: str
    name: str
    node_type: str
    region: str
    status: str
    lat: float
    lon: float


class NetworkViewGraphEdge(BaseModel):
    edge_id: str
    sku: str
    source_node_id: str
    target_node_id: str
    sourcing_strategy: str


class NetworkViewNodeInsight(BaseModel):
    node_id: str
    sku: str
    forecast_qty: float
    actual_qty: float
    inventory_on_hand: float
    pos_qty: float
    orders_on_way_qty: float
    parameters: list[dict[str, str]]


class NetworkViewResponse(BaseModel):
    filters: NetworkViewFilterOptions
    rows: list[NetworkViewGridRow]
    graph_nodes: list[NetworkViewGraphNode]
    graph_edges: list[NetworkViewGraphEdge]
    node_insights: list[NetworkViewNodeInsight]


class AutonomousExecuteRequest(BaseModel):
    enabled: bool = True
    trigger: Literal["manual", "scheduled"] = "manual"
    notes: str | None = None
    initiated_by: str = "planner"
    max_actions: int = 5


class AutonomousActionRecord(BaseModel):
    id: int
    step_order: int
    action_type: str
    alert_id: str | None = None
    sku: str | None = None
    from_node: str | None = None
    to_node: str | None = None
    quantity: float
    estimated_cost: float
    estimated_lead_time_days: float
    decision_rationale: str
    status: str
    executed_at: str


class AutonomousRunRecord(BaseModel):
    run_id: str
    mode: str
    status: str
    started_at: str
    completed_at: str | None = None
    triggered_by: str
    summary: dict[str, Any]
    actions: list[AutonomousActionRecord]


class AutonomousResponse(BaseModel):
    enabled: bool
    latest_run: AutonomousRunRecord | None = None
    runs: list[AutonomousRunRecord] = Field(default_factory=list)


class DemoResetResponse(BaseModel):
    status: str
    message: str
    seeded: dict[str, int]
