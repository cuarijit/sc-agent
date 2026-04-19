import AgentConfigPage from "../features/agentConfig/pages/AgentConfigPage";
import { PageShell } from "../components/shared/PageLayout";

export default function AgentConfigurationPage() {
  return (
    <PageShell
      title="Agent Configurator"
      subtitle="Manage AI agent templates and instances"
      breadcrumbs={[{ label: "Agentic AI" }, { label: "Agent Configurator" }]}
    >
      <AgentConfigPage />
    </PageShell>
  );
}
