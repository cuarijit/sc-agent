const { spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const pythonCandidates = process.platform === "win32"
  ? ["python", "py -3", "py"]
  : ["python3.12", "python3", "python"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function resolvePython() {
  for (const candidate of pythonCandidates) {
    if (candidate.includes(" ")) {
      const result = spawnSync(candidate, ["--version"], {
        cwd: repoRoot,
        stdio: "ignore",
        shell: true,
      });
      if (result.status === 0) return { command: candidate, shell: true };
      continue;
    }
    const result = spawnSync(candidate, ["--version"], {
      cwd: repoRoot,
      stdio: "ignore",
      shell: false,
    });
    if (result.status === 0) return { command: candidate, shell: false };
  }
  throw new Error("Python not found. Install Python 3.12+ and ensure it is on PATH.");
}

function runPython(py, args) {
  run(py.command, args, { shell: py.shell });
}

function main() {
  const py = resolvePython();
  const outputDir = path.join(repoRoot, "backend", "dist-electron");
  console.log(`Using Python: ${py.command}`);

  runPython(py, ["-m", "pip", "install", "-r", "backend/requirements.txt"]);
  runPython(py, ["-m", "pip", "install", "pyinstaller"]);
  runPython(py, [
    "-m",
    "PyInstaller",
    "--noconfirm",
    "--clean",
    "--onedir",
    "--name",
    "backend-api",
    "--distpath",
    outputDir,
    "--paths",
    repoRoot,
    "backend/app/server_entry.py",
  ]);

  const executableName = process.platform === "win32" ? "backend-api.exe" : "backend-api";
  const builtPath = path.join(outputDir, "backend-api", executableName);
  console.log(`Backend bundle created at: ${builtPath}`);
}

main();
