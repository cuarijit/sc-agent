import { Stack, Tab, Tabs, Typography } from "@mui/material";
import { useState } from "react";
import { useOutletContext } from "react-router-dom";

import type { ShellContextValue } from "../components/layout/AppShellLayout";
import ProjectedInventoryWorkbench from "../components/inventory/ProjectedInventoryWorkbench";
import GlobalFilterChatbotModal from "../components/layout/GlobalFilterChatbotModal";
import { SectionCard } from "../components/shared/UiBits";
import { firstFilterValue } from "../types/filters";

export default function MaintenancePage() {
  const { filters, setFilters, config, openAiApiKey } = useOutletContext<ShellContextValue>();
  const [tab, setTab] = useState(0);
  const onDemandTabIndex = 0;
  const projectedInventoryTabIndex = 1;

  return (
    <div className="page-scroll">
      <SectionCard title="Analytics" subtitle="Run on-demand agent analysis or inspect projected inventory.">
        <Tabs
          value={tab}
          onChange={(_event, value) => {
            setTab(value);
          }}
        >
          <Tab label="On-Demand Analysis" />
          <Tab label="Projected Inventory" />
        </Tabs>
        {tab === onDemandTabIndex ? (
          <Stack spacing={1.2} sx={{ mt: 1.2 }}>
            <Typography variant="body2" color="text.secondary">
              Use the On-Demand Analysis Agent for ad-hoc MEIO database questions and iterative follow-up analysis.
            </Typography>
            <GlobalFilterChatbotModal
              open
              onClose={() => {}}
              filters={filters}
              setFilters={setFilters}
              config={config}
              openAiApiKey={openAiApiKey}
              title="On-Demand Analysis Agent"
              showApplyToGlobalFilter={false}
              embedded
              enableCharts
              assistantMode="on-demand-analysis-agent"
            />
          </Stack>
        ) : tab === projectedInventoryTabIndex ? (
          <ProjectedInventoryWorkbench initialSku={firstFilterValue(filters.sku) || undefined} initialLocation={firstFilterValue(filters.location) || undefined} />
        ) : (
          null
        )}
      </SectionCard>
    </div>
  );
}
