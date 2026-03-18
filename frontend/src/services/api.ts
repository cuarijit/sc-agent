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
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
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
