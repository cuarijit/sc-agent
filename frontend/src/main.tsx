import { Component, StrictMode, useEffect, useMemo, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Box, Button, Stack, Typography } from "@mui/material";

import AppShellLayout from "./components/layout/AppShellLayout";
import { AuthProvider } from "./features/auth/AuthContext";
import { RequireAuth, RequireRole } from "./features/auth/RequireAuth";
import LoginPage from "./features/auth/LoginPage";
import UserAdminPage from "./features/adminUsers/UserAdminPage";
import ModuleConfigPage from "./features/moduleConfig/ModuleConfigPage";
import BrandingPage from "./features/branding/BrandingPage";
import DocumentationAdminPage from "./features/documentation/pages/DocumentationAdminPage";
import HighlightsPage from "./features/customer/pages/HighlightsPage";
import KeyTakeawaysPage from "./features/customer/pages/KeyTakeawaysPage";
import ChallengesPage from "./features/customer/pages/ChallengesPage";
import AgentConfigurationPage from "./pages/AgentConfigurationPage";
import InventoryDiagnosticConsoleRoute from "./pages/InventoryDiagnosticConsoleRoute";
import AllocationConsolePage from "./pages/AllocationConsolePage";
import DemandSensingConsolePage from "./pages/DemandSensingConsolePage";
import DashboardPage from "./pages/DashboardPage";
import DemandAnalysisPlaceholderPage from "./pages/DemandAnalysisPlaceholderPage";
import DbfAnalyticsPage from "./pages/DbfAnalyticsPage";
import DbfWorkbenchPage from "./pages/DbfWorkbenchPage";
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
import RoutedPageShell from "./app/RoutedPageShell";
import "./styles.css";

type ThemeMode = "light" | "dark";

const THEME_MODE_STORAGE_KEY = "scp_ui_theme_mode";

function loadThemeMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    if (saved === "light" || saved === "dark") {
      return saved;
    }
  } catch {
    // Ignore storage read issues and use default.
  }
  return "light";
}

function buildTheme(mode: ThemeMode) {
  const isLight = mode === "light";
  return createTheme({
    palette: {
      mode,
      primary: {
        main: isLight ? "#3C95D1" : "#4DA8D8",
        light: isLight ? "#5BB5E0" : "#6CBAE2",
        dark: isLight ? "#2B7FAA" : "#3590B8",
        contrastText: isLight ? "#ffffff" : "#111318",
      },
      secondary: {
        main: isLight ? "#3D9FD4" : "#5DB3DD",
        light: isLight ? "#7AC6E9" : "#7DC4E6",
        dark: "#2B7FAA",
        contrastText: isLight ? "#ffffff" : "#111318",
      },
      background: {
        default: isLight ? "#ffffff" : "#111318",
        paper: isLight ? "#ffffff" : "#181c24",
      },
      text: {
        primary: isLight ? "#0A2248" : "#CDD5DF",
        secondary: isLight ? "#4a6680" : "#7D8A9B",
      },
      info: { main: isLight ? "#3C95D1" : "#4DA8D8" },
      success: { main: isLight ? "#059669" : "#34D399" },
      warning: { main: isLight ? "#d97706" : "#FBBF24" },
      error: { main: isLight ? "#dc2626" : "#F87171" },
      divider: isLight ? "#cdd8e4" : "#2a3040",
    },
    shape: { borderRadius: 4 },
    typography: {
      fontSize: 11,
      fontFamily: '"IBM Plex Sans", "Nunito Sans", "Segoe UI", sans-serif',
      h5: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, letterSpacing: "-0.01em" },
      h6: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, letterSpacing: "-0.01em" },
      subtitle1: { fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontWeight: 700, fontSize: "14px", lineHeight: "20px" },
      subtitle2: { fontSize: "11px", lineHeight: "16px" },
      body1: { fontSize: "11px", lineHeight: "16px" },
      body2: { fontSize: "11px", lineHeight: "16px" },
      button: { textTransform: "none", fontWeight: 500 },
      caption: { fontSize: "11px", lineHeight: "16px" },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            borderColor: isLight ? "#cdd8e4" : "#2a3040",
          },
        },
      },
      MuiCard: { styleOverrides: { root: { fontSize: 14 } } },
      MuiCardContent: {
        styleOverrides: {
          root: { fontSize: 14, "& .MuiTypography-root": { fontSize: 14 } },
        },
      },
      MuiButton: {
        defaultProps: { size: "small", disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 4, minHeight: 28, padding: "4px 10px", fontSize: 11, lineHeight: 1.2, gap: 6 },
          outlined: {
            borderColor: isLight ? "#3D9FD4" : "#4DA8D8",
            color: isLight ? "#0A2248" : "#94A3B8",
          },
          contained: {
            boxShadow: "none",
            color: "#ffffff",
            background: "#3C95D1",
            "&:hover": { background: "#348ABF" },
            "&.Mui-disabled": {
              background: isLight ? "#a8c8e0" : "rgba(61, 159, 212, 0.3)",
              color: isLight ? "rgba(255, 255, 255, 0.75)" : "rgba(255, 255, 255, 0.5)",
            },
          },
        },
      },
      MuiIconButton: {
        defaultProps: { size: "small" },
        styleOverrides: { root: { width: 28, height: 28, borderRadius: 6 } },
      },
      MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { minHeight: 32, borderRadius: 4, fontSize: 11 },
          input: { padding: "7px 10px" },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { fontSize: 11 } } },
      MuiFormLabel: { styleOverrides: { root: { fontSize: 11 } } },
      MuiSelect: { defaultProps: { size: "small" } },
      MuiMenuItem: { styleOverrides: { root: { minHeight: 30, fontSize: 11 } } },
      MuiAutocomplete: { defaultProps: { size: "small" } },
      MuiSwitch: {
        defaultProps: { size: "small" },
        styleOverrides: {
          root: { padding: 6 },
          switchBase: {
            "&.Mui-checked": { color: isLight ? "#3C95D1" : "#4DA8D8" },
            "&.Mui-checked + .MuiSwitch-track": { backgroundColor: isLight ? "#3C95D1" : "#4DA8D8" },
          },
        },
      },
      MuiChip: {
        defaultProps: { size: "small" },
        styleOverrides: { root: { height: 22, fontSize: 11 } },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 30 },
          indicator: { height: 2, background: "linear-gradient(90deg, #0A2248 0%, #3D9FD4 100%)" },
        },
      },
      MuiTab: {
        defaultProps: { disableRipple: true },
        styleOverrides: {
          root: {
            minHeight: 30,
            padding: "5px 10px",
            fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
            fontSize: 12,
            fontWeight: 600,
            "&.Mui-selected": { color: isLight ? "#0A2248" : "#A8C4D8" },
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: "10px 14px",
            fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: isLight ? "#0A2248" : "#CDD5DF",
          },
        },
      },
      MuiDialogContent: { styleOverrides: { root: { padding: "10px 14px", fontSize: 11 } } },
      MuiDialogActions: { styleOverrides: { root: { padding: "8px 12px", gap: 6, fontSize: 11 } } },
      MuiTableCell: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${isLight ? "rgba(38,121,168,0.10)" : "rgba(42,48,64,0.6)"}`,
            fontSize: "11px",
          },
          head: {
            fontWeight: 600,
            color: isLight ? "#0A2248" : "#94A3B8",
            backgroundColor: isLight ? "#f8fcff" : "rgba(30,40,54,0.8)",
          },
        },
      },
      MuiDataGrid: {
        styleOverrides: {
          root: { borderRadius: 4 },
          columnHeaders: { minHeight: "36px !important" },
          columnHeader: { minHeight: "36px !important" },
          row: { maxHeight: "30px !important" },
        },
      },
    },
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Don't retry on auth failures — let AuthProvider redirect.
      // Otherwise retry once. Without this, a failing fetch loops forever
      // (the "loading forever" symptom).
      retry: (failureCount, error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("401") || msg.includes("403")) return false;
        return failureCount < 1;
      },
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});
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

function RootApp() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => {
    try {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage write issues and keep app usable.
    }
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  const theme = useMemo(() => buildTheme(themeMode), [themeMode]);
  const onToggleThemeMode = () => setThemeMode((prev) => (prev === "light" ? "dark" : "light"));

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <Router>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={
                <RequireAuth>
                  <AppShellLayout themeMode={themeMode} onToggleThemeMode={onToggleThemeMode} />
                </RequireAuth>
              }>
              <Route path="/" element={<RoutedPageShell><DashboardPage /></RoutedPageShell>} />
              <Route path="/demand/forecast-alerts" element={<RoutedPageShell><DemandAnalysisPlaceholderPage title="Forecast Alerts" /></RoutedPageShell>} />
              <Route path="/demand/forecast-modification" element={<RoutedPageShell><DemandAnalysisPlaceholderPage title="Forecast Modification" /></RoutedPageShell>} />
              <Route path="/demand/forecasting" element={<RoutedPageShell><DemandForecastingPage /></RoutedPageShell>} />
              <Route path="/demand/accuracy" element={<RoutedPageShell><DemandAccuracyPage /></RoutedPageShell>} />
              <Route path="/demand/collaborative" element={<RoutedPageShell><DemandCollaborativePage /></RoutedPageShell>} />
              <Route path="/demand/sop" element={<RoutedPageShell><DemandSopPage /></RoutedPageShell>} />
              <Route path="/demand/supply-integration" element={<RoutedPageShell><DemandSupplyIntegrationPage /></RoutedPageShell>} />
              <Route path="/demand/trade-promotion" element={<RoutedPageShell><DemandTradePromotionPage /></RoutedPageShell>} />
              <Route path="/demand/financial" element={<RoutedPageShell><DemandFinancialPage /></RoutedPageShell>} />
              <Route path="/demand/analytics" element={<RoutedPageShell><DemandAnalyticsPage /></RoutedPageShell>} />
              <Route path="/demand/customers" element={<RoutedPageShell><DemandCustomersPage /></RoutedPageShell>} />
              <Route path="/dbf/workbench" element={<RoutedPageShell><DbfWorkbenchPage /></RoutedPageShell>} />
              <Route path="/dbf/analytics" element={<RoutedPageShell><DbfAnalyticsPage /></RoutedPageShell>} />
              <Route path="/agentic-ai/agent-configuration" element={<AgentConfigurationPage />} />
              <Route
                path="/agentic-ai/inventory-diagnostic"
                element={
                  <RouteErrorBoundary routeName="Inventory Diagnostic Console">
                    <InventoryDiagnosticConsoleRoute />
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/agentic-ai/allocation-distribution"
                element={
                  <RouteErrorBoundary routeName="Allocation & Distribution Console">
                    <RoutedPageShell>
                      <AllocationConsolePage />
                    </RoutedPageShell>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/agentic-ai/demand-sensing"
                element={
                  <RouteErrorBoundary routeName="Demand Sensing Console">
                    <RoutedPageShell>
                      <DemandSensingConsolePage />
                    </RoutedPageShell>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/replenishment"
                element={
                  <RouteErrorBoundary routeName="Replenishment">
                    <RoutedPageShell><ReplenishmentPage /></RoutedPageShell>
                  </RouteErrorBoundary>
                }
              />
              <Route
                path="/replenishment/*"
                element={
                  <RouteErrorBoundary routeName="Replenishment">
                    <RoutedPageShell><ReplenishmentPage /></RoutedPageShell>
                  </RouteErrorBoundary>
                }
              />
              <Route path="/recommendations" element={<RoutedPageShell><RecommendationsPage /></RoutedPageShell>} />
              <Route path="/sku/:sku/location/:location" element={<RoutedPageShell><SkuDetailPage /></RoutedPageShell>} />
              <Route path="/scenarios" element={<RoutedPageShell><ScenarioPage /></RoutedPageShell>} />
              <Route path="/network" element={<RoutedPageShell><NetworkPage /></RoutedPageShell>} />
              <Route path="/parameters" element={<RoutedPageShell><ParametersPage /></RoutedPageShell>} />
              <Route path="/parameters/:sku/:location" element={<RoutedPageShell><ParameterDetailPage /></RoutedPageShell>} />
              <Route path="/documents" element={<RoutedPageShell><DocumentSearchPage /></RoutedPageShell>} />
              <Route path="/maintenance" element={<RoutedPageShell><MaintenancePage /></RoutedPageShell>} />
              <Route path="/agentic-ai/global-filter-compliance" element={<RoutedPageShell><GlobalFilterCompliancePage /></RoutedPageShell>} />
              <Route path="/agentic-ai/admin/users" element={
                <RequireRole allowedRoles={["admin"]} requiredEntitlements={["page.admin_users"]}>
                  <UserAdminPage />
                </RequireRole>
              } />
              <Route path="/agentic-ai/admin/modules" element={
                <RequireRole allowedRoles={["admin"]} requiredEntitlements={["page.admin_modules"]}>
                  <ModuleConfigPage />
                </RequireRole>
              } />
              <Route path="/agentic-ai/admin/branding" element={
                <RequireRole allowedRoles={["admin"]} requiredEntitlements={["page.admin_branding"]}>
                  <BrandingPage />
                </RequireRole>
              } />
              <Route path="/agentic-ai/admin/documentation" element={
                <RequireRole allowedRoles={["admin"]}>
                  <DocumentationAdminPage />
                </RequireRole>
              } />
              <Route path="/customer/highlights" element={<RoutedPageShell><HighlightsPage /></RoutedPageShell>} />
              <Route path="/customer/key-takeaways" element={<RoutedPageShell><KeyTakeawaysPage /></RoutedPageShell>} />
              <Route path="/customer/challenges" element={<RoutedPageShell><ChallengesPage /></RoutedPageShell>} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </AuthProvider>
        </Router>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootApp />
  </StrictMode>,
);
