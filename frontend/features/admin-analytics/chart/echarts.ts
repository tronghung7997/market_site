// Tree-shaken ECharts build: only the chart types and components the admin
// analytics page draws. Loaded lazily (dynamic import) so it never reaches
// the storefront bundle or the server render.
import * as echarts from "echarts/core";
import { BarChart, FunnelChart, HeatmapChart, LineChart, ScatterChart, TreemapChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { UniversalTransition, LabelLayout } from "echarts/features";
import { SVGRenderer } from "echarts/renderers";

echarts.use([
  BarChart, LineChart, FunnelChart, HeatmapChart, ScatterChart, TreemapChart,
  AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent,
  TooltipComponent, VisualMapComponent, UniversalTransition, LabelLayout, SVGRenderer,
]);

export { echarts };
