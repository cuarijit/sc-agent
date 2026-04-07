import AppsOutlinedIcon from "@mui/icons-material/AppsOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import { Avatar, Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";

export default function TopHeader({
  themeMode,
  onToggleThemeMode,
  onOpenSettings,
  onOpenInformation,
}: {
  themeMode: "light" | "dark";
  onToggleThemeMode: () => void;
  onOpenSettings: () => void;
  onOpenInformation: () => void;
}) {
  return (
    <Paper elevation={0} className="app-header-stack">
      <Stack direction="row" alignItems="center" justifyContent="space-between" className="app-brand-strip">
        <Stack direction="row" alignItems="center" spacing={1}>
          <AppsOutlinedIcon sx={{ fontSize: 16, color: "rgba(217, 243, 255, 0.88)" }} />
          <Typography sx={{ fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", lineHeight: 1, color: "#D9F3FF" }}>
            Supply Chain Planning and Execution
          </Typography>
          <Box className="brand-divider" />
          <Stack spacing={0} sx={{ lineHeight: 1 }}>
            <Typography sx={{ fontFamily: '"Montserrat", "IBM Plex Sans", sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: "0.01em", lineHeight: 1, color: "#D9F3FF" }}>
              DCAI
            </Typography>
            <Typography className="brand-product-label">Intelligent Planning</Typography>
          </Stack>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={0.6}>
          <Typography variant="caption" sx={{ color: "rgba(217, 243, 255, 0.45)", fontSize: 9, fontFamily: '"Montserrat", sans-serif', fontWeight: 500 }}>
            v0.1.0
          </Typography>
          <Tooltip title="Agent information desk">
            <IconButton size="small" onClick={onOpenInformation} aria-label="Open agent information desk" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
              <SupportAgentOutlinedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onOpenSettings} aria-label="Settings" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
            <SettingsOutlinedIcon sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton size="small" onClick={onToggleThemeMode} aria-label="Toggle day or dark mode" sx={{ color: "rgba(217,243,255,0.75)", width: 22, height: 22 }}>
            {themeMode === "light" ? <DarkModeOutlinedIcon sx={{ fontSize: 14 }} /> : <LightModeOutlinedIcon sx={{ fontSize: 14 }} />}
          </IconButton>
          <Typography variant="caption" sx={{ color: "rgba(217, 243, 255, 0.80)", fontFamily: '"Montserrat", sans-serif', fontWeight: 500, fontSize: 10 }}>
            My Account
          </Typography>
          <Avatar sx={{ width: 22, height: 22, fontSize: 9, bgcolor: "#2679A8", color: "#D9F3FF", fontWeight: 700, fontFamily: '"Montserrat", sans-serif' }}>
            AC
          </Avatar>
        </Stack>
      </Stack>
    </Paper>
  );
}
