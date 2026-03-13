export const ROUTE_PATHS = {
  dashboard: "/",
  replenishment: "/replenishment",
  recommendations: "/recommendations",
  skuDetail: "/sku/:sku/location/:location",
  scenarios: "/scenarios",
  network: "/network",
  parameters: "/parameters",
  parameterDetail: "/parameters/:sku/:location",
  maintenance: "/maintenance",
  documents: "/documents",
  chat: "/chat",
  // Demand Analysis module
  demandForecastAlerts: "/demand/forecast-alerts",
  demandForecastModification: "/demand/forecast-modification",
  // Agentic AI module
  agentConfiguration: "/agentic-ai/agent-configuration",
  globalFilterCompliance: "/agentic-ai/global-filter-compliance",
} as const;
