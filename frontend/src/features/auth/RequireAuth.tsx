import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Box, CircularProgress } from "@mui/material";

import { useAuth } from "./AuthContext";

interface RequireAuthProps {
  children: ReactNode;
}

export function RequireAuth({ children }: RequireAuthProps) {
  const { state } = useAuth();
  const location = useLocation();
  if (state === "checking") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (state === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

interface RequireRoleProps {
  children: ReactNode;
  allowedRoles?: string[];
  requiredEntitlements?: string[];
  redirectTo?: string;
}

export function RequireRole({
  children,
  allowedRoles,
  requiredEntitlements,
  redirectTo = "/",
}: RequireRoleProps) {
  const { state, user, hasEntitlement, hasRole } = useAuth();
  if (state === "checking") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh" }}>
        <CircularProgress size={32} />
      </Box>
    );
  }
  if (state === "unauthenticated" || !user) {
    return <Navigate to="/login" replace />;
  }
  if (allowedRoles && !allowedRoles.some(hasRole)) {
    return <Navigate to={redirectTo} replace />;
  }
  if (requiredEntitlements && !requiredEntitlements.every(hasEntitlement)) {
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
