import { Alert, Stack, Tab, Tabs } from "@mui/material";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { SectionCard } from "../../../components/shared/UiBits";
import type {
  AgentInstance,
  AgentInstanceCreateRequest,
  AgentInstanceUpdateRequest,
  AgentTemplate,
} from "../../../services/agentConfigApi";
import AgentInstanceFormDialog from "../components/AgentInstanceFormDialog";
import AgentInstanceListEditor from "../components/AgentInstanceListEditor";
import AgentTemplateEditor from "../components/AgentTemplateEditor";
import AgentTemplateList from "../components/AgentTemplateList";
import { useAgentConfig } from "../hooks/useAgentConfig";

export default function AgentConfigPage() {
  const {
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
    createInstance,
    updateInstance,
    removeInstance,
    updateTemplate,
    syncTemplateInstances,
    publishTemplate,
    reloadTemplates,
  } = useAgentConfig();

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: "templates" | "instances" = tabParam === "templates" ? "templates" : "instances";
  const setActiveTab = (value: "templates" | "instances") => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };
  const [formOpen, setFormOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<AgentInstance | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<AgentTemplate | null>(null);

  const handleAdd = () => {
    setEditingInstance(null);
    setFormOpen(true);
  };

  const handleEdit = (instance: AgentInstance) => {
    setEditingInstance(instance);
    setFormOpen(true);
  };

  const handleDelete = (instanceId: string) => {
    void removeInstance(instanceId);
  };

  const handleSave = (
    payload: AgentInstanceCreateRequest | AgentInstanceUpdateRequest,
    isEdit: boolean,
  ) => {
    if (isEdit && editingInstance) {
      void updateInstance(editingInstance.instance_id, payload as AgentInstanceUpdateRequest);
    } else {
      void createInstance(payload as AgentInstanceCreateRequest);
    }
    setFormOpen(false);
    setEditingInstance(null);
  };

  const handleEditTemplate = (template: AgentTemplate) => {
    setEditingTemplate(template);
  };

  const handleSaveTemplate = (
    typeKey: string,
    payload: { default_config?: Record<string, unknown>; default_instance?: Record<string, unknown>; ui_hints?: Record<string, unknown>; behavior?: Record<string, unknown> },
  ) => {
    void updateTemplate(typeKey, payload);
  };

  const handleSyncTemplate = (typeKey: string) => {
    void syncTemplateInstances(typeKey);
  };

  const handlePublishTemplate = async (typeKey: string) => {
    await publishTemplate(typeKey);
    // Close the editor so the refreshed template list reopens with the
    // promoted status badge — avoids stale `template` prop in the drawer.
    setEditingTemplate(null);
  };

  const handleReloadTemplates = () => {
    void reloadTemplates();
  };

  return (
    <div className="page-scroll">
      <SectionCard
        title="Agent Configurator"
        subtitle="Manage SCP agent templates and instances, button appearance, role access, and action permissions."
        helpId="page__agent_configurator"
      >
        {error || successMessage ? (
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
            {successMessage ? <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert> : null}
          </Stack>
        ) : null}

        <Tabs
          value={activeTab}
          onChange={(_event, value) => setActiveTab(value)}
          sx={{ minHeight: 36, mb: 2 }}
        >
          <Tab value="instances" label="Instances" />
          <Tab value="templates" label="Templates" />
        </Tabs>

        {activeTab === "instances" ? (
          <AgentInstanceListEditor
            instances={instances}
            agentTypes={agentTypes}
            templates={templates}
            loading={loading}
            onAdd={handleAdd}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onRefresh={() => {
              void loadInstances();
            }}
          />
        ) : (
          <AgentTemplateList
            templates={templates}
            loading={loading}
            onEdit={handleEditTemplate}
            onSync={handleSyncTemplate}
            onPublish={handlePublishTemplate}
            onRefresh={handleReloadTemplates}
          />
        )}
      </SectionCard>

      <AgentInstanceFormDialog
        open={formOpen}
        editingInstance={editingInstance}
        agentTypes={agentTypes}
        templates={templates}
        roles={roles}
        modules={modules}
        onClose={() => {
          setFormOpen(false);
          setEditingInstance(null);
        }}
        onSave={handleSave}
      />

      <AgentTemplateEditor
        open={editingTemplate !== null}
        template={editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSave={handleSaveTemplate}
        onSync={handleSyncTemplate}
        onPublish={handlePublishTemplate}
      />
    </div>
  );
}
