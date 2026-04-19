import { useCallback, useEffect, useState } from "react";

import {
  createAgentInstance,
  deleteAgentInstance,
  fetchAdminModules,
  fetchAgentInstances,
  fetchAgentTemplates,
  fetchAgentTypes,
  fetchRoles,
  publishAgentTemplate,
  reloadAgentTemplates,
  syncAgentTemplateInstances,
  updateAgentInstance,
  updateAgentTemplate,
  type AdminModuleRecord,
  type AgentInstance,
  type AgentInstanceCreateRequest,
  type AgentInstanceUpdateRequest,
  type AgentTemplate,
  type AgentTypeDefinition,
  type Role,
} from "../../../services/agentConfigApi";

export function useAgentConfig() {
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [agentTypes, setAgentTypes] = useState<AgentTypeDefinition[]>([]);
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [modules, setModules] = useState<AdminModuleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadInstances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [instancesData, typesData, templatesData, rolesData, modulesData] = await Promise.all([
        fetchAgentInstances(),
        fetchAgentTypes(),
        fetchAgentTemplates().catch(() => [] as AgentTemplate[]),
        fetchRoles().catch(() => [] as Role[]),
        fetchAdminModules().catch(() => [] as AdminModuleRecord[]),
      ]);
      setInstances(instancesData);
      setAgentTypes(typesData);
      setTemplates(templatesData);
      setRoles(rolesData);
      setModules(modulesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent instances");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAgentTypes = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchAgentTypes();
      setAgentTypes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent types");
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchAgentTemplates();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent templates");
    }
  }, []);

  useEffect(() => {
    void loadInstances();
  }, [loadInstances]);

  const createInstance = useCallback(
    async (payload: AgentInstanceCreateRequest) => {
      setError(null);
      try {
        await createAgentInstance(payload);
        setSuccessMessage(`Agent instance "${payload.display_name}" created successfully.`);
        await loadInstances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create agent instance");
      }
    },
    [loadInstances],
  );

  const updateInstanceCb = useCallback(
    async (instanceId: string, payload: AgentInstanceUpdateRequest) => {
      setError(null);
      try {
        await updateAgentInstance(instanceId, payload);
        setSuccessMessage("Agent instance updated.");
        await loadInstances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update agent instance");
      }
    },
    [loadInstances],
  );

  const removeInstance = useCallback(
    async (instanceId: string) => {
      setError(null);
      try {
        await deleteAgentInstance(instanceId);
        setSuccessMessage("Agent instance deleted.");
        await loadInstances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to delete agent instance");
      }
    },
    [loadInstances],
  );

  const updateTemplateCb = useCallback(
    async (typeKey: string, payload: { default_config?: Record<string, unknown>; default_instance?: Record<string, unknown>; ui_hints?: Record<string, unknown>; behavior?: Record<string, unknown> }) => {
      setError(null);
      try {
        await updateAgentTemplate(typeKey, payload);
        setSuccessMessage(`Template "${typeKey}" updated.`);
        await loadTemplates();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update template");
      }
    },
    [loadTemplates],
  );

  const syncTemplateInstancesCb = useCallback(
    async (typeKey: string) => {
      setError(null);
      try {
        const result = await syncAgentTemplateInstances(typeKey);
        const fieldsMsg = result.fields_added.length > 0
          ? ` Fields added: ${result.fields_added.join(", ")}.`
          : "";
        setSuccessMessage(`Synced ${result.synced_count} instance(s).${fieldsMsg}`);
        await loadInstances();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sync template instances");
      }
    },
    [loadInstances],
  );

  const publishTemplateCb = useCallback(
    async (typeKey: string) => {
      setError(null);
      try {
        const updated = await publishAgentTemplate(typeKey);
        setSuccessMessage(`Template "${typeKey}" promoted to ${updated.status} (v${updated.template_version}).`);
        await loadTemplates();
        await loadAgentTypes();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to promote template");
      }
    },
    [loadTemplates, loadAgentTypes],
  );

  const reloadTemplatesCb = useCallback(async () => {
    setError(null);
    try {
      await reloadAgentTemplates();
      setSuccessMessage("Templates reloaded from filesystem.");
      await loadTemplates();
      await loadAgentTypes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reload templates");
    }
  }, [loadTemplates, loadAgentTypes]);

  return {
    instances,
    agentTypes,
    templates,
    roles,
    modules,
    loading,
    error,
    successMessage,
    setError,
    setSuccessMessage,
    loadInstances,
    loadAgentTypes,
    loadTemplates,
    createInstance,
    updateInstance: updateInstanceCb,
    removeInstance,
    updateTemplate: updateTemplateCb,
    syncTemplateInstances: syncTemplateInstancesCb,
    publishTemplate: publishTemplateCb,
    reloadTemplates: reloadTemplatesCb,
  };
}
