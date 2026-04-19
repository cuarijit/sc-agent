import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import { useAuth } from "./AuthContext";

export default function LoginPage() {
  const { state, login, error, setError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // If already authenticated, bounce to original or root
  if (state === "authenticated") {
    const from = (location.state as { from?: string } | null)?.from;
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || "/", { replace: true });
    } catch {
      // error already set by AuthContext
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box className="login-page" sx={{
      display: "flex", minHeight: "100vh",
      background: "var(--shell-bg, #ffffff)",
    }}>
      {/* Brand panel (left, 42%) */}
      <Box sx={{
        width: { xs: 0, md: "42%" },
        display: { xs: "none", md: "flex" },
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "linear-gradient(135deg, #061830 0%, #0E2D5A 100%)",
        color: "#fff",
        position: "relative", overflow: "hidden",
      }}>
        <Box sx={{
          position: "absolute", top: "10%", left: "20%", width: 280, height: 280,
          background: "rgba(61, 159, 212, 0.15)", filter: "blur(90px)", borderRadius: "50%",
        }} />
        <Box sx={{
          position: "absolute", bottom: "15%", right: "10%", width: 220, height: 220,
          background: "rgba(61, 159, 212, 0.10)", filter: "blur(90px)", borderRadius: "50%",
        }} />
        <Stack spacing={2} alignItems="center" sx={{ position: "relative", zIndex: 1, p: 4, textAlign: "center" }}>
          <Typography sx={{
            fontFamily: '"Montserrat", sans-serif', fontWeight: 700,
            fontSize: 32, letterSpacing: "-0.02em",
          }}>
            Supply Chain Planning
          </Typography>
          <Typography sx={{ fontSize: 13, opacity: 0.85, maxWidth: 360 }}>
            Intelligent inventory optimization with agentic AI for stockout prevention,
            excess management, and network rebalancing.
          </Typography>
        </Stack>
      </Box>

      {/* Form panel (right, 58%) */}
      <Box sx={{
        flex: 1,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "#E9ECF1",
        p: 3,
      }}>
        <Box component="form" onSubmit={handleSubmit} sx={{
          width: "100%", maxWidth: 400,
          background: "#fff", borderRadius: "10px", p: 4,
          boxShadow: "0 8px 24px rgba(11, 24, 48, 0.08)",
        }}>
          <Stack spacing={2}>
            <Box>
              <Typography sx={{
                fontFamily: '"Montserrat", sans-serif', fontWeight: 700,
                fontSize: 22, color: "#0A2248", letterSpacing: "-0.01em",
              }}>
                Sign in
              </Typography>
              <Typography sx={{ fontSize: 12, color: "#4a6680", mt: 0.5 }}>
                Welcome back. Please enter your credentials.
              </Typography>
            </Box>
            {error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : null}
            <TextField
              fullWidth
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonOutlineOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              fullWidth
              type={showPassword ? "text" : "password"}
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPassword((p) => !p)} edge="end">
                      {showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <Button type="submit" variant="contained" disabled={submitting} fullWidth size="medium">
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
            <Typography sx={{ fontSize: 10, color: "#7D8A9B", textAlign: "center", mt: 1 }}>
              Demo: admin / admin123 &nbsp;&middot;&nbsp; planner / planner &nbsp;&middot;&nbsp; analyst / analyst
            </Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
