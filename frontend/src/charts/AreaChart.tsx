import React from "react";

import LineChart, { type LineChartProps } from "./LineChart";

/**
 * Thin convenience wrapper that renders each series as an area-fill line.
 * All semantics and selection plumbing live in LineChart.
 */
export default function AreaChart(props: LineChartProps) {
  return <LineChart {...props} renderAsArea />;
}
