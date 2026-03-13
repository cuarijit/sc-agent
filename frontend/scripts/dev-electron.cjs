const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const frontendDir = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

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

const vite = spawn(npmCmd, ["run", "dev"], {
  cwd: frontendDir,
  stdio: "inherit",
});

let electron;

waitForVite("http://localhost:5174")
  .then(() => {
    electron = spawn(npmCmd, ["exec", "electron", "electron/main.cjs"], {
      cwd: frontendDir,
      stdio: "inherit",
    });

    electron.on("exit", (code) => {
      if (!vite.killed) {
        vite.kill();
      }
      process.exit(code || 0);
    });
  })
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
