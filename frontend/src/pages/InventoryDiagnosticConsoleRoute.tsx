import { PageShell } from "../components/shared/PageLayout";
import InventoryDiagnosticConsolePage from "./InventoryDiagnosticConsolePage";

export default function InventoryDiagnosticConsoleRoute() {
  return (
    <PageShell
      title="Inventory Diagnostic Console"
      subtitle="LLM-powered diagnose / solve / dispatch over the network"
      breadcrumbs={[{ label: "Agentic AI" }, { label: "Inventory Diagnostic" }]}
    >
      <InventoryDiagnosticConsolePage />
    </PageShell>
  );
}
