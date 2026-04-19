import React, { useMemo } from "react";

import EChartBase, { type EChartOption } from "./EChartBase";

export interface SparklineProps {
  data: Array<{ date?: unknown; value: number | null }>;
  color?: string;
  height?: number;
  showArea?: boolean;
}

/**
 * Minimal inline trend line for KPI cards. No axes, no legend, no selection —
 * cards are too small for interactivity and the goal is decorative context.
 */
export default function Sparkline({ data, color, height = 24, showArea = true }: SparklineProps) {
  const option = useMemo<EChartOption>(() => ({
    grid: { left: 0, right: 0, top: 1, bottom: 1, containLabel: false },
    tooltip: { show: false },
    xAxis: { type: "category", show: false, data: data.map((d, i) => d.date ?? i), boundaryGap: false },
    yAxis: { type: "value", show: false, scale: true },
    series: [
      {
        type: "line",
        data: data.map((d) => d.value),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 1.5, color },
        itemStyle: color ? { color } : undefined,
        areaStyle: showArea ? { opacity: 0.2 } : undefined,
        silent: true,
        animation: false,
      },
    ],
  }), [data, color, showArea]);

  if (!data.length) return null;
  return <EChartBase option={option} height={height} />;
}
