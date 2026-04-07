const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const repoRoot = path.resolve(__dirname, "..", "..");
const outputDir = path.join(repoRoot, "backend", "dist-electron");

const venvDir = path.join(repoRoot, ".venv-build");
const venvPython =
  process.platform === "win32"
    ? path.join(venvDir, "Scripts", "python.exe")
    : path.join(venvDir, "bin", "python3");

const pythonCandidates =
  process.platform === "win32"
    ? ["python", "py -3", "py"]
    : ["python3.12", "python3.13", "python3", "python"];

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${command} ${args.join(" ")}`);
  }
}

function resolvePython() {
  if (fs.existsSync(venvPython)) {
    console.log(`Using venv Python: ${venvPython}`);
    return { command: venvPython, shell: false };
  }

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
  throw new Error(
    "Python not found. Create a .venv-build virtualenv or install Python 3.12+ on PATH.",
  );
}

function runPython(py, args) {
  run(py.command, args, { shell: py.shell });
}

function main() {
  const py = resolvePython();
  console.log(`Using Python: ${py.command}`);

  const hasReqs = spawnSync(py.command, ["-c", "import fastapi, uvicorn, sqlalchemy"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: py.shell,
  });
  if (hasReqs.status !== 0) {
    console.log("Installing backend requirements...");
    runPython(py, ["-m", "pip", "install", "-r", "backend/requirements.txt"]);
  }

  const hasPyInstaller = spawnSync(py.command, ["-m", "PyInstaller", "--version"], {
    cwd: repoRoot,
    stdio: "ignore",
    shell: py.shell,
  });
  if (hasPyInstaller.status !== 0) {
    console.log("Installing PyInstaller...");
    runPython(py, ["-m", "pip", "install", "pyinstaller"]);
  }

  const specFile = path.join(repoRoot, "backend-api.spec");
  if (fs.existsSync(specFile)) {
    console.log("Building backend with spec file...");
    runPython(py, [
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--clean",
      "--distpath",
      outputDir,
      specFile,
    ]);
  } else {
    console.log("Building backend (no spec file, using defaults)...");
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
  }

  const executableName = process.platform === "win32" ? "backend-api.exe" : "backend-api";
  const builtPath = path.join(outputDir, "backend-api", executableName);
  if (fs.existsSync(builtPath)) {
    console.log(`Backend bundle created at: ${builtPath}`);
  } else {
    console.warn(`Warning: Expected executable not found at: ${builtPath}`);
    console.warn("Check PyInstaller output above for errors.");
  }
}

main();
