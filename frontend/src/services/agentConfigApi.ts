export type AgentButtonStyle = "icon_only" | "text_only" | "icon_and_text";

export interface Role {
  id: number;
  name: string;
  is_system: boolean;
  entitlement_keys: string[];
}

export interface RoleListResponse {
  roles: Role[];
}

export interface AdminModuleRecord {
  module_slug: string;
  label: string;
  description: string | null;
  documentation: string | null;
  config_root: string | null;
  is_active: boolean;
  icon: string;
  sort_order: number;
  landing_page_slug: string | null;
}

export interface AgentTypeDefinition {
  type_key: string;
  display_name: string;
  description: string;
  status: "active" | "draft" | "deprecated";
  available_actions: string[];
  handler_hint: string;
  assistant_mode: string;
  template_version: number;
  config_schema: Record<string, unknown>;
  default_config: Record<string, unknown>;
  default_instance: {
    icon: string;
    button_text: string;
    button_style: string;
    tooltip_text: string;
    config_ref?: string;
  };
  ui_hints: { sections: Array<{ title: string; fields: string[] }> };
  behavior: Record<string, unknown>;
}

export interface AgentTemplate extends AgentTypeDefinition {}

export interface AgentTemplateSyncResult {
  status: string;
  synced_count: number;
  fields_added: string[];
  warnings: string[];
}

export interface AgentInstance {
  id: number;
  instance_id: string;
  agent_type: string;
  display_name: string;
  icon: string | null;
  button_text: string | null;
  button_style: AgentButtonStyle;
  tooltip_text: string | null;
  description: string | null;
  source_directory: string | null;
  config_ref: string | null;
  module_slug: string | null;
  role_ids: number[];
  action_permissions: Record<string, number[]>;
  type_specific_config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  template_version: number | null;
  template_sync_status: string;
  behavior: Record<string, unknown>;
}

export interface AgentInstanceCreateRequest {
  instance_id: string;
  agent_type: string;
  display_name: string;
  icon?: string | null;
  button_text?: string | null;
  button_style?: AgentButtonStyle;
  tooltip_text?: string | null;
  description?: string | null;
  source_directory?: string | null;
  config_ref?: string | null;
  module_slug?: string | null;
  role_ids?: number[];
  action_permissions?: Record<string, number[]>;
  type_specific_config?: Record<string, unknown>;
  is_active?: boolean;
}

export interface AgentInstanceUpdateRequest {
  display_name?: string;
  icon?: string | null;
  button_text?: string | null;
  button_style?: AgentButtonStyle;
  tooltip_text?: string | null;
  description?: string | null;
  source_directory?: string | null;
  config_ref?: string | null;
  module_slug?: string | null;
  role_ids?: number[];
  action_permissions?: Record<string, number[]>;
  type_specific_config?: Record<string, unknown>;
  is_active?: boolean;
}

export interface ActionStatusResponse {
  status: string;
  detail: string;
}

export interface ResolvedAgentTemplateSummary {
  type_key: string;
  display_name: string;
  template_version: number;
  available_actions: string[];
  handler_hint: string | null;
  assistant_mode: string | null;
}

export interface ResolvedAgentInstance {
  instance_id: string;
  agent_type: string;
  display_name: string;
  icon: string | null;
  button_text: string | null;
  button_style: AgentButtonStyle;
  tooltip_text: string | null;
  description: string | null;
  module_slug: string | null;
  is_active: boolean;
  ui: {
    placeholder_text?: string;
    default_llm_provider?: string;
    default_llm_model?: string;
    max_preview_rows?: number;
    enable_charts?: boolean;
    grid_collapsed_default?: boolean;
    row_limit_default?: number;
    chart_palette?: string[];
    [key: string]: unknown;
  };
  behavior: Record<string, unknown>;
  template: ResolvedAgentTemplateSummary | Record<string, unknown>;
}

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("auth:session-expired"));
  }
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { detail?: string };
      detail = data?.detail ? ` - ${data.detail}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`Request failed: ${response.status}${detail}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchRoles(): Promise<Role[]> {
  const response = await requestJson<RoleListResponse>("/admin/roles", {
    method: "GET",
  });
  return response.roles;
}

export async function fetchAdminModules(): Promise<AdminModuleRecord[]> {
  return requestJson<AdminModuleRecord[]>("/admin/modules", {
    method: "GET",
  });
}

export async function fetchAgentTypes(): Promise<AgentTypeDefinition[]> {
  return requestJson<AgentTypeDefinition[]>("/admin/agent-types", {
    method: "GET",
  });
}

export async function fetchAgentTemplates(): Promise<AgentTemplate[]> {
  return requestJson<AgentTemplate[]>("/admin/agent-templates", {
    method: "GET",
  });
}

export async function fetchAgentTemplate(typeKey: string): Promise<AgentTemplate> {
  return requestJson<AgentTemplate>(`/admin/agent-templates/${encodeURIComponent(typeKey)}`, {
    method: "GET",
  });
}

export async function updateAgentTemplate(
  typeKey: string,
  payload: {
    display_name?: string;
    description?: string;
    default_config?: Record<string, unknown>;
    default_instance?: Record<string, unknown>;
    ui_hints?: Record<string, unknown>;
    behavior?: Record<string, unknown>;
  },
): Promise<AgentTemplate> {
  return requestJson<AgentTemplate>(`/admin/agent-templates/${encodeURIComponent(typeKey)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function syncAgentTemplateInstances(typeKey: string): Promise<AgentTemplateSyncResult> {
  return requestJson<AgentTemplateSyncResult>(`/admin/agent-templates/${encodeURIComponent(typeKey)}/sync`, {
    method: "POST",
  });
}

export async function publishAgentTemplate(typeKey: string): Promise<AgentTemplate> {
  return requestJson<AgentTemplate>(`/admin/agent-templates/${encodeURIComponent(typeKey)}/publish`, {
    method: "POST",
  });
}

export async function reloadAgentTemplates(): Promise<ActionStatusResponse> {
  return requestJson<ActionStatusResponse>("/admin/agent-templates/reload", {
    method: "POST",
  });
}

export async function fetchAgentInstances(): Promise<AgentInstance[]> {
  return requestJson<AgentInstance[]>("/admin/agent-instances", {
    method: "GET",
  });
}

export async function fetchAgentInstance(instanceId: string): Promise<AgentInstance> {
  return requestJson<AgentInstance>(`/admin/agent-instances/${encodeURIComponent(instanceId)}`, {
    method: "GET",
  });
}

export async function createAgentInstance(payload: AgentInstanceCreateRequest): Promise<AgentInstance> {
  return requestJson<AgentInstance>("/admin/agent-instances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAgentInstance(
  instanceId: string,
  payload: AgentInstanceUpdateRequest,
): Promise<AgentInstance> {
  return requestJson<AgentInstance>(`/admin/agent-instances/${encodeURIComponent(instanceId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteAgentInstance(instanceId: string): Promise<ActionStatusResponse> {
  return requestJson<ActionStatusResponse>(`/admin/agent-instances/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
  });
}

export async function fetchResolvedAgentInstance(instanceId: string): Promise<ResolvedAgentInstance> {
  return requestJson<ResolvedAgentInstance>(`/api/agent-instances/${encodeURIComponent(instanceId)}/resolved`, {
    method: "GET",
  });
}
