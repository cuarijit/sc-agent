/**
 * AllocationConsolePage — thin wrapper around InventoryDiagnosticConsolePage
 * that filters to inventory_allocation_agent instances. The underlying
 * component handles LLM wiring (via ShellContext), capability snapshot,
 * pipeline/audit tabs, and the split-panel layout — so Allocation inherits
 * the same UX as the Inventory Diagnostic page. Query dispatch is
 * agent-type-aware inside the shared component.
 */
import InventoryDiagnosticConsolePage from "./InventoryDiagnosticConsolePage";

export default function AllocationConsolePage() {
  return (
    <InventoryDiagnosticConsolePage
      agentTypes={["inventory_allocation_agent"]}
      pageTitle="Allocation & Distribution"
    />
  );
}
