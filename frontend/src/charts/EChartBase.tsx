import React from "react";
import { Box, Skeleton, Typography, useTheme } from "@mui/material";
import ReactECharts from "echarts-for-react/lib/core";

import { echarts } from "./echartsCore";
import { useEChartsTheme } from "./useEChartsTheme";

export type EChartOption = Record<string, unknown>;

export type ECharts = unknown;

export type EChartEventHandler = (params: unknown, instance: ECharts | null) => void;

export interface EChartBaseProps {
  option: EChartOption;
  height?: number | string;
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
  ariaLabel?: string;
  onEvents?: Record<string, EChartEventHandler>;
  onInstanceReady?: (instance: ECharts) => void;
  notMerge?: boolean;
  lazyUpdate?: boolean;
  className?: string;
}

/**
 * Thin wrapper around `echarts-for-react` core build. Every wrapper (Line,
 * Bar, Pie, ...) renders through this component so theme, sizing, loading,
 * empty, and event plumbing live in one place.
 *
 * - Theme: derived from MUI via `useEChartsTheme`; re-registers on dark/light
 *   flip.
 * - Empty / loading: MUI Skeleton + text states that match the rest of the
 *   app's loading aesthetic.
 * - Resize: `ReactECharts` handles initial resize via its own ResizeObserver;
 *   we trust it.
 */
export default function EChartBase({
  option,
  height = 280,
  loading,
  empty,
  emptyLabel = "No data",
  ariaLabel,
  onEvents,
  onInstanceReady,
  notMerge = true,
  lazyUpdate = true,
  className,
}: EChartBaseProps) {
  const themeName = useEChartsTheme();
  const muiTheme = useTheme();

  if (loading) {
    return (
      <Box sx={{ width: "100%", height, position: "relative" }} className={className}>
        <Skeleton variant="rectangular" width="100%" height="100%" sx={{ borderRadius: 1 }} />
      </Box>
    );
  }

  if (empty) {
    return (
      <Box
        sx={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: muiTheme.palette.text.secondary,
          fontSize: 13,
          border: `1px dashed ${muiTheme.palette.divider}`,
          borderRadius: 1,
        }}
        className={className}
      >
        <Typography variant="caption">{emptyLabel}</Typography>
      </Box>
    );
  }

  const enrichedOption: EChartOption = {
    ...option,
    aria: ariaLabel ? { enabled: true, label: { description: ariaLabel } } : (option as { aria?: unknown }).aria,
  };

  return (
    <ReactECharts
      echarts={echarts}
      option={enrichedOption}
      theme={themeName}
      style={{ width: "100%", height }}
      notMerge={notMerge}
      lazyUpdate={lazyUpdate}
      onEvents={onEvents}
      onChartReady={(chart) => {
        if (onInstanceReady) onInstanceReady(chart as unknown);
      }}
      className={className}
      opts={{ renderer: "canvas" }}
    />
  );
}
