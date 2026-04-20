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
  // Puls8 DBF module
  dbfWorkbench: "/dbf/workbench",
  dbfAnalytics: "/dbf/analytics",
  // Agentic AI module
  agentConfiguration: "/agentic-ai/agent-configuration",
  inventoryDiagnosticConsole: "/agentic-ai/inventory-diagnostic",
  allocationConsole: "/agentic-ai/allocation-distribution",
  demandSensingConsole: "/agentic-ai/demand-sensing",
  globalFilterCompliance: "/agentic-ai/global-filter-compliance",
  // Administration
  adminUsers: "/agentic-ai/admin/users",
  adminModules: "/agentic-ai/admin/modules",
  adminBranding: "/agentic-ai/admin/branding",
  adminDocumentation: "/agentic-ai/admin/documentation",
  // Customer module
  customerHighlights: "/customer/highlights",
  customerKeyTakeaways: "/customer/key-takeaways",
  customerChallenges: "/customer/challenges",
  // Auth
  login: "/login",
} as const;
