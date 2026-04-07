import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Box, Button, Stack, Typography } from "@mui/material";

import AppShellLayout from "./components/layout/AppShellLayout";
import AgentConfigurationPage from "./pages/AgentConfigurationPage";
import DashboardPage from "./pages/DashboardPage";
import DemandAnalysisPlaceholderPage from "./pages/DemandAnalysisPlaceholderPage";
import DemandForecastingPage from "./pages/DemandForecastingPage";
import DemandCollaborativePage from "./pages/DemandCollaborativePage";
import DemandAccuracyPage from "./pages/DemandAccuracyPage";
import DemandSopPage from "./pages/DemandSopPage";
import DemandSupplyIntegrationPage from "./pages/DemandSupplyIntegrationPage";
import DemandFinancialPage from "./pages/DemandFinancialPage";
import DemandTradePromotionPage from "./pages/DemandTradePromotionPage";
import DemandAnalyticsPage from "./pages/DemandAnalyticsPage";
import DemandCustomersPage from "./pages/DemandCustomersPage";
import ReplenishmentPage from "./pages/ReplenishmentPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import ScenarioPage from "./pages/ScenarioPage";
import NetworkPage from "./pages/NetworkPage";
import ParametersPage from "./pages/ParametersPage";
import ParameterDetailPage from "./pages/ParameterDetailPage";
import ChatPage from "./pages/ChatPage";
import SkuDetailPage from "./pages/SkuDetailPage";
import DocumentSearchPage from "./pages/DocumentSearchPage";
import MaintenancePage from "./pages/MaintenancePage";
import GlobalFilterCompliancePage from "./pages/GlobalFilterCompliancePage";
import "./styles.css";

const queryClient = new QueryClient();
const Router = typeof window !== "undefined" && window.location.protocol === "file:" ? HashRouter : BrowserRouter;

class RouteErrorBoundary extends Component<{ routeName: string; children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { routeName: string; children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    // Surface to console for diagnosis in dev/prod shells.
    // eslint-disable-next-line no-console
    console.error("Route render error:", error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <Box sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Typography variant="h6">{this.props.routeName} failed to load</Typography>
          <Typography variant="body2" color="text.secondary">
            {this.state.message || "Unknown runtime error"}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => {
              this.setState({ hasError: false, message: "" });
              window.location.reload();
            }}
          >
            Reload Page
          </Button>
        </Stack>
      </Box>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <Routes>
          <Route element={<AppShellLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/demand/forecast-alerts" element={<DemandAnalysisPlaceholderPage title="Forecast Alerts" />} />
            <Route path="/demand/forecast-modification" element={<DemandAnalysisPlaceholderPage title="Forecast Modification" />} />
            <Route path="/demand/forecasting" element={<DemandForecastingPage />} />
            <Route path="/demand/accuracy" element={<DemandAccuracyPage />} />
            <Route path="/demand/collaborative" element={<DemandCollaborativePage />} />
            <Route path="/demand/sop" element={<DemandSopPage />} />
            <Route path="/demand/supply-integration" element={<DemandSupplyIntegrationPage />} />
            <Route path="/demand/trade-promotion" element={<DemandTradePromotionPage />} />
            <Route path="/demand/financial" element={<DemandFinancialPage />} />
            <Route path="/demand/analytics" element={<DemandAnalyticsPage />} />
            <Route path="/demand/customers" element={<DemandCustomersPage />} />
            <Route path="/agentic-ai/agent-configuration" element={<AgentConfigurationPage />} />
            <Route
              path="/replenishment"
              element={
                <RouteErrorBoundary routeName="Replenishment">
                  <ReplenishmentPage />
                </RouteErrorBoundary>
              }
            />
            <Route
              path="/replenishment/*"
              element={
                <RouteErrorBoundary routeName="Replenishment">
                  <ReplenishmentPage />
                </RouteErrorBoundary>
              }
            />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="/sku/:sku/location/:location" element={<SkuDetailPage />} />
            <Route path="/scenarios" element={<ScenarioPage />} />
            <Route path="/network" element={<NetworkPage />} />
            <Route path="/parameters" element={<ParametersPage />} />
            <Route path="/parameters/:sku/:location" element={<ParameterDetailPage />} />
            <Route path="/documents" element={<DocumentSearchPage />} />
            <Route path="/maintenance" element={<MaintenancePage />} />
            <Route path="/agentic-ai/global-filter-compliance" element={<GlobalFilterCompliancePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Router>
    </QueryClientProvider>
  </StrictMode>,
);
