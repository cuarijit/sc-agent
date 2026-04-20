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
  // Puls8 Supply Planning
  "/": { module: "Puls8 Supply Planning", title: "Dashboard", subtitle: "Executive overview of network alerts, parameter integrity, and replenishment exceptions" },
  "/replenishment": { module: "Puls8 Supply Planning", title: "Replenishment", subtitle: "Order book with exception highlighting and inline updates" },
  "/recommendations": { module: "Puls8 Supply Planning", title: "Recommendations", subtitle: "Shortage / excess recommendations with approval workflow" },
  "/scenarios": { module: "Puls8 Supply Planning", title: "Scenarios", subtitle: "Build and compare 'what-if' scenarios against the baseline plan" },
  "/network": { module: "Puls8 Supply Planning", title: "Network", subtitle: "Network topology, lanes, alerts and simulation" },
  "/parameters": { module: "Puls8 Supply Planning", title: "Parameters", subtitle: "Effective values, exceptions and bulk apply" },
  "/maintenance": { module: "Puls8 Supply Planning", title: "Analytics", subtitle: "Diagnostics, history and quality monitoring" },
  "/documents": { module: "Puls8 Supply Planning", title: "Documents", subtitle: "Full-text search across policy and vendor documents" },
  "/chat": { module: "Puls8 Supply Planning", title: "Chat", subtitle: "Conversational AI assistant with full retrieval context" },
  // Puls8 Demand Planning
  "/demand/forecasting": { module: "Puls8 Demand Planning", title: "Demand Forecasting & Planning", subtitle: "Baseline forecasts, promotional lift and syndicated calibration" },
  "/demand/collaborative": { module: "Puls8 Demand Planning", title: "Collaborative Planning", subtitle: "Consensus workbench with sales / customer / supply / marketing inputs" },
  "/demand/accuracy": { module: "Puls8 Demand Planning", title: "Forecast Accuracy", subtitle: "MAPE, bias, WMAPE and tracking signal trends" },
  "/demand/sop": { module: "Puls8 Demand Planning", title: "S&OP / IBP", subtitle: "S&OP cycles, calendar and review items" },
  "/demand/supply-integration": { module: "Puls8 Demand Planning", title: "Supply Integration", subtitle: "Supply vs demand gap visualization and rebalance signals" },
  "/demand/financial": { module: "Puls8 Demand Planning", title: "Financial Planning", subtitle: "Revenue, COGS and gross-margin plan by SKU / location / month" },
  "/demand/trade-promotion": { module: "Puls8 Demand Planning", title: "Trade Promotion", subtitle: "Promotion calendar, lift impact and ROI analysis" },
  "/demand/analytics": { module: "Puls8 Demand Planning", title: "Planning Analytics", subtitle: "Trends, anomalies and planning health diagnostics" },
  "/demand/customers": { module: "Puls8 Demand Planning", title: "Customers", subtitle: "Customer hierarchy with regional drill-down" },
  // puls8 Agents
  "/agentic-ai/global-filter-compliance": { module: "puls8 Agents", title: "Filter Compliance", subtitle: "Validate global filters against available data" },
  "/agentic-ai/allocation-distribution": { module: "puls8 Agents", title: "Allocation & Distribution", subtitle: "Iftar-window routing, fair-share allocation, and waste minimization for perishable dairy" },
  "/agentic-ai/demand-sensing": { module: "puls8 Agents", title: "Demand Sensing", subtitle: "Real-time POS divergence, Ramadan ramp, and short-horizon shortage detection" },
  // Administration — Documentation Management
  "/agentic-ai/admin/documentation": { module: "Administration", title: "Documentation Management", subtitle: "Author and upload help / user-guide content for every page" },
  // Customer module
  "/customer/highlights": { module: "Customer", title: "Solution Overview", subtitle: "Challenges and the layered Puls8 solution for each one" },
  "/customer/key-takeaways": { module: "Customer", title: "Key Takeaways", subtitle: "Customer-facing key take-aways — uploaded markdown rendered in-app" },
  "/customer/challenges": { module: "Customer", title: "Challenges", subtitle: "Critical operational challenges identified — verbatim customer voice" },
};

function resolveMeta(pathname: string): RouteMeta | null {
  if (ROUTE_META[pathname]) return ROUTE_META[pathname];
  // Param-route prefix matches
  if (pathname.startsWith("/sku/")) return { module: "Puls8 Supply Planning", title: "SKU Detail", subtitle: "Single SKU/location deep-dive with projection and policy snippets" };
  if (pathname.startsWith("/parameters/")) return { module: "Puls8 Supply Planning", title: "Parameter Detail", subtitle: "Per-SKU/location parameter tuning interface" };
  if (pathname.startsWith("/replenishment/")) return ROUTE_META["/replenishment"];
  return null;
}

const CHAT_CONSOLE_ROUTES = new Set<string>([
  "/agentic-ai/allocation-distribution",
  "/agentic-ai/demand-sensing",
]);

export default function RoutedPageShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const meta = resolveMeta(location.pathname);
  if (!meta) return <>{children}</>;
  const isChatConsole = CHAT_CONSOLE_ROUTES.has(location.pathname);
  return (
    <PageShell
      title={meta.title}
      subtitle={meta.subtitle}
      breadcrumbs={[{ label: meta.module }, { label: meta.title }]}
      bodyClassName={isChatConsole ? "pg-body--chat-console" : undefined}
      scrollClassName={isChatConsole ? "pg-scroll--chat-console" : undefined}
    >
      {children}
    </PageShell>
  );
}
