import React, { useMemo } from "react";
import { useTheme } from "@mui/material";

import EChartBase, { type EChartOption } from "./EChartBase";
import { intentFromHeatmapClick } from "./selection";
import type { ChartCommonProps } from "./types";

export type HeatmapCell = { x: string; y: string; value: number | null };

export interface HeatmapChartProps extends ChartCommonProps {
  xLabels: string[];
  yLabels: string[];
  cells: HeatmapCell[];
  colorScale?: "blue" | "green" | "red" | "blue_red" | "green_red";
  showValues?: boolean;
}

const SCALES: Record<string, { low: string; high: string; mid?: string }> = {
  blue: { low: "#eff6ff", high: "#1e40af" },
  green: { low: "#f0fdf4", high: "#166534" },
  red: { low: "#fef2f2", high: "#991b1b" },
  blue_red: { low: "#1e40af", mid: "#f5f5f5", high: "#991b1b" },
  green_red: { low: "#166534", mid: "#f5f5f5", high: "#991b1b" },
};

export default function HeatmapChart({
  chartId,
  xLabels,
  yLabels,
  cells,
  colorScale = "blue",
  showValues = true,
  height = 320,
  loading,
  empty,
  emptyLabel,
  ariaLabel,
  selectionFields,
  onSelectionChange,
}: HeatmapChartProps) {
  const theme = useTheme();
  const option = useMemo<EChartOption>(() => {
    const scale = SCALES[colorScale] ?? SCALES.blue;
    const xIndex = new Map(xLabels.map((l, i) => [l, i]));
    const yIndex = new Map(yLabels.map((l, i) => [l, i]));
    let minV = Infinity;
    let maxV = -Infinity;
    for (const c of cells) {
      if (c.value != null) {
        if (c.value < minV) minV = c.value;
        if (c.value > maxV) maxV = c.value;
      }
    }
    if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
    const data = cells
      .filter((c) => xIndex.has(c.x) && yIndex.has(c.y))
      .map((c) => [xIndex.get(c.x)!, yIndex.get(c.y)!, c.value] as [number, number, number | null]);
    const visualMapColors = scale.mid ? [scale.low, scale.mid, scale.high] : [scale.low, scale.high];

    return {
      grid: { left: 80, right: 16, top: 16, bottom: 70, containLabel: true },
      tooltip: {
        position: "top",
        formatter: (p: { data: [number, number, number | null] }) => {
          const [xi, yi, v] = p.data;
          const xl = xLabels[xi] ?? "";
          const yl = yLabels[yi] ?? "";
          return `<strong>${yl}</strong> · ${xl}<br/>${v == null ? "–" : (Number.isInteger(v) ? v : v.toFixed(2))}`;
        },
      },
      xAxis: {
        type: "category",
        data: xLabels,
        splitArea: { show: true },
        axisLabel: { rotate: xLabels.length > 8 ? 45 : 0, fontSize: 10 },
      },
      yAxis: {
        type: "category",
        data: yLabels,
        splitArea: { show: true },
        axisLabel: { fontSize: 10 },
      },
      visualMap: {
        min: minV,
        max: maxV,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        inRange: { color: visualMapColors },
        textStyle: { color: theme.palette.text.secondary, fontSize: 10 },
      },
      series: [
        {
          id: `${chartId}_heatmap`,
          type: "heatmap",
          data,
          label: {
            show: showValues,
            fontSize: 10,
            formatter: (p: { data: [number, number, number | null] }) => {
              const v = p.data[2];
              if (v == null) return "";
              return Number.isInteger(v) ? String(v) : v.toFixed(2);
            },
          },
          emphasis: { itemStyle: { borderWidth: 2, borderColor: theme.palette.primary.main } },
        },
      ],
    };
  }, [chartId, xLabels, yLabels, cells, colorScale, showValues, theme]);

  const onEvents = useMemo(() => {
    if (!onSelectionChange) return undefined;
    return {
      click: (p: unknown) => {
        const params = p as { data?: [number, number, number | null] };
        const d = params?.data;
        if (!d) return;
        const [xi, yi] = d;
        const col = xLabels[xi];
        const row = yLabels[yi];
        const intent = intentFromHeatmapClick(
          row,
          col,
          selectionFields?.rowField,
          selectionFields?.colField,
        );
        // eslint-disable-next-line no-console
        console.info("[chart:click]", chartId, intent);
        onSelectionChange(intent);
      },
    };
  }, [chartId, onSelectionChange, selectionFields, xLabels, yLabels]);

  return (
    <EChartBase
      option={option}
      height={height}
      loading={loading}
      empty={empty || cells.length === 0}
      emptyLabel={emptyLabel}
      ariaLabel={ariaLabel}
      onEvents={onEvents}
    />
  );
}
