import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8088";
  return {
    base: "./",
    plugins: [react()],
    server: {
      port: 5174,
      proxy: {
        "/api": { target, changeOrigin: true },
        "/auth": { target, changeOrigin: true },
        "/admin": { target, changeOrigin: true },
        "/static": { target, changeOrigin: true },
      },
    },
  };
});
