import { useEffect, useMemo } from "react";
import { useTheme } from "@mui/material";

import { echarts } from "./echartsCore";
import { buildEChartsTheme } from "./theme";

const REGISTERED = new Set<string>();

/**
 * Register `dcai-light` and `dcai-dark` ECharts themes derived from the live
 * MUI theme. Returns the theme name to pass into `<ReactECharts theme={...}>`.
 *
 * Re-derives and re-registers when `palette.mode` flips — cheap (runs once
 * per mode change) and keeps charts synced with the active palette without
 * forcing every wrapper to pass colors by hand.
 */
export function useEChartsTheme(): string {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode;
  const themeName = mode === "dark" ? "dcai-dark" : "dcai-light";

  const themeObj = useMemo(() => buildEChartsTheme(muiTheme), [muiTheme]);

  useEffect(() => {
    echarts.registerTheme(themeName, themeObj);
    REGISTERED.add(themeName);
  }, [themeName, themeObj]);

  if (!REGISTERED.has(themeName)) {
    echarts.registerTheme(themeName, themeObj);
    REGISTERED.add(themeName);
  }

  return themeName;
}
