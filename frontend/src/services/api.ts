import type {
  AutonomousResponse,
  ChatbotRequest,
  ChatbotResponse,
  ChatResponse,
  DashboardResponse,
  DemoAlertsResponse,
  EffectiveParameterValue,
  MasterDataOptions,
  MasterDataSearchResults,
  LlmOptionsResponse,
  NetworkAgentResponse,
  NetworkBaselineResponse,
  NetworkImpactedSkuRecord,
  NetworkOptionsResponse,
  NetworkScenarioDetailResponse,
  NetworkScenarioResponse,
  NetworkSimulationResponse,
  NetworkViewResponse,
  ParameterValueRecord,
  ParameterException,
  ProjectedInventoryAlertRecord,
  ReplenishmentOrdersResponse,
  ReplenishmentOrderDetailsResponse,
  ReplenishmentOrderCreateRequest,
  ReplenishmentOrderUpdateRequest,
  ReplenishmentOrderMutationResponse,
  InventoryProjectionResponse,
  InventorySimulationSaveRequest,
  InventorySimulationSaveResponse,
  LlmConnectionTestResponse,
  ScenarioResponse,
  SkuDetailResponse,
  DocumentSearchResult,
  DemandForecastResponse,
  DemandPromotionResponse,
  DemandConsensusResponse,
  DemandForecastAccuracyResponse,
  DemandExceptionResponse,
  SopCycleResponse,
  SopReviewItemResponse,
  FinancialPlanResponse,
  CustomerHierarchyResponse,
  DemandPlanningKpiResponse,
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  if (response.status === 401) {
    // Notify AuthProvider so it can redirect to /login
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:session-expired"));
    }
  }
  if (!response.ok) {
    let detail = "";
    try {
      const data = await response.json() as { detail?: string };
      detail = data?.detail ? ` - ${data.detail}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`Request failed: ${response.status}${detail}`);
  }
  // Guard against the "stale tab" failure mode: when Vite's SPA fallback
  // serves index.html for an unmatched proxy path, response.ok is true but
  // Content-Type is text/html. Throw a clear error rather than letting
  // JSON.parse choke on "<!doctype html>".
  const ct = response.headers.get("content-type") || "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new Error(
      `Server returned non-JSON (${ct || "no content-type"}) for ${path} — ` +
      `is the Vite proxy pointed at the right backend? Try a hard refresh.`,
    );
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(params: URLSearchParams): Promise<DashboardResponse> {
  return request(`/api/dashboard/stockouts?${params.toString()}`);
}

export function fetchSkuDetail(sku: string, location: string, runId: string): Promise<SkuDetailResponse> {
  return request(`/api/skus/${sku}/locations/${location}?run_id=${encodeURIComponent(runId)}`);
}

export function evaluateScenario(payload: Record<string, unknown>): Promise<ScenarioResponse> {
  return request("/api/scenarios/evaluate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchParameterExceptions(params: URLSearchParams): Promise<ParameterException[]> {
  return request(`/api/parameters/exceptions?${params.toString()}`);
}

export function fetchParameterValues(params: URLSearchParams): Promise<ParameterValueRecord[]> {
  return request(`/api/parameters/values?${params.toString()}`);
}

export function fetchEffectiveParameters(sku: string, location: string): Promise<EffectiveParameterValue[]> {
  return request(`/api/parameters/effective?sku=${encodeURIComponent(sku)}&location=${encodeURIComponent(location)}`);
}

export function applyParameterRecommendation(id: string): Promise<{
  recommendation_id: string;
  status: string;
  updated_effective_values: EffectiveParameterValue[];
  audit_message: string;
}> {
  return request(`/api/parameters/recommendations/${id}/apply`, { method: "POST" });
}

export function updateParameterValue(
  id: number,
  payload: { effective_value: string; explicit_value?: string | null; source_type?: string; reason?: string },
): Promise<ParameterValueRecord> {
  return request(`/api/parameters/values/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function bulkApplyParameterValues(payload: {
  record_ids: number[];
  effective_value: string;
  source_type?: string;
  reason?: string;
}): Promise<{ updated_count: number; created_count: number; message: string }> {
  return request("/api/parameters/values/bulk-apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function pasteParameterValues(payload: {
  rows: Array<{
    sku: string;
    location: string;
    parameter_code: string;
    effective_value: string;
    explicit_value?: string | null;
    source_type?: string;
    reason?: string;
  }>;
}): Promise<{ updated_count: number; created_count: number; message: string }> {
  return request("/api/parameters/values/paste", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function runParameterRecommendations(payload: Record<string, unknown>): Promise<{
  count: number;
  recommendations: ParameterException[];
  message: string;
}> {
  return request("/api/parameters/recommendations/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function explain(payload: Record<string, unknown>, parameter = false): Promise<ChatResponse> {
  return request(parameter ? "/api/parameters/chat" : "/api/chat/explain", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchMasterDataOptions(): Promise<MasterDataOptions> {
  return request("/api/master-data/options");
}

export function searchMasterData(query: string): Promise<MasterDataSearchResults> {
  return request(`/api/master-data/search?query=${encodeURIComponent(query)}`);
}

export function fetchLlmOptions(): Promise<LlmOptionsResponse> {
  return request("/api/llm/options");
}

export function testLlmConnection(payload: {
  provider: string;
  model: string;
  api_key: string;
}): Promise<LlmConnectionTestResponse> {
  return request("/api/llm/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function searchDocuments(query: string, vendor = ""): Promise<{ results: DocumentSearchResult[] }> {
  const params = new URLSearchParams({ query });
  if (vendor) params.set("vendor", vendor);
  return request(`/api/documents/search?${params.toString()}`);
}

export function ingestDocuments(): Promise<Record<string, unknown>> {
  return request("/api/documents/ingest", { method: "POST" });
}

export function fetchNetworkBaseline(params: URLSearchParams): Promise<NetworkBaselineResponse> {
  return request(`/api/network/baseline?${params.toString()}`);
}

export function fetchDemoAlerts(): Promise<DemoAlertsResponse> {
  return request("/alerts");
}

export function fetchProjectedInventoryAlerts(
  sku: string,
  location: string,
  options?: { includeArchived?: boolean; matchScope?: "all" | "direct" | "expanded" },
): Promise<ProjectedInventoryAlertRecord[]> {
  const params = new URLSearchParams({ sku, location });
  if (options?.includeArchived) params.set("include_archived", "true");
  if (options?.matchScope) params.set("match_scope", options.matchScope);
  return request(`/api/inventory-projection-alerts?${params.toString()}`);
}

export function runAutonomous(payload: {
  enabled?: boolean;
  trigger?: "manual" | "scheduled";
  notes?: string;
  initiated_by?: string;
  max_actions?: number;
}): Promise<AutonomousResponse> {
  return request("/autonomous", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchAutonomousRuns(): Promise<AutonomousResponse> {
  return request("/autonomous");
}

export function resetDemoData(): Promise<{ status: string; message: string; seeded: Record<string, number> }> {
  return request("/demo/reset", { method: "POST" });
}

export function fetchNetworkOptions(): Promise<NetworkOptionsResponse> {
  return request("/api/network/options");
}

export function createNetworkScenario(payload: {
  scenario_name: string;
  origin_context?: string;
  source_alert_id?: string;
  notes?: string;
}): Promise<NetworkScenarioResponse> {
  return request("/api/network/scenarios", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchNetworkScenario(scenarioId: string): Promise<NetworkScenarioDetailResponse> {
  return request(`/api/network/scenarios/${encodeURIComponent(scenarioId)}`);
}

export function updateNetworkScenario(
  scenarioId: string,
  payload: { scenario_name?: string; notes?: string; status?: string },
): Promise<NetworkScenarioResponse> {
  return request(`/api/network/scenarios/${encodeURIComponent(scenarioId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function applyNetworkChange(
  scenarioId: string,
  payload: { change_type: string; entity_type: string; entity_id?: string | null; payload: Record<string, unknown> },
): Promise<{ scenario_id: string; change_id: number; status: string }> {
  return request(`/api/network/scenarios/${encodeURIComponent(scenarioId)}/changes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function simulateNetworkScenario(scenarioId: string): Promise<NetworkSimulationResponse> {
  return request(`/api/network/scenarios/${encodeURIComponent(scenarioId)}/simulate`, {
    method: "POST",
  });
}

export function saveNetworkScenario(scenarioId: string): Promise<{ scenario_id: string; status: string }> {
  return request(`/api/network/scenarios/${encodeURIComponent(scenarioId)}/save`, {
    method: "POST",
  });
}

export function analyzeNetwork(payload: {
  question: string;
  scenario_id?: string;
  alert_id?: string;
  llm_provider?: string;
  llm_model?: string;
}): Promise<NetworkAgentResponse> {
  return request("/api/network/agent/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchNetworkAlertImpactedSkus(alertId: string): Promise<NetworkImpactedSkuRecord[]> {
  return request(`/api/network/alerts/${encodeURIComponent(alertId)}/impacted-skus`);
}

export function fetchNetworkView(params: URLSearchParams): Promise<NetworkViewResponse> {
  return request(`/api/network/view?${params.toString()}`);
}

export function fetchReplenishmentOrders(params: URLSearchParams): Promise<ReplenishmentOrdersResponse> {
  return request(`/api/replenishment/orders?${params.toString()}`);
}

export function fetchReplenishmentOrderDetails(params: URLSearchParams): Promise<ReplenishmentOrderDetailsResponse> {
  return request(`/api/replenishment/order-details?${params.toString()}`);
}

export function createReplenishmentOrder(payload: ReplenishmentOrderCreateRequest): Promise<ReplenishmentOrderMutationResponse> {
  return request("/api/replenishment/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateReplenishmentOrder(orderId: string, payload: ReplenishmentOrderUpdateRequest): Promise<ReplenishmentOrderMutationResponse> {
  const encoded = encodeURIComponent(orderId.trim());
  return (async () => {
    try {
      return await request<ReplenishmentOrderMutationResponse>(`/api/replenishment/orders/${encoded}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("404")) throw error;
      return request<ReplenishmentOrderMutationResponse>(`/api/replenishment/order-details/${encoded}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    }
  })();
}

export function fetchInventoryProjection(
  sku: string,
  options?: { location?: string; scenario_id?: string },
): Promise<InventoryProjectionResponse> {
  const params = new URLSearchParams();
  if (options?.location) params.set("location", options.location);
  if (options?.scenario_id) params.set("scenario_id", options.scenario_id);
  return request(`/api/inventory-projection/${encodeURIComponent(sku)}${params.toString() ? `?${params.toString()}` : ""}`);
}

export function saveInventorySimulation(payload: InventorySimulationSaveRequest): Promise<InventorySimulationSaveResponse> {
  return request("/api/simulation/save", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function chatbotQuery(payload: ChatbotRequest): Promise<ChatbotResponse> {
  return request("/api/chatbot/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function chatbotFollowup(payload: ChatbotRequest): Promise<ChatbotResponse> {
  return request("/api/chatbot/followup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function chatbotFeedback(payload: {
  conversation_id: string;
  vote: "up" | "down";
  answer_text: string;
  generated_sql?: string | null;
  user_message?: string | null;
}): Promise<{ status: string; feedback_id: number }> {
  return request("/api/chatbot/feedback", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Demand Planning / IBP API
// ---------------------------------------------------------------------------

export function fetchDemandForecasts(params?: URLSearchParams): Promise<DemandForecastResponse> {
  return request(`/api/demand/forecasts${params ? `?${params.toString()}` : ""}`);
}

export function fetchDemandPromotions(params?: URLSearchParams): Promise<DemandPromotionResponse> {
  return request(`/api/demand/promotions${params ? `?${params.toString()}` : ""}`);
}

export function fetchDemandConsensus(params?: URLSearchParams): Promise<DemandConsensusResponse> {
  return request(`/api/demand/consensus${params ? `?${params.toString()}` : ""}`);
}

export function fetchDemandAccuracy(params?: URLSearchParams): Promise<DemandForecastAccuracyResponse> {
  return request(`/api/demand/accuracy${params ? `?${params.toString()}` : ""}`);
}

export function fetchDemandExceptions(params?: URLSearchParams): Promise<DemandExceptionResponse> {
  return request(`/api/demand/exceptions${params ? `?${params.toString()}` : ""}`);
}

export function updateDemandException(exceptionId: string, payload: Record<string, unknown>): Promise<{ status: string; exception_id: string }> {
  return request(`/api/demand/exceptions/${encodeURIComponent(exceptionId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function fetchSopCycles(params?: URLSearchParams): Promise<SopCycleResponse> {
  return request(`/api/demand/sop-cycles${params ? `?${params.toString()}` : ""}`);
}

export function fetchSopReviewItems(params?: URLSearchParams): Promise<SopReviewItemResponse> {
  return request(`/api/demand/sop-review-items${params ? `?${params.toString()}` : ""}`);
}

export function fetchFinancialPlans(params?: URLSearchParams): Promise<FinancialPlanResponse> {
  return request(`/api/demand/financial${params ? `?${params.toString()}` : ""}`);
}

export function fetchCustomerHierarchy(params?: URLSearchParams): Promise<CustomerHierarchyResponse> {
  return request(`/api/demand/customers${params ? `?${params.toString()}` : ""}`);
}

export function fetchDemandPlanningKpis(): Promise<DemandPlanningKpiResponse> {
  return request("/api/demand/kpis");
}

// --- Inventory Diagnostic Agent -------------------------------------------

export interface InventoryDiagnosticQueryRequest {
  instance_id: string;
  message: string;
  conversation_id?: string | null;
  turn_index?: number;
  openai_api_key?: string | null;
  llm_provider?: string | null;
  llm_model?: string | null;
}

export interface InventoryDiagnosticResponse {
  run_id: string;
  intent_mode: string;
  agent_type: string;
  agent_type_version: number;
  instance_id: string;
  conversation_id: string | null;
  structured: Record<string, unknown> & {
    problems?: Array<Record<string, unknown>>;
    root_causes?: Array<Record<string, unknown>>;
    resolutions?: Array<Record<string, unknown>>;
    action_plan?: Record<string, unknown> | null;
    capabilities_applied?: Record<string, unknown>;
    warnings?: string[];
  };
  narrative: string;
  follow_up_questions: string[];
  warnings: string[];
  llm_calls: Array<Record<string, unknown>>;
  llm_active: boolean;
  llm_provider: string | null;
  llm_model: string | null;
}

export function queryInventoryDiagnostic(
  payload: InventoryDiagnosticQueryRequest,
): Promise<InventoryDiagnosticResponse> {
  return request("/api/inventory-diagnostic/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function fetchInventoryDiagnosticRun(
  runId: string,
): Promise<Record<string, unknown>> {
  return request(`/api/inventory-diagnostic/runs/${encodeURIComponent(runId)}`);
}

// --- Inventory Allocation & Distribution Agent ----------------------------
// Reuses InventoryDiagnosticQueryRequest/Response shape (both pipelines return
// the same structured envelope). Backend handler dispatch is by handler_hint.

export function queryInventoryAllocation(
  payload: InventoryDiagnosticQueryRequest,
): Promise<InventoryDiagnosticResponse> {
  return request("/api/inventory-allocation/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// --- Demand Sensing Agent -------------------------------------------------
// Same request/response shape as the other two agents.

export function queryDemandSensing(
  payload: InventoryDiagnosticQueryRequest,
): Promise<InventoryDiagnosticResponse> {
  return request("/api/demand-sensing/query", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface CapabilitySnapshot {
  instance_id: string;
  slots: Record<
    string,
    {
      status: "available" | "degraded" | "missing";
      reason: string | null;
      missing_required_fields: string[];
      missing_optional_fields: string[];
      binding_kind: string | null;
      source_ref: string | null;
    }
  >;
  disabled_problems: string[];
  disabled_root_causes: string[];
  disabled_resolutions: string[];
  warnings: string[];
  checked_at: string;
}

export function fetchInstanceCapability(
  instanceId: string,
  force: boolean = false,
): Promise<CapabilitySnapshot> {
  const qs = force ? "?force=true" : "";
  return request(
    `/admin/agent-instances/${encodeURIComponent(instanceId)}/capability${qs}`,
  );
}

export function seedInventoryDiagnosticDemo(): Promise<{
  status: string;
  summary: { rows: Record<string, number> };
}> {
  return request("/admin/inventory-diagnostic/seed-demo", { method: "POST" });
}

export interface LlmHealthResponse {
  env_keys_present: { OPENAI: boolean; ANTHROPIC: boolean };
  providers: {
    openai: {
      status: "ok" | "error" | "no_key";
      detail?: string;
      provider?: string;
      model?: string | null;
      latency_ms?: number;
      response_preview?: string;
    };
    anthropic: {
      status: "ok" | "error" | "no_key";
      detail?: string;
      provider?: string;
      model?: string | null;
      latency_ms?: number;
      response_preview?: string;
    };
  };
}

export function checkLlmHealth(
  payload: { openai_api_key?: string; anthropic_api_key?: string } = {},
): Promise<LlmHealthResponse> {
  return request("/admin/inventory-diagnostic/llm-health", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface RunStepArtifact {
  id: number;
  run_id: string;
  step_id: string;
  sequence: number;
  status: "ok" | "skipped" | "error";
  duration_ms: number;
  row_count: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  sample_rows: unknown[];
  llm_call: Record<string, unknown>;
  warnings: string[];
  created_at: string;
}

export function fetchRunSteps(
  runId: string,
  agentType?: string,
): Promise<RunStepArtifact[]> {
  // Step artifacts live in a shared table but each agent exposes its own /steps
  // endpoint. Dispatch by agent_type so allocation / demand-sensing runs
  // surface in the Pipeline tab.
  let base = "/api/inventory-diagnostic";
  if (agentType === "inventory_allocation_agent") base = "/api/inventory-allocation";
  else if (agentType === "demand_sensing_agent") base = "/api/demand-sensing";
  return request(`${base}/runs/${encodeURIComponent(runId)}/steps`);
}

export interface ActionPlanRecord {
  plan_id: string;
  run_id: string;
  instance_id: string;
  plan_status: string;
  action_template_key: string;
  target_system: string | null;
  delivery_mode: string;
  webhook_url: string | null;
  payload: Record<string, unknown>;
  dispatch_attempts: number;
  last_dispatch_at: string | null;
  last_error: string | null;
  created_at: string;
}

export function fetchRunActionPlans(runId: string): Promise<ActionPlanRecord[]> {
  return request(`/api/inventory-diagnostic/runs/${encodeURIComponent(runId)}/action-plans`);
}

export function dispatchActionPlan(planId: string): Promise<{
  plan_id: string;
  status: string;
  status_code: number | null;
  error: string | null;
  attempts: number;
}> {
  return request(`/api/inventory-diagnostic/action-plans/${encodeURIComponent(planId)}/dispatch`, {
    method: "POST",
  });
}

// ── Puls8 DBF (Driver-Based Forecast) ──────────────────────────────────

export interface DbfScenarioRecord {
  scenario_id: string;
  name: string;
  description: string;
  status: string;
  created_by: string;
  parent_scenario_id: string | null;
  created_at: string;
  updated_at: string;
  is_production: boolean;
}

export interface DbfReferenceData {
  skus: string[];
  customers: string[];
  locations: string[];
}

export interface DbfDriverRow {
  scenario_id: string;
  sku: string;
  customer_id: string;
  week_start: string;
  [key: string]: unknown;
}

export interface DbfDriversResponse {
  price: DbfDriverRow[];
  distribution: DbfDriverRow[];
  display: DbfDriverRow[];
  feature: DbfDriverRow[];
}

export interface DbfConsumptionRow {
  scenario_id: string;
  sku: string;
  customer_id: string;
  week_start: string;
  base_qty: number;
  price_effect: number;
  acv_effect: number;
  display_effect: number;
  feature_effect: number;
  total_qty: number;
  adjustment_qty: number;
  adjusted_qty: number;
  last_year_qty: number;
  last_known_value_qty: number;
  actual_qty: number;
}

export interface DbfShipmentRow {
  scenario_id: string;
  sku: string;
  customer_id: string;
  location: string;
  week_start: string;
  consumption_qty: number;
  inventory_position: number;
  shipment_qty: number;
  regression_residual: number;
}

export interface DbfAccuracyResponse {
  overall: { mape: number; bias: number; wmape: number; weeks: number };
  trend: Array<{ week_start: string; mape: number; bias: number; wmape: number }>;
  detail: Array<{ entity: string; mape: number; bias: number; wmape: number; weeks: number }>;
}

export interface DbfAdjustment {
  sku: string;
  customer: string;
  week: string;
  driver: "price" | "acv" | "display" | "feature";
  value: number;
}

export interface DbfConsumptionAdjustment {
  sku: string;
  customer: string;
  week: string;
  delta: number;
}

export function fetchDbfScenarios(): Promise<{ scenarios: DbfScenarioRecord[] }> {
  return request("/api/dbf/scenarios");
}

export function fetchDbfReference(): Promise<DbfReferenceData> {
  return request("/api/dbf/reference");
}

export function fetchDbfDrivers(params: {
  scenario_id?: string;
  sku?: string;
  customer?: string;
  week_from?: string;
  week_to?: string;
}): Promise<DbfDriversResponse> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, String(v));
  return request(`/api/dbf/drivers?${usp.toString()}`);
}

export function fetchDbfConsumption(params: {
  scenario_id?: string;
  sku?: string;
  customer?: string;
}): Promise<{ rows: DbfConsumptionRow[]; total: number }> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, String(v));
  return request(`/api/dbf/consumption?${usp.toString()}`);
}

export function fetchDbfShipment(params: {
  scenario_id?: string;
  sku?: string;
  customer?: string;
  location?: string;
}): Promise<{ rows: DbfShipmentRow[]; total: number }> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, String(v));
  return request(`/api/dbf/shipment?${usp.toString()}`);
}

export function fetchDbfAccuracy(
  tier: "driver" | "consumption" | "shipment",
  scenario_id: string,
): Promise<DbfAccuracyResponse> {
  return request(`/api/dbf/accuracy/${tier}?scenario_id=${encodeURIComponent(scenario_id)}`);
}

export function createDbfScenario(payload: {
  name: string;
  description?: string;
  parent_scenario_id?: string;
}): Promise<DbfScenarioRecord> {
  return request("/api/dbf/scenarios", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteDbfScenario(scenario_id: string): Promise<{ deleted: string }> {
  return request(`/api/dbf/scenarios/${encodeURIComponent(scenario_id)}`, {
    method: "DELETE",
  });
}

export function patchDbfDrivers(
  scenario_id: string,
  adjustments: DbfAdjustment[],
): Promise<{ adjustments_applied: number; consumption_rows_updated: number; shipment_rows_updated: number }> {
  return request(`/api/dbf/scenarios/${encodeURIComponent(scenario_id)}/drivers`, {
    method: "PATCH",
    body: JSON.stringify({ adjustments }),
  });
}

export function patchDbfConsumption(
  scenario_id: string,
  adjustments: DbfConsumptionAdjustment[],
): Promise<{ adjustments_applied: number }> {
  return request(`/api/dbf/scenarios/${encodeURIComponent(scenario_id)}/consumption-adjust`, {
    method: "PATCH",
    body: JSON.stringify({ adjustments }),
  });
}

export function publishDbfScenario(
  scenario_id: string,
): Promise<{ published_rows: number; scenario_id: string }> {
  return request(`/api/dbf/scenarios/${encodeURIComponent(scenario_id)}/publish`, {
    method: "POST",
  });
}
