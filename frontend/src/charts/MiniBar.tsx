import React, { useMemo } from "react";
import { useTheme } from "@mui/material";

import EChartBase, { type EChartOption } from "./EChartBase";
import { defaultFieldFormatter, type FieldFormatter } from "./formatters";

export interface MiniBarItem {
  label: string;
  value: number | null;
}

export interface MiniBarProps {
  items: MiniBarItem[];
  field?: string;
  color?: string;
  height?: number;
  formatField?: FieldFormatter;
  dimmed?: boolean;
}

/** Horizontal mini-bars used inside KPI card "chart" cells (top-N categorical). */
export default function MiniBar({
  items,
  field = "",
  color,
  height = 120,
  formatField = defaultFieldFormatter,
  dimmed,
}: MiniBarProps) {
  const theme = useTheme();
  const option = useMemo<EChartOption>(() => {
    const barColor = color ?? theme.palette.primary.main;
    return {
      grid: { left: 96, right: 24, top: 4, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        valueFormatter: (v: unknown) => (field ? formatField(field, v) : String(v ?? "")),
      },
      xAxis: { type: "value", show: false },
      yAxis: {
        type: "category",
        data: items.map((i) => i.label),
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: "bar",
          data: items.map((i) => i.value),
          itemStyle: {
            color: barColor,
            borderRadius: [0, 4, 4, 0],
            opacity: dimmed ? 0.35 : 1,
          },
          barWidth: 14,
          label: {
            show: true,
            position: "right",
            fontSize: 10,
            color: theme.palette.text.secondary,
            formatter: (p: { value: unknown }) => (field ? formatField(field, p.value) : String(p.value ?? "")),
          },
        },
      ],
    };
  }, [items, field, color, theme, formatField, dimmed]);

  if (!items.length) return null;
  return <EChartBase option={option} height={height} />;
}
