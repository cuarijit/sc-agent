import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface AuthUser {
  user_id: number;
  username: string;
  name: string;
  email: string;
  roles: string[];
  entitlements: string[];
  data_access_groups: string[];
}

export type AuthState = "checking" | "authenticated" | "unauthenticated" | "disabled";

interface AuthContextValue {
  state: AuthState;
  user: AuthUser | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  refresh: () => Promise<void>;
  hasEntitlement: (key: string) => boolean;
  hasRole: (role: string) => boolean;
  setError: (msg: string | null) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  (typeof window !== "undefined" && window.location.protocol === "file:" ? "http://127.0.0.1:8000" : "");

async function authFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = await res.json() as { detail?: string };
      detail = j?.detail ?? "";
    } catch {}
    const err = new Error(detail || `Request failed: ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("checking");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const me = await authFetch<AuthUser & { authenticated: boolean }>("/auth/me");
      setUser(me);
      setState("authenticated");
      setError(null);
    } catch (e) {
      const status = (e as Error & { status?: number }).status;
      if (status === 401) {
        setUser(null);
        setState("unauthenticated");
      } else {
        // Network error or backend down — stay in checking briefly, then unauthenticated
        setUser(null);
        setState("unauthenticated");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Listen for 401 events emitted by the api request helper
  useEffect(() => {
    function onSessionExpired() {
      setUser(null);
      setState("unauthenticated");
    }
    window.addEventListener("auth:session-expired", onSessionExpired);
    return () => window.removeEventListener("auth:session-expired", onSessionExpired);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setError(null);
    try {
      const u = await authFetch<AuthUser & { authenticated: boolean }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setUser(u);
      setState("authenticated");
    } catch (e) {
      setError((e as Error).message || "Login failed");
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authFetch<{ authenticated: false }>("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setUser(null);
    setState("unauthenticated");
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await authFetch("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }, []);

  const hasEntitlement = useCallback(
    (key: string) => {
      if (!user) return false;
      if (user.roles.includes("admin")) return true;
      if (user.entitlements.includes("*")) return true;
      return user.entitlements.includes(key);
    },
    [user],
  );

  const hasRole = useCallback((role: string) => !!user && user.roles.includes(role), [user]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, user, error, login, logout, changePassword, refresh, hasEntitlement, hasRole, setError }),
    [state, user, error, login, logout, changePassword, refresh, hasEntitlement, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
