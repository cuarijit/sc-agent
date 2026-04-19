import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Box, CircularProgress, Drawer, IconButton, Stack, Typography } from "@mui/material";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import ReactMarkdown from "react-markdown";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

const ROUTE_HELP_MAP: Record<string, string> = {
  "/": "page__dashboard",
  "/replenishment": "page__replenishment",
  "/recommendations": "page__recommendations",
  "/scenarios": "page__scenarios",
  "/network": "page__network",
  "/parameters": "page__parameters",
  "/maintenance": "page__maintenance",
  "/documents": "page__documents",
  "/chat": "page__chat",
  "/demand/forecasting": "page__demand_forecasting",
  "/demand/collaborative": "page__demand_collaborative",
  "/demand/accuracy": "page__demand_accuracy",
  "/demand/sop": "page__demand_sop",
  "/demand/supply-integration": "page__demand_supply_integration",
  "/demand/financial": "page__demand_financial",
  "/demand/trade-promotion": "page__demand_trade_promotion",
  "/demand/analytics": "page__demand_analytics",
  "/demand/customers": "page__demand_customers",
  "/agentic-ai/agent-configuration": "page__agent_configuration",
  "/agentic-ai/inventory-diagnostic": "page__inventory_diagnostic",
  "/agentic-ai/global-filter-compliance": "page__global_filter_compliance",
  "/agentic-ai/admin/users": "page__admin_users",
};

function slugForPath(pathname: string): string {
  if (ROUTE_HELP_MAP[pathname]) return ROUTE_HELP_MAP[pathname];
  // Param-route mappings: pages that take URL params
  if (pathname.startsWith("/sku/")) return "page__dashboard";  // SKU detail rolls up under dashboard help
  if (pathname.startsWith("/parameters/")) return "page__parameters";  // Parameter detail under parameters
  // Fallback: longest prefix match
  let best = "";
  let bestSlug = "page__dashboard";
  for (const route of Object.keys(ROUTE_HELP_MAP)) {
    if (route !== "/" && pathname.startsWith(route) && route.length > best.length) {
      best = route;
      bestSlug = ROUTE_HELP_MAP[route];
    }
  }
  return bestSlug;
}

interface PageHelpDrawerProps {
  open: boolean;
  onClose: () => void;
  slugOverride?: string | null;
}

export default function PageHelpDrawer({ open, onClose, slugOverride }: PageHelpDrawerProps) {
  const location = useLocation();
  const slug = slugOverride || slugForPath(location.pathname);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE_URL}/api/help/${slug}`, { credentials: "include" })
      .then(async (res) => {
        if (res.status === 404) {
          setContent("");
          setError(`No help content available for this page (slug: ${slug}).`);
          return;
        }
        if (!res.ok) {
          throw new Error(`Failed to load help (HTTP ${res.status}).`);
        }
        const data = await res.json() as { content: string };
        setContent(data.content);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, slug]);

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: "92vw", sm: 420 } } }}>
      <Stack sx={{ height: "100%" }}>
        <Stack direction="row" alignItems="center" sx={{ p: 1, borderBottom: "1px solid var(--divider, #cdd8e4)" }}>
          <Typography sx={{
            fontFamily: '"Montserrat", sans-serif', fontWeight: 700, fontSize: 13,
            color: "var(--text-primary)", flex: 1,
          }}>
            Help
          </Typography>
          <IconButton size="small" onClick={onClose} aria-label="Close help drawer">
            <CloseOutlinedIcon fontSize="small" />
          </IconButton>
        </Stack>
        <Box sx={{ p: 2, overflowY: "auto", flex: 1 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
              <CircularProgress size={24} />
            </Box>
          ) : error ? (
            <Typography sx={{ fontSize: 12, color: "var(--text-subtle)" }}>{error}</Typography>
          ) : (
            <Box className="help-markdown" sx={{
              fontSize: 12, lineHeight: 1.6,
              "& h1": { fontFamily: '"Montserrat", sans-serif', fontSize: 18, fontWeight: 700, color: "var(--text-primary)", mb: 1 },
              "& h2": { fontFamily: '"Montserrat", sans-serif', fontSize: 15, fontWeight: 700, color: "var(--text-primary)", mt: 2, mb: 1 },
              "& h3": { fontFamily: '"Montserrat", sans-serif', fontSize: 13, fontWeight: 700, color: "var(--text-primary)", mt: 1.5, mb: 0.5 },
              "& p": { mb: 1 },
              "& code": { fontFamily: "monospace", background: "rgba(38,121,168,0.10)", padding: "2px 4px", borderRadius: 3, fontSize: 11 },
              "& ul, & ol": { pl: 2.5, mb: 1 },
              "& a": { color: "var(--accent)", textDecoration: "none" },
              "& a:hover": { textDecoration: "underline" },
            }}>
              <ReactMarkdown>{content}</ReactMarkdown>
            </Box>
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}
