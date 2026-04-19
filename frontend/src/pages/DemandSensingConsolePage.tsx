/**
 * DemandSensingConsolePage — thin wrapper around InventoryDiagnosticConsolePage
 * that filters to demand_sensing_agent instances. Inherits LLM wiring,
 * capability snapshot, pipeline/audit tabs, and the split-panel layout from
 * the shared diagnostic component; query dispatch routes to
 * /api/demand-sensing/query via agent-type-aware dispatcher.
 */
import InventoryDiagnosticConsolePage from "./InventoryDiagnosticConsolePage";

export default function DemandSensingConsolePage() {
  return (
    <InventoryDiagnosticConsolePage
      agentTypes={["demand_sensing_agent"]}
      pageTitle="Demand Sensing"
    />
  );
}
