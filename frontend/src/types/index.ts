export type Tone = "neutral" | "positive" | "warning" | "critical";

export interface KpiCard {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface RecommendationSummary {
  run_id: string;
  sku: string;
  product_name: string;
  category: string;
  location: string;
  region: string;
  projected_stockout_week?: string | null;
  shortage_qty: number;
  excess_qty: number;
  action: string;
  eta: string;
  incremental_cost: number;
  risk_score: number;
  confidence_score: number;
  status: "at_risk" | "excess" | "no_safe_action";
  rationale: string;
}

export interface DashboardResponse {
  run_id: string;
  generated_at: string;
  kpis: KpiCard[];
  recommendations: RecommendationSummary[];
  alerts: string[];
}

export interface OptionDetail {
  option_type: string;
  supplier?: string | null;
  from_location?: string | null;
  recommended_qty: number;
  earliest_arrival_date: string;
  incremental_cost: number;
  risk_score: number;
  feasible_flag: boolean;
  rationale: string;
}

export interface ProjectionPoint {
  week_start: string;
  beginning_qty: number;
  inbound_qty: number;
  demand_qty: number;
  ending_qty: number;
  safety_stock_qty: number;
  stockout_flag: boolean;
  shortage_qty: number;
}

export interface PolicySnippet {
  title: string;
  excerpt: string;
  source_type: string;
}

export interface SkuDetailResponse {
  run_id: string;
  recommendation: RecommendationSummary;
  ranked_options: OptionDetail[];
  projection: ProjectionPoint[];
  policy_snippets: PolicySnippet[];
}

export interface ScenarioResponse {
  baseline_run_id: string;
  scenario_run_id: string;
  deltas: RecommendationSummary[];
  summary: string;
}

export interface EffectiveParameterValue {
  parameter_code: string;
  parameter_name: string;
  inherited_from: string;
  effective_value: string;
  explicit_value?: string | null;
  source_type: string;
  reason: string;
}

export interface ParameterValueRecord {
  id: number;
  sku: string;
  location: string;
  region?: string | null;
  parameter_code: string;
  parameter_name: string;
  inherited_from: string;
  effective_value: string;
  explicit_value?: string | null;
  source_type: string;
  reason: string;
}

export interface ParameterException {
  recommendation_id: string;
  sku: string;
  product_name: string;
  location: string;
  parameter_code: string;
  issue_type: "missing" | "stale" | "invalid" | "misaligned";
  current_effective_value: string;
  recommended_value: string;
  impact_summary: string;
  confidence_score: number;
  status: "open" | "accepted" | "applied";
}

export interface ChatResponse {
  answer: string;
  citations: PolicySnippet[];
  structured_output: Record<string, unknown>;
  selected_llm_provider: string;
  selected_llm_model: string;
  llm_invoked: boolean;
}

export interface ProductMaster {
  sku: string;
  name: string;
  category: string;
  brand: string;
  description: string;
}

export interface LocationMaster {
  code: string;
  name: string;
  region: string;
  type: string;
  city: string;
  state: string;
  description: string;
}

export interface SupplierMaster {
  code: string;
  name: string;
  region: string;
  incoterm: string;
  reliability_score: number;
  lead_time_days: number;
  description: string;
}

export interface MasterDataOptions {
  products: ProductMaster[];
  locations: LocationMaster[];
  regions: string[];
  categories: string[];
  suppliers: string[];
  supplier_records: SupplierMaster[];
  global_filter_values?: Record<string, string[]>;
}

export interface MasterDataSearchResults {
  products: ProductMaster[];
  locations: LocationMaster[];
  suppliers: SupplierMaster[];
}

export interface LlmOptionsResponse {
  providers: Array<{
    id: string;
    label: string;
    models: Array<{ id: string; label: string }>;
  }>;
  defaults: {
    provider: string;
    model: string;
  };
}

export interface LlmConnectionTestResponse {
  ok: boolean;
  message: string;
}

export interface UiConfig {
  llmProvider: string;
  llmModel: string;
}

export interface ChatbotRequest {
  message: string;
  conversation_id?: string | null;
  context_cursor?: number | null;
  assistant_mode?: string;
  llm_provider?: string;
  llm_model?: string;
  openai_api_key?: string;
}

export interface ChatbotApplyCandidate {
  sku: string;
  location: string;
}

export interface ChatbotTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface ChatbotDiagnostics {
  intent: string;
  generated_sql?: string | null;
  prompt_used?: string | null;
  confidence_score?: number | null;
  reasoning_summary?: string | null;
  warnings: string[];
  row_count: number;
  llm_invoked: boolean;
  conversation_id?: string | null;
  history_cursor?: number | null;
}

export interface ChatbotResponse {
  answer_text: string;
  follow_up_questions: string[];
  table: ChatbotTable;
  apply_candidates: ChatbotApplyCandidate[];
  apply_filters: Record<string, string[]>;
  can_apply_filters: boolean;
  diagnostics: ChatbotDiagnostics;
  citations: PolicySnippet[];
}

export interface DocumentSearchResult {
  title: string;
  vendor?: string | null;
  topic?: string | null;
  document_type: string;
  source_path: string;
  excerpt: string;
  score: number;
}

export interface NetworkNode {
  node_id: string;
  name: string;
  node_type: string;
  region: string;
  lat: number;
  lon: number;
  status: string;
  storage_capacity: number;
  throughput_limit: number;
  crossdock_capable: boolean;
  holding_cost_per_unit: number;
  handling_cost_per_unit: number;
  service_level_target: number;
  production_batch_size: number;
  production_freeze_days: number;
  cycle_time_days: number;
  shelf_space_limit: number;
  default_strategy: string;
  metadata_json?: string | null;
}

export interface NetworkLane {
  lane_id: string;
  origin_node_id: string;
  dest_node_id: string;
  mode: string;
  lane_status: string;
  cost_function_type: string;
  cost_per_unit: number;
  cost_per_mile: number;
  fixed_cost: number;
  transit_time_mean_days: number;
  transit_time_std_days: number;
  capacity_limit: number;
  is_default_route: boolean;
}

export interface NetworkAlert {
  alert_id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  impacted_node_id?: string | null;
  impacted_sku?: string | null;
  impacted_lane_id?: string | null;
  effective_from: string;
  effective_to?: string | null;
  recommended_action_json?: string | null;
}

export interface NetworkScenarioSummary {
  scenario_id: string;
  scenario_name: string;
  status: string;
  created_at: string;
  origin_context: string;
}

export interface NetworkBaselineResponse {
  nodes: NetworkNode[];
  lanes: NetworkLane[];
  alerts: NetworkAlert[];
  summary_metrics: Record<string, number>;
  saved_scenarios: NetworkScenarioSummary[];
}

export interface NetworkOptionsResponse {
  node_types: string[];
  transport_modes: string[];
  strategy_options: string[];
  service_level_presets: number[];
  regions: string[];
  products: string[];
  location_types: string[];
}

export interface NetworkScenarioResponse {
  scenario_id: string;
  status: string;
  draft_summary: Record<string, unknown>;
}

export interface NetworkScenarioDetailResponse {
  scenario: NetworkScenarioSummary;
  nodes: NetworkNode[];
  lanes: NetworkLane[];
  changes: Array<Record<string, unknown>>;
  latest_simulation?: Record<string, unknown> | null;
}

export interface NetworkSimulationResponse {
  scenario_id: string;
  run_id: string;
  baseline_metrics: Record<string, number>;
  scenario_metrics: Record<string, number>;
  deltas: Record<string, number>;
  node_impacts: Array<Record<string, unknown>>;
  lane_impacts: Array<Record<string, unknown>>;
  comparison_cards: Array<Record<string, unknown>>;
}

export interface NetworkAgentResponse {
  summary: string;
  impact_assessment: Record<string, unknown>;
  options: Array<Record<string, unknown>>;
  recommended_option: string;
  staged_changes: Array<Record<string, unknown>>;
  requires_user_approval: boolean;
  selected_llm_provider: string;
  selected_llm_model: string;
}

export interface NetworkImpactedSkuRecord {
  id: string;
  alert_id: string;
  sku: string;
  product_name: string;
  brand: string;
  category: string;
  impacted_node_id: string;
  alert_impacted_node_id?: string | null;
  alert_impacted_sku?: string | null;
  parent_location_node_id?: string | null;
  source_mode?: string | null;
  service_level_target?: number | null;
  lead_time_days?: number | null;
  min_batch_size?: number | null;
  forecast_qty: number;
  actual_qty: number;
  volatility_index: number;
  demand_class: string;
}

export interface NetworkViewGridRow {
  id: string;
  sku: string;
  node_id: string;
  source_node_id?: string | null;
  sourcing_strategy: string;
  customer_facing_node: boolean;
  forecast_qty: number;
  actual_qty: number;
  inventory_on_hand: number;
  pos_qty: number;
  orders_on_way_qty: number;
  parameter_count: number;
  parameter_codes: string[];
}

export interface NetworkViewGraphNode {
  node_id: string;
  name: string;
  node_type: string;
  region: string;
  status: string;
  lat: number;
  lon: number;
}

export interface NetworkViewGraphEdge {
  edge_id: string;
  sku: string;
  source_node_id: string;
  target_node_id: string;
  sourcing_strategy: string;
}

export interface NetworkViewNodeInsight {
  node_id: string;
  sku: string;
  forecast_qty: number;
  actual_qty: number;
  inventory_on_hand: number;
  pos_qty: number;
  orders_on_way_qty: number;
  parameters: Array<{ parameter_code: string; parameter_value: string }>;
}

export interface NetworkViewResponse {
  filters: {
    skus: string[];
    nodes: string[];
    alert_ids: string[];
    weeks_of_coverage_options: number[];
  };
  rows: NetworkViewGridRow[];
  graph_nodes: NetworkViewGraphNode[];
  graph_edges: NetworkViewGraphEdge[];
  node_insights: NetworkViewNodeInsight[];
}

export interface ReplenishmentOrderRecord {
  order_id: string;
  alert_id: string;
  order_type: string;
  status: string;
  is_exception: boolean;
  exception_reason?: string | null;
  alert_action_taken: string;
  order_created_by: string;
  ship_to_node_id: string;
  ship_from_node_id?: string | null;
  sku?: string | null;
  order_qty: number;
  product_count: number;
  region?: string | null;
  order_cost: number;
  lead_time_days: number;
  delivery_delay_days: number;
  logistics_impact?: string | null;
  production_impact?: string | null;
  transit_impact?: string | null;
  update_possible: boolean;
  created_at: string;
  eta: string;
}

export interface ReplenishmentOrdersResponse {
  rows: ReplenishmentOrderRecord[];
  summary: Record<string, number>;
}

export interface ReplenishmentOrderDetailRecord {
  id: number;
  order_id: string;
  sku: string;
  ship_to_node_id: string;
  ship_from_node_id?: string | null;
  order_qty: number;
  alert_id: string;
  order_type: string;
  status: string;
  is_exception: boolean;
  exception_reason?: string | null;
  created_at: string;
  eta: string;
}

export interface ReplenishmentOrderDetailsResponse {
  rows: ReplenishmentOrderDetailRecord[];
  summary: Record<string, number>;
}

export interface ReplenishmentOrderDetailInput {
  sku: string;
  order_qty: number;
  ship_to_node_id?: string | null;
  ship_from_node_id?: string | null;
}

export interface ReplenishmentOrderCreateRequest {
  order_id?: string | null;
  alert_id?: string | null;
  order_type?: string;
  status?: string;
  is_exception?: boolean;
  exception_reason?: string | null;
  alert_action_taken?: string;
  order_created_by?: string;
  ship_to_node_id: string;
  ship_from_node_id?: string | null;
  eta: string;
  created_at?: string | null;
  region?: string | null;
  order_cost?: number | null;
  lead_time_days?: number;
  delivery_delay_days?: number;
  logistics_impact?: string | null;
  production_impact?: string | null;
  transit_impact?: string | null;
  update_possible?: boolean;
  details: ReplenishmentOrderDetailInput[];
}

export interface ReplenishmentOrderUpdateRequest {
  order_qty?: number;
  eta?: string;
  details?: ReplenishmentOrderDetailInput[];
}

export interface ReplenishmentOrderMutationResponse {
  order_id: string;
  message: string;
  product_count: number;
  order_qty: number;
  eta: string;
  detail_rows: number;
}

export interface InventoryProjectionWeek {
  week_offset: number;
  week_start_date: string;
  current_on_hand_qty?: number | null;
  forecast_qty: number;
  orders_qty: number;
  orders_non_exception_qty: number;
  orders_exception_qty: number;
  order_ids: string[];
  order_exception_ids: string[];
  projected_on_hand_actual_qty: number;
  projected_on_hand_planned_qty: number;
  safety_stock_qty: number;
  reorder_point_qty: number;
  projected_on_hand_qty: number;
  below_rop: boolean;
  below_safety_stock: boolean;
  stockout: boolean;
  simulated: boolean;
}

export interface InventoryProjectionDemoExample {
  key: string;
  label: string;
  sku: string;
  location?: string | null;
  node?: string | null;
  alert_id?: string | null;
}

export interface InventoryProjectionResponse {
  sku: string;
  product_name: string;
  location?: string | null;
  opening_stock: number;
  lead_time_days: number;
  service_level_target: number;
  safety_stock_method: string;
  generated_at: string;
  weeks: InventoryProjectionWeek[];
  available_skus: string[];
  available_nodes: string[];
  scenario_id?: string | null;
  demo_examples: InventoryProjectionDemoExample[];
}

export interface InventorySimulationSaveRequest {
  scenario_id?: string | null;
  user_id?: string;
  sku: string;
  location?: string | null;
  overrides: Array<{
    week_offset: number;
    modified_forecast?: number | null;
    modified_orders?: number | null;
  }>;
}

export interface InventorySimulationSaveResponse {
  scenario_id: string;
  saved_rows: number;
  created_at: string;
}
