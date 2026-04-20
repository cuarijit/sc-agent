import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import LockResetOutlinedIcon from "@mui/icons-material/LockResetOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import { Alert, Avatar, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../features/auth/AuthContext";
import { resolveBrandingAssetUrl } from "../../services/brandingAdminApi";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

interface BrandingPayload {
  app_name?: string;
  company_logo?: string | null;
  customer_logo?: string | null;
  tenant_logo?: string | null;
}

function initials(name: string, username: string): string {
  const src = (name || username || "").trim();
  if (!src) return "?";
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export default function TopHeader({
  themeMode,
  onToggleThemeMode,
  onOpenSettings,
  onOpenInformation,
  onOpenHelp,
}: {
  themeMode: "light" | "dark";
  onToggleThemeMode: () => void;
  onOpenSettings: () => void;
  onOpenInformation: () => void;
  onOpenHelp?: () => void;
}) {
  const { user, logout, changePassword, state } = useAuth();
  const navigate = useNavigate();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [branding, setBranding] = useState<BrandingPayload>({});
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_BASE_URL}/api/branding`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d && !cancelled) setBranding(d); })
        .catch(() => {});
    };
    load();
    // Live refresh: BrandingPage dispatches this event after a successful save
    // so the header picks up new logos without requiring a hard refresh.
    const onChanged = () => load();
    window.addEventListener("branding:changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("branding:changed", onChanged);
    };
  }, []);
  const companyLogoUrl = resolveBrandingAssetUrl(branding.company_logo);
  const customerLogoUrl = resolveBrandingAssetUrl(branding.customer_logo);
  const tenantLogoUrl = resolveBrandingAssetUrl(branding.tenant_logo);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const userInitials = user ? initials(user.name, user.username) : "—";
  const userLabel = user?.name || user?.username || "Sign in";

  return (
    <Paper elevation={0} className="app-header-stack">
      <Stack direction="row" alignItems="center" justifyContent="space-between" className="app-brand-strip">
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0, overflow: "hidden" }}>
          <AppsOutlinedIcon sx={{ fontSize: 18, color: "rgba(217, 243, 255, 0.88)", flexShrink: 0 }} />
          {/* Company logo (LEFT): Demand Chain AI mark. Falls back to app-name text. */}
          {companyLogoUrl ? (
            <Box
              component="img"
              src={companyLogoUrl}
              alt={branding.app_name || "Company logo"}
              sx={{ height: 28, maxWidth: 200, objectFit: "contain", flexShrink: 0 }}
            />
          ) : (
            <Typography sx={{
              fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif',
              fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1,
              color: "#D9F3FF", whiteSpace: "nowrap",
            }}>
              {branding.app_name || "Supply Chain Planning"}
            </Typography>
          )}
          <Box className="brand-divider" sx={{ flexShrink: 0 }} />
          {/* Customer / module logo (LEFT, after divider): Puls8 module mark. */}
          {customerLogoUrl ? (
            <Box
              component="img"
              src={customerLogoUrl}
              alt="Module logo"
              sx={{ height: 26, maxWidth: 160, objectFit: "contain", flexShrink: 0 }}
            />
          ) : (
            <Stack spacing={0} sx={{ lineHeight: 1, flexShrink: 0 }}>
              <Typography sx={{ fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1, color: "#D9F3FF" }}>
                DCAI
              </Typography>
              <Typography className="brand-product-label">Intelligent Planning</Typography>
            </Stack>
          )}
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.6}>
          {/* Tenant / customer-account logo (RIGHT): each customer can upload
              their own brand mark via Branding & Logos. */}
          {tenantLogoUrl ? (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                pr: 1,
                mr: 0.5,
                borderRight: "1px solid rgba(217,243,255,0.18)",
              }}
            >
              <Box
                component="img"
                src={tenantLogoUrl}
                alt="Customer logo"
                sx={{ height: 26, maxWidth: 160, objectFit: "contain", display: "block" }}
              />
            </Box>
          ) : null}
          <Typography variant="caption" sx={{ color: "rgba(217, 243, 255, 0.45)", fontSize: 9, fontFamily: '"Montserrat", sans-serif', fontWeight: 500 }}>
            v1.0.0
          </Typography>
          <Tooltip title="Agent information desk">
            <IconButton size="small" onClick={onOpenInformation} aria-label="Open agent information desk" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
              <SupportAgentOutlinedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          {onOpenHelp ? (
            <Tooltip title="Page help">
              <IconButton size="small" onClick={onOpenHelp} aria-label="Open page help" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
                <HelpOutlineOutlinedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          ) : null}
          <IconButton size="small" onClick={onOpenSettings} aria-label="Settings" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
            <SettingsOutlinedIcon sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton size="small" onClick={onToggleThemeMode} aria-label="Toggle day or dark mode" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
            {themeMode === "light" ? <DarkModeOutlinedIcon sx={{ fontSize: 14 }} /> : <LightModeOutlinedIcon sx={{ fontSize: 14 }} />}
          </IconButton>
          <Tooltip title={user ? `${user.username} (${user.roles.join(", ")})` : "Sign in"}>
            <Box
              onClick={(e) => state === "authenticated" ? setMenuAnchor(e.currentTarget) : navigate("/login")}
              sx={{ display: "flex", alignItems: "center", gap: 0.6, cursor: "pointer" }}
            >
              <Typography variant="caption" sx={{ color: "rgba(217, 243, 255, 0.80)", fontFamily: '"Montserrat", sans-serif', fontWeight: 500, fontSize: 10 }}>
                {userLabel}
              </Typography>
              <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: "#3D9FD4", color: "#fff", fontWeight: 700, fontFamily: '"Montserrat", sans-serif' }}>
                {userInitials}
              </Avatar>
            </Box>
          </Tooltip>
          <Menu
            anchorEl={menuAnchor}
            open={Boolean(menuAnchor)}
            onClose={() => setMenuAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            <MenuItem onClick={() => { setMenuAnchor(null); setPwOpen(true); setPwError(null); setPwSuccess(null); setPwCurrent(""); setPwNew(""); setPwConfirm(""); }}>
              <LockResetOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Change Password
            </MenuItem>
            <MenuItem onClick={async () => { setMenuAnchor(null); await logout(); navigate("/login"); }}>
              <LogoutOutlinedIcon fontSize="small" sx={{ mr: 1 }} /> Logout
            </MenuItem>
          </Menu>
        </Stack>
      </Stack>

      <Dialog open={pwOpen} onClose={() => setPwOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Change Password</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            {pwError ? <Alert severity="error">{pwError}</Alert> : null}
            {pwSuccess ? <Alert severity="success">{pwSuccess}</Alert> : null}
            <TextField label="Current Password" type="password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} fullWidth />
            <TextField label="New Password" type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} fullWidth />
            <TextField label="Confirm New Password" type="password" value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwOpen(false)}>Close</Button>
          <Button variant="contained" onClick={async () => {
            setPwError(null); setPwSuccess(null);
            if (pwNew.length < 6) { setPwError("New password must be at least 6 characters."); return; }
            if (pwNew !== pwConfirm) { setPwError("Passwords do not match."); return; }
            try {
              await changePassword(pwCurrent, pwNew);
              setPwSuccess("Password changed.");
              setPwCurrent(""); setPwNew(""); setPwConfirm("");
            } catch (e) {
              setPwError((e as Error).message);
            }
          }}>Change</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
