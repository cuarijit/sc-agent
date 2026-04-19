import { request } from "./api";

export interface AdminPageRecord {
  id: number;
  module_id: number;
  page_slug: string;
  label: string;
  page_type: string;
  config_ref: string | null;
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  role_access: number[];
  agent_instance_ids: number[];
}

export interface AdminModuleRecord {
  id: number;
  module_slug: string;
  label: string;
  description: string;
  documentation: string;
  config_root: string | null;
  is_active: boolean;
  icon: string | null;
  sort_order: number;
  landing_page_slug: string | null;
  module_logo: string | null;
  created_at: string;
  updated_at: string;
  pages?: AdminPageRecord[];
  role_access?: number[];
}

export const fetchAdminModules = (): Promise<AdminModuleRecord[]> =>
  request("/admin/modules");

export const fetchAdminModule = (slug: string): Promise<AdminModuleRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}`);

export const createAdminModule = (payload: Partial<AdminModuleRecord>): Promise<AdminModuleRecord> =>
  request("/admin/modules", { method: "POST", body: JSON.stringify(payload) });

export const updateAdminModule = (slug: string, payload: Partial<AdminModuleRecord>): Promise<AdminModuleRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(payload) });

export const deleteAdminModule = (slug: string): Promise<{ status: string; detail: string }> =>
  request(`/admin/modules/${encodeURIComponent(slug)}`, { method: "DELETE" });

export const fetchAdminPages = (slug: string): Promise<AdminPageRecord[]> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages`);

export const createAdminPage = (slug: string, payload: Partial<AdminPageRecord>): Promise<AdminPageRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages`, { method: "POST", body: JSON.stringify(payload) });

export const updateAdminPage = (slug: string, pageSlug: string, payload: Partial<AdminPageRecord>): Promise<AdminPageRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages/${encodeURIComponent(pageSlug)}`, { method: "PATCH", body: JSON.stringify(payload) });

export const deleteAdminPage = (slug: string, pageSlug: string): Promise<{ status: string; detail: string }> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages/${encodeURIComponent(pageSlug)}`, { method: "DELETE" });

export const setModuleRoles = (slug: string, role_ids: number[]): Promise<AdminModuleRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/roles`, { method: "PUT", body: JSON.stringify({ role_ids }) });

export const setPageRoles = (slug: string, pageSlug: string, role_ids: number[]): Promise<AdminPageRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages/${encodeURIComponent(pageSlug)}/roles`, { method: "PUT", body: JSON.stringify({ role_ids }) });

export const setPageAgents = (slug: string, pageSlug: string, agent_instance_ids: number[]): Promise<AdminPageRecord> =>
  request(`/admin/modules/${encodeURIComponent(slug)}/pages/${encodeURIComponent(pageSlug)}/agents`, { method: "PUT", body: JSON.stringify({ agent_instance_ids }) });
