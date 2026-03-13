import { Button, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import type { ScenarioResponse } from "../types";
import { evaluateScenario } from "../services/api";
import { RecommendationTable, ScenarioDeltaChart, SectionCard } from "../components/shared/UiBits";

export default function ScenarioPage() {
  const [scenarioName, setScenarioName] = useState("Demand uplift");
  const [forecastMultiplier, setForecastMultiplier] = useState("1.20");
  const [leadTimeDelay, setLeadTimeDelay] = useState("3");

  const mutation = useMutation<ScenarioResponse>({
    mutationFn: () =>
      evaluateScenario({
        scenario_name: scenarioName,
        scope: {},
        changes: {
          forecast_multiplier: Number(forecastMultiplier),
          forecast_error_multiplier: 1.2,
          lead_time_delay_days: Number(leadTimeDelay),
          supplier_reliability_delta: 0.05,
        },
        horizon_weeks: 8,
      }),
  });

  return (
    <div className="page-scroll">
      <div className="page-grid page-grid-two">
        <div>
          <SectionCard title="Scenario Controls" subtitle="What-if planning with deterministic recalculation">
            <Stack spacing={1}>
              <TextField size="small" label="Scenario Name" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
              <TextField size="small" label="Forecast Multiplier" value={forecastMultiplier} onChange={(event) => setForecastMultiplier(event.target.value)} />
              <TextField size="small" label="Lead Time Delay Days" value={leadTimeDelay} onChange={(event) => setLeadTimeDelay(event.target.value)} />
              <Button variant="contained" onClick={() => mutation.mutate()}>Run Scenario</Button>
              <Typography variant="body2">{mutation.data?.summary}</Typography>
            </Stack>
          </SectionCard>
        </div>
        <div>
          <SectionCard title="Scenario Delta" subtitle="Impacted recommendation shortages">
            <ScenarioDeltaChart data={mutation.data?.deltas ?? []} />
          </SectionCard>
        </div>
      </div>
      <SectionCard title="Scenario Recommendations" subtitle={mutation.data?.scenario_run_id ?? "Run a scenario to compare"}>
        <RecommendationTable rows={mutation.data?.deltas ?? []} />
      </SectionCard>
    </div>
  );
}
