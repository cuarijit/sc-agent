import React from "react";
import CloseIcon from "@mui/icons-material/Close";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Box, Button, Chip, Stack, Tooltip, Typography, keyframes } from "@mui/material";

import { describeEntry } from "./selection";
import type { ChartCrossFilterEntry } from "./types";

export interface CrossFilterChipsProps {
  entries: ChartCrossFilterEntry[];
  onRemoveByChart: (sourceChartId: string) => void;
  onReset: () => void;
  aliasOf?: (field: string) => string;
}

const fadeIn = keyframes`
  0% { opacity: 0; transform: translateY(-2px); }
  100% { opacity: 1; transform: translateY(0); }
`;

function chipTooltipText(entry: ChartCrossFilterEntry, aliasOf: (f: string) => string): string {
  const fieldLabel = aliasOf(entry.field) || entry.field;
  if (entry.operator === "in") {
    return `${entry.sourceChartTitle} · ${fieldLabel} ∈ [${(entry.values ?? []).join(", ")}]`;
  }
  if (entry.operator === "between") {
    return `${entry.sourceChartTitle} · ${fieldLabel} between ${entry.value} and ${entry.secondaryValue ?? ""}`;
  }
  return `${entry.sourceChartTitle} · ${fieldLabel} ${entry.operator} ${entry.value}`;
}

/**
 * Renders currently-active cross-chart filters as dismissible chips with a
 * "Reset all" button. Clearing here affects ONLY the chart cross-filter;
 * page-level and tab-level filters are untouched.
 */
export default function CrossFilterChips({
  entries,
  onRemoveByChart,
  onReset,
  aliasOf = (f) => f,
}: CrossFilterChipsProps) {
  if (!entries.length) return null;

  const byChart = new Map<string, ChartCrossFilterEntry[]>();
  for (const e of entries) {
    const arr = byChart.get(e.sourceChartId) ?? [];
    arr.push(e);
    byChart.set(e.sourceChartId, arr);
  }

  return (
    <Stack
      direction="row"
      spacing={0.75}
      alignItems="center"
      role="status"
      aria-live="polite"
      sx={{
        flexWrap: "wrap",
        animation: `${fadeIn} 0.18s ease-out`,
        rowGap: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontWeight: 600 }}>
        Chart filter:
      </Typography>
      {Array.from(byChart.entries()).map(([chartId, chartEntries]) => {
        const title = chartEntries[0].sourceChartTitle;
        const describe = chartEntries
          .map((e) => `${aliasOf(e.field) || e.field}: ${describeEntry(e)}`)
          .join(" · ");
        const tooltip = chartEntries.map((e) => chipTooltipText(e, aliasOf)).join("\n");
        return (
          <Tooltip key={chartId} title={<Box sx={{ whiteSpace: "pre-line" }}>{tooltip}</Box>} arrow>
            <Chip
              size="small"
              label={(
                <Stack direction="row" spacing={0.5} alignItems="baseline">
                  <Typography variant="caption" fontWeight={600}>{title}</Typography>
                  <Typography variant="caption" color="text.secondary">·</Typography>
                  <Typography variant="caption">{describe}</Typography>
                </Stack>
              )}
              onDelete={() => onRemoveByChart(chartId)}
              deleteIcon={<CloseIcon fontSize="small" />}
              sx={{ maxWidth: 380 }}
            />
          </Tooltip>
        );
      })}
      <Button
        size="small"
        variant="text"
        color="primary"
        startIcon={<RestartAltIcon fontSize="small" />}
        onClick={onReset}
        sx={{ ml: 0.5 }}
      >
        Reset
      </Button>
    </Stack>
  );
}
