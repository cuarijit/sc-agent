/**
 * RoutedPageShell — wraps any route element in a PageShell with consistent
 * header, breadcrumb, and scroll. The route → meta map mirrors the seeded
 * modules/pages so labels stay in sync with the navigation.
 */
import { type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { PageShell } from "../components/shared/PageLayout";

interface RouteMeta {
  module: string;
  title: string;
  subtitle?: string;
}

const ROUTE_META: Record<string, RouteMeta> = {
  // Smart Execution
  "/": { module: "Smart Execution", title: "Dashboard", subtitle: "Executive overview of network alerts, parameter integrity, and replenishment exceptions" },
  "/replenishment": { module: "Smart Execution", title: "Replenishment", subtitle: "Order book with exception highlighting and inline updates" },
  "/recommendations": { module: "Smart Execution", title: "Recommendations", subtitle: "Shortage / excess recommendations with approval workflow" },
  "/scenarios": { module: "Smart Execution", title: "Scenarios", subtitle: "Build and compare 'what-if' scenarios against the baseline plan" },
  "/network": { module: "Smart Execution", title: "Network", subtitle: "Network topology, lanes, alerts and simulation" },
  "/parameters": { module: "Smart Execution", title: "Parameters", subtitle: "Effective values, exceptions and bulk apply" },
  "/maintenance": { module: "Smart Execution", title: "Analytics", subtitle: "Diagnostics, history and quality monitoring" },
  "/documents": { module: "Smart Execution", title: "Documents", subtitle: "Full-text search across policy and vendor documents" },
  "/chat": { module: "Smart Execution", title: "Chat", subtitle: "Conversational AI assistant with full retrieval context" },
  // Intelligent Planning
  "/demand/forecasting": { module: "Intelligent Planning", title: "Demand Forecasting & Planning", subtitle: "Baseline forecasts, promotional lift and syndicated calibration" },
  "/demand/collaborative": { module: "Intelligent Planning", title: "Collaborative Planning", subtitle: "Consensus workbench with sales / customer / supply / marketing inputs" },
  "/demand/accuracy": { module: "Intelligent Planning", title: "Forecast Accuracy", subtitle: "MAPE, bias, WMAPE and tracking signal trends" },
  "/demand/sop": { module: "Intelligent Planning", title: "S&OP / IBP", subtitle: "S&OP cycles, calendar and review items" },
  "/demand/supply-integration": { module: "Intelligent Planning", title: "Supply Integration", subtitle: "Supply vs demand gap visualization and rebalance signals" },
  "/demand/financial": { module: "Intelligent Planning", title: "Financial Planning", subtitle: "Revenue, COGS and gross-margin plan by SKU / location / month" },
  "/demand/trade-promotion": { module: "Intelligent Planning", title: "Trade Promotion", subtitle: "Promotion calendar, lift impact and ROI analysis" },
  "/demand/analytics": { module: "Intelligent Planning", title: "Planning Analytics", subtitle: "Trends, anomalies and planning health diagnostics" },
  "/demand/customers": { module: "Intelligent Planning", title: "Customers", subtitle: "Customer hierarchy with regional drill-down" },
  // puls8 Agents
  "/agentic-ai/global-filter-compliance": { module: "puls8 Agents", title: "Filter Compliance", subtitle: "Validate global filters against available data" },
  "/agentic-ai/allocation-distribution": { module: "puls8 Agents", title: "Allocation & Distribution", subtitle: "Iftar-window routing, fair-share allocation, and waste minimization for perishable dairy" },
  "/agentic-ai/demand-sensing": { module: "puls8 Agents", title: "Demand Sensing", subtitle: "Real-time POS divergence, Ramadan ramp, and short-horizon shortage detection" },
};

function resolveMeta(pathname: string): RouteMeta | null {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  // Param-route prefix matches
  if (pathname.startsWith("/sku/")) return { module: "Smart Execution", title: "SKU Detail", subtitle: "Single SKU/location deep-dive with projection and policy snippets" };
  if (pathname.startsWith("/parameters/")) return { module: "Smart Execution", title: "Parameter Detail", subtitle: "Per-SKU/location parameter tuning interface" };
  if (pathname.startsWith("/replenishment/")) return ROUTE_META["/replenishment"];
  return null;
}

export default function RoutedPageShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const meta = resolveMeta(location.pathname);
  if (!meta) return <>{children}</>;
  return (
    <PageShell
      title={meta.title}
      subtitle={meta.subtitle}
      breadcrumbs={[{ label: meta.module }, { label: meta.title }]}
    >
      {children}
    </PageShell>
  );
}
