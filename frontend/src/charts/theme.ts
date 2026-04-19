import type { Theme } from "@mui/material";
import { alpha } from "@mui/material";

import { CHART_COLOR_PALETTE } from "./chartColors";

/**
 * Derive an ECharts theme object from the active MUI theme so palette / dark
 * mode changes propagate to every chart via `registerTheme`. The shape is
 * hand-assembled (vs. piping through a theme-builder DSL) because ECharts'
 * theme schema is small and stable, and the colors we need are all already
 * exposed as MUI design tokens.
 */
export function buildEChartsTheme(muiTheme: Theme): Record<string, unknown> {
  const p = muiTheme.palette;
  const seriesColors: string[] = [
    p.primary.main,
    p.secondary.main,
    p.success.main,
    p.warning.main,
    p.error.main,
    p.info.main,
    ...CHART_COLOR_PALETTE,
  ];

  const textPrimary = p.text.primary;
  const textSecondary = p.text.secondary;
  const dividerColor = p.divider;

  const axisCommon = {
    axisLine: { lineStyle: { color: dividerColor } },
    axisTick: { lineStyle: { color: dividerColor } },
    axisLabel: { color: textSecondary, fontSize: 11 },
    splitLine: { lineStyle: { color: alpha(dividerColor, 0.5) } },
    splitArea: { show: false },
    nameTextStyle: { color: textSecondary },
  };

  return {
    backgroundColor: "transparent",
    color: seriesColors,
    textStyle: {
      color: textPrimary,
      fontFamily: muiTheme.typography.fontFamily,
    },
    title: {
      textStyle: { color: textPrimary, fontWeight: 600 },
      subtextStyle: { color: textSecondary },
    },
    categoryAxis: axisCommon,
    valueAxis: axisCommon,
    timeAxis: axisCommon,
    logAxis: axisCommon,
    line: {
      itemStyle: { borderWidth: 0 },
      lineStyle: { width: 2 },
      symbolSize: 6,
      smooth: false,
    },
    bar: {
      itemStyle: { borderRadius: [2, 2, 0, 0] },
    },
    pie: {
      itemStyle: { borderColor: p.background.paper, borderWidth: 1 },
      label: { color: textPrimary },
    },
    scatter: {
      itemStyle: { borderWidth: 0 },
    },
    graph: {
      itemStyle: { borderWidth: 0 },
      lineStyle: { color: dividerColor, width: 1 },
      label: { color: textPrimary },
    },
    legend: {
      textStyle: { color: textPrimary, fontSize: 11 },
      inactiveColor: alpha(textSecondary, 0.4),
      pageTextStyle: { color: textSecondary },
      itemStyle: { borderWidth: 0 },
    },
    tooltip: {
      backgroundColor: p.background.paper,
      borderColor: dividerColor,
      borderWidth: 1,
      textStyle: { color: textPrimary, fontSize: 12 },
      extraCssText: `box-shadow: 0 2px 8px ${alpha("#000", p.mode === "dark" ? 0.45 : 0.15)}; border-radius: 6px;`,
      axisPointer: {
        lineStyle: { color: alpha(textSecondary, 0.5) },
        crossStyle: { color: alpha(textSecondary, 0.5) },
        label: { backgroundColor: alpha(p.background.default, 0.9), color: textPrimary },
      },
    },
    toolbox: {
      iconStyle: { borderColor: textSecondary },
      emphasis: { iconStyle: { borderColor: p.primary.main } },
    },
    brush: {
      brushStyle: {
        color: alpha(p.primary.main, 0.15),
        borderColor: p.primary.main,
        borderWidth: 1,
      },
      throttleType: "debounce",
      throttleDelay: 120,
    },
    dataZoom: {
      backgroundColor: "transparent",
      dataBackgroundColor: alpha(p.primary.main, 0.15),
      fillerColor: alpha(p.primary.main, 0.2),
      handleColor: p.primary.main,
      handleSize: "100%",
      textStyle: { color: textSecondary },
    },
    visualMap: {
      textStyle: { color: textPrimary },
    },
    timeline: {
      lineStyle: { color: dividerColor },
      itemStyle: { color: p.primary.main },
      label: { color: textSecondary },
      controlStyle: { color: textSecondary, borderColor: dividerColor },
    },
  };
}

export const CHART_BG_TRANSPARENT = "transparent";
