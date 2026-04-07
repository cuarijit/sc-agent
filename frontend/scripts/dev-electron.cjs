const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

const frontendDir = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const DEV_HOST = "127.0.0.1";
const DEFAULT_DEV_PORT = 5174;

function waitForVite(url, timeoutMs = 60000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tryConnect, 500);
      });
    };
    tryConnect();
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, DEV_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to resolve a free dev server port.")));
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, DEV_HOST, () => {
      server.close(() => resolve(true));
    });
  });
}

function parseDevUrl(rawUrl) {
  const normalized = (rawUrl || "").trim();
  if (!normalized) return "";
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

async function resolveDevUrl() {
  const envUrl = parseDevUrl(process.env.VITE_DEV_SERVER_URL);
  if (envUrl) return envUrl;

  const envPort = Number(process.env.VITE_DEV_PORT);
  if (Number.isFinite(envPort) && envPort > 0) {
    return `http://${DEV_HOST}:${envPort}`;
  }

  if (await isPortAvailable(DEFAULT_DEV_PORT)) {
    return `http://${DEV_HOST}:${DEFAULT_DEV_PORT}`;
  }

  const freePort = await getFreePort();
  return `http://${DEV_HOST}:${freePort}`;
}

(async () => {
  const devUrl = await resolveDevUrl();
  const devPort = new URL(devUrl).port || String(DEFAULT_DEV_PORT);

  const vite = spawn(
    npmCmd,
    ["run", "dev", "--", "--host", DEV_HOST, "--port", devPort, "--strictPort"],
    {
      cwd: frontendDir,
      stdio: "inherit",
    },
  );

  let electron;

  const startElectron = () => {
    electron = spawn(npmCmd, ["exec", "electron", "electron/main.cjs"], {
      cwd: frontendDir,
      stdio: "inherit",
      env: {
        ...process.env,
        VITE_DEV_SERVER_URL: devUrl,
      },
    });

    electron.on("exit", (code) => {
      if (!vite.killed) {
        vite.kill();
      }
      process.exit(code || 0);
    });
  };

  waitForVite(devUrl)
    .then(startElectron)
    .catch((error) => {
      console.error(error.message);
      if (!vite.killed) {
        vite.kill();
      }
      process.exit(1);
    });

  vite.on("exit", (code) => {
    if (electron && !electron.killed) {
      electron.kill();
    }
    process.exit(code || 0);
  });
})().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
