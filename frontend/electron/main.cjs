const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const API_HOST = "127.0.0.1";
const API_PORT = 8000;
const API_URL = `http://${API_HOST}:${API_PORT}`;

let backendProcess = null;
let backendFailedReason = "";

function listFilesRecursive(rootDir, maxDepth = 4, depth = 0) {
  if (!fs.existsSync(rootDir) || depth > maxDepth) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, maxDepth, depth + 1));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveBundledBackendExecutable() {
  const backendRoot = path.join(process.resourcesPath, "backend");
  const expectedName = process.platform === "win32" ? "backend-api.exe" : "backend-api";
  const candidates = [
    path.join(backendRoot, "backend-api", expectedName),
    path.join(backendRoot, expectedName),
    path.join(backendRoot, "backend-api", "backend-api"),
    path.join(backendRoot, "backend-api", "backend-api.exe"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const discovered = listFilesRecursive(backendRoot, 5).filter((item) => {
    const base = path.basename(item).toLowerCase();
    return base === "backend-api" || base === "backend-api.exe";
  });
  if (discovered.length) return discovered[0];
  return null;
}

function toSqliteUrl(filePath) {
  return `sqlite:///${filePath.replace(/\\/g, "/")}`;
}

function ensureDatabaseFile(filePath, sourcePath = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    return filePath;
  }

  if (sourcePath && fs.existsSync(sourcePath)) {
    fs.copyFileSync(sourcePath, filePath);
    return filePath;
  }

  fs.closeSync(fs.openSync(filePath, "w"));
  return filePath;
}

function ensureRuntimeDatabase() {
  const explicitDbPath = process.env.ASC_DESKTOP_DB_PATH || process.env.ASC_DATABASE_PATH;
  if (explicitDbPath) {
    return ensureDatabaseFile(path.resolve(explicitDbPath));
  }

  if (!app.isPackaged) {
    const repoRuntimePath = path.resolve(__dirname, "..", "..", "backend", "data", "asc.runtime.db");
    return ensureDatabaseFile(repoRuntimePath);
  }

  const userDataDir = app.getPath("userData");
  const runtimeDataDir = path.join(userDataDir, "backend-data");
  const runtimeDbPath = path.join(runtimeDataDir, "asc.runtime.db");
  const bundledRuntimeDbPath = path.join(process.resourcesPath, "backend", "data", "asc.runtime.db");
  return ensureDatabaseFile(runtimeDbPath, bundledRuntimeDbPath);
}

function startBackend() {
  const runtimeDbPath = ensureRuntimeDatabase();
  const logPath = path.join(app.getPath("userData"), "backend.log");
  try {
    fs.writeFileSync(logPath, "");
  } catch {
    // Ignore log reset failures.
  }
  const env = {
    ...process.env,
    ASC_DATABASE_URL: toSqliteUrl(runtimeDbPath),
    ASC_DATABASE_PATH: runtimeDbPath,
    ASC_SEED_DIR: app.isPackaged
      ? path.join(process.resourcesPath, "backend", "data", "seed")
      : path.join(__dirname, "..", "..", "backend", "data", "seed"),
    ASC_API_HOST: API_HOST,
    ASC_API_PORT: String(API_PORT),
  };

  if (app.isPackaged) {
    const backendExePath = resolveBundledBackendExecutable();
    if (!backendExePath) {
      const backendDir = path.join(process.resourcesPath, "backend");
      const discovered = listFilesRecursive(backendDir, 5)
        .map((item) => path.relative(process.resourcesPath, item))
        .slice(0, 30);
      if (process.platform === "win32") {
        throw new Error(
          [
            "Bundled backend executable not found in packaged resources.",
            `Expected a Windows executable named backend-api.exe under: ${backendDir}`,
            "Top discovered resource files:",
            ...discovered.map((item) => ` - ${item}`),
            "Rebuild installer on Windows and reinstall from the newly built .exe.",
          ].join("\n"),
        );
      }
      throw new Error(
        [
          "Bundled backend executable not found in packaged resources.",
          `Searched under: ${backendDir}`,
          "Top discovered resource files:",
          ...discovered.map((item) => ` - ${item}`),
        ].join("\n"),
      );
    }
    if (process.platform !== "win32") {
      try {
        fs.chmodSync(backendExePath, 0o755);
      } catch {
        // Ignore chmod failures and let spawn surface execution errors.
      }
    }
    backendProcess = spawn(backendExePath, [], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const appendLog = (chunk) => {
      try {
        fs.appendFileSync(logPath, chunk.toString());
      } catch {
        // Ignore logging failures.
      }
    };
    backendProcess.stdout?.on("data", appendLog);
    backendProcess.stderr?.on("data", appendLog);
    backendProcess.on("error", (error) => {
      backendFailedReason = String(error?.message || error);
    });
    backendProcess.on("exit", (code) => {
      backendFailedReason = `Backend process exited early (code ${code ?? "unknown"}).`;
    });
    return;
  }

  const repoRoot = path.join(__dirname, "..", "..");
  backendProcess = spawn("python", ["-m", "uvicorn", "backend.app.main:app", "--host", API_HOST, "--port", String(API_PORT)], {
    cwd: repoRoot,
    env,
    windowsHide: true,
    stdio: "inherit",
  });
}

function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return;
  }
  backendProcess.kill();
}

async function waitForBackend(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const healthy = await new Promise((resolve) => {
        const req = http.get(`${API_URL}/api/health`, (res) => {
          res.resume();
          resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
        });
        req.on("error", () => resolve(false));
      });
      if (healthy) {
        return;
      }
    } catch {
      // Backend not ready yet.
    }
    if (backendFailedReason) {
      throw new Error(backendFailedReason);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Backend did not become healthy within ${Math.round(timeoutMs / 1000)} seconds.`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    return;
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5174";
  win.loadURL(devServerUrl);
  win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(async () => {
  try {
    startBackend();
    await waitForBackend(120000);
    createWindow();
  } catch (error) {
    const logPath = path.join(app.getPath("userData"), "backend.log");
    dialog.showErrorBox("Startup failed", `${String(error?.message || error)}\nBackend log: ${logPath}`);
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopBackend();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
