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
  // Demand Planning module
  demandForecasting: "/demand/forecasting",
  demandCollaborative: "/demand/collaborative",
  demandAccuracy: "/demand/accuracy",
  demandSop: "/demand/sop",
  demandSupplyIntegration: "/demand/supply-integration",
  demandFinancial: "/demand/financial",
  demandTradePromotion: "/demand/trade-promotion",
  demandAnalytics: "/demand/analytics",
  demandCustomers: "/demand/customers",
  // Legacy placeholders
  demandForecastAlerts: "/demand/forecast-alerts",
  demandForecastModification: "/demand/forecast-modification",
  // Agentic AI module
  agentConfiguration: "/agentic-ai/agent-configuration",
  globalFilterCompliance: "/agentic-ai/global-filter-compliance",
} as const;
