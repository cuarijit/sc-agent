import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Box, CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import LeftNav from "./LeftNav";
import TopHeader from "./TopHeader";
import GlobalFilterBar from "./GlobalFilterBar";
import ConfigDialog from "./ConfigDialog";
import { fetchLlmOptions } from "../../services/api";
import type { LlmOptionsResponse, UiConfig } from "../../types";
import type { GlobalFilters } from "../../types/filters";

export interface ShellContextValue {
  filters: GlobalFilters;
  setFilters: Dispatch<SetStateAction<GlobalFilters>>;
  config: UiConfig;
  setConfig: Dispatch<SetStateAction<UiConfig>>;
  openAiApiKey: string;
  setOpenAiApiKey: Dispatch<SetStateAction<string>>;
}

export const defaultFilters: GlobalFilters = {
  runId: "RUN-BASELINE-001",
  region: "",
  location: [],
  sku: [],
  category: "",
  supplier: "",
  exceptionStatus: "",
  recommendationId: [],
  alertId: [],
  alertType: [],
  severity: [],
  orderId: [],
  orderType: [],
  orderStatus: [],
  exceptionReason: [],
  shipFromNodeId: [],
  shipToNodeId: [],
  parameterCode: [],
  parameterIssueType: [],
  sourceMode: [],
  nodeType: [],
};

export default function AppShellLayout() {
  const location = useLocation();
  const [themeMode, setThemeMode] = useState<"light" | "dark">("light");
  const [filters, setFilters] = useState<GlobalFilters>(defaultFilters);
  const [collapsed, setCollapsed] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const [llmApiKeys, setLlmApiKeys] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<UiConfig>(() => {
    const raw = localStorage.getItem("meio_ui_config");
    return raw ? JSON.parse(raw) as UiConfig : { llmProvider: "openai", llmModel: "gpt-4.1-mini" };
  });
  const openAiApiKey = llmApiKeys[config.llmProvider] ?? "";
  const setOpenAiApiKey: Dispatch<SetStateAction<string>> = (value) => {
    setLlmApiKeys((prev) => {
      const current = prev[config.llmProvider] ?? "";
      const nextValue = typeof value === "function" ? value(current) : value;
      return { ...prev, [config.llmProvider]: nextValue };
    });
  };
  const { data: llmOptions } = useQuery<LlmOptionsResponse>({ queryKey: ["llm-options"], queryFn: fetchLlmOptions });
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: themeMode,
          primary: { main: "#0073e6" },
          secondary: { main: "#0b63ce" },
          background: { default: themeMode === "dark" ? "#0e121a" : "#f4f6f9", paper: themeMode === "dark" ? "#121826" : "#ffffff" },
          text: { primary: themeMode === "dark" ? "#e7ebf3" : "#1d1e23", secondary: themeMode === "dark" ? "#acb4c3" : "#545963" },
        },
        shape: { borderRadius: 4 },
        typography: {
          fontSize: 11,
          fontFamily: '"IBM Plex Sans", "Nunito Sans", "Segoe UI", sans-serif',
          h6: { fontWeight: 600, letterSpacing: 0 },
          subtitle1: { fontWeight: 700, fontSize: "18px", lineHeight: "24px" },
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
                borderColor: themeMode === "dark" ? "#2a3346" : "#d8dcde",
              },
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                fontSize: 14,
              },
            },
          },
          MuiCardContent: {
            styleOverrides: {
              root: {
                fontSize: 14,
                "& .MuiTypography-root": {
                  fontSize: 14,
                },
              },
            },
          },
          MuiButton: {
            defaultProps: {
              size: "small",
              disableElevation: true,
            },
            styleOverrides: {
              root: {
                borderRadius: 4,
                minHeight: 28,
                padding: "4px 10px",
                fontSize: 11,
                lineHeight: 1.2,
                gap: 6,
              },
              outlined: {
                borderColor: themeMode === "dark" ? "#4ea4ff" : "#0073e6",
                color: themeMode === "dark" ? "#7dbdff" : "#0073e6",
              },
              contained: {
                boxShadow: "none",
              },
            },
          },
          MuiIconButton: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                width: 28,
                height: 28,
                borderRadius: 6,
              },
            },
          },
          MuiTextField: {
            defaultProps: {
              size: "small",
              variant: "outlined",
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                minHeight: 32,
                borderRadius: 4,
                fontSize: 11,
              },
              input: {
                padding: "7px 10px",
              },
            },
          },
          MuiInputLabel: {
            styleOverrides: {
              root: {
                fontSize: 11,
              },
            },
          },
          MuiFormLabel: {
            styleOverrides: {
              root: {
                fontSize: 11,
              },
            },
          },
          MuiSelect: {
            defaultProps: {
              size: "small",
            },
          },
          MuiMenuItem: {
            styleOverrides: {
              root: {
                minHeight: 30,
                fontSize: 11,
              },
            },
          },
          MuiAutocomplete: {
            defaultProps: {
              size: "small",
            },
          },
          MuiSwitch: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                padding: 6,
              },
            },
          },
          MuiChip: {
            defaultProps: {
              size: "small",
            },
            styleOverrides: {
              root: {
                height: 22,
                fontSize: 11,
              },
            },
          },
          MuiTabs: {
            styleOverrides: {
              root: {
                minHeight: 30,
              },
              indicator: {
                height: 2,
              },
            },
          },
          MuiTab: {
            defaultProps: {
              disableRipple: true,
            },
            styleOverrides: {
              root: {
                minHeight: 30,
                padding: "5px 10px",
                fontSize: 17,
              },
            },
          },
          MuiDialogTitle: {
            styleOverrides: {
              root: {
                padding: "10px 14px",
                fontSize: 16,
                fontWeight: 600,
              },
            },
          },
          MuiDialogContent: {
            styleOverrides: {
              root: {
                padding: "10px 14px",
                fontSize: 11,
              },
            },
          },
          MuiDialogActions: {
            styleOverrides: {
              root: {
                padding: "8px 12px",
                gap: 6,
                fontSize: 11,
              },
            },
          },
          MuiTableCell: {
            styleOverrides: {
              root: {
                borderBottom: `1px solid ${themeMode === "dark" ? "#2a3346" : "#e6e9ef"}`,
                fontSize: "11px",
              },
              head: {
                fontWeight: 600,
                color: themeMode === "dark" ? "#b8c2d5" : "#545963",
                backgroundColor: themeMode === "dark" ? "#162033" : "#fafbfd",
              },
            },
          },
        },
      }),
    [themeMode],
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("meio_ui_config", JSON.stringify(config));
  }, [config]);

  const showGlobalFilterBar = true;

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box className="app-shell">
        <Box className="ambient-shape ambient-shape-a" />
        <Box className="ambient-shape ambient-shape-b" />
        <TopHeader
          themeMode={themeMode}
          collapsed={collapsed}
          onToggleThemeMode={() => setThemeMode((prev) => (prev === "light" ? "dark" : "light"))}
          onOpenSettings={() => setConfigOpen(true)}
        />
        {/* Spacer so content starts below the fixed black brand strip */}
        <Box aria-hidden sx={{ flexShrink: 0, height: { xs: 45, md: 50 }, minHeight: { xs: 45, md: 50 } }} />
        <Box className="app-layout">
          <Box className="side-nav-shell" sx={{ width: collapsed ? 58 : 228, minWidth: collapsed ? 58 : 228 }}>
            <LeftNav collapsed={collapsed} onToggleCollapsed={() => setCollapsed((prev) => !prev)} />
          </Box>
          <Box className="main-pane">
            <Box aria-hidden sx={{ flexShrink: 0, height: { xs: 50, md: 57 }, minHeight: { xs: 50, md: 57 } }} />
            {showGlobalFilterBar ? <GlobalFilterBar filters={filters} setFilters={setFilters} config={config} openAiApiKey={openAiApiKey} /> : null}
            <Box className="main-content-wrap" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <Outlet context={{ filters, setFilters, config, setConfig, openAiApiKey, setOpenAiApiKey } satisfies ShellContextValue} />
            </Box>
          </Box>
        </Box>
        <ConfigDialog
          open={configOpen}
          config={config}
          llmOptions={llmOptions ?? null}
          llmApiKeys={llmApiKeys}
          onLlmApiKeyChange={(provider, value) => {
            setLlmApiKeys((prev) => ({ ...prev, [provider]: value }));
          }}
          onClose={() => setConfigOpen(false)}
          onSave={setConfig}
        />
      </Box>
    </ThemeProvider>
  );
}
