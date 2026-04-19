/**
 * Tree-shaken ECharts core registration.
 *
 * Only the chart types, components, and renderer that the puls8 UI actually
 * uses are registered here — keeps the bundle lean. Add new chart types or
 * components by extending the `use()` call below.
 */

import * as echarts from "echarts/core";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from "echarts/charts";
import {
  BrushComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  BrushComponent,
  VisualMapComponent,
  TitleComponent,
  ToolboxComponent,
  CanvasRenderer,
]);

export { echarts };
export default echarts;
