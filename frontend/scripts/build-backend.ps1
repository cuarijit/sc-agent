$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

Write-Host "Installing backend runtime dependencies..." -ForegroundColor Cyan
python -m pip install -r backend/requirements.txt

Write-Host "Installing PyInstaller..." -ForegroundColor Cyan
python -m pip install pyinstaller

$outputDir = Join-Path $repoRoot "backend\dist-electron"
if (!(Test-Path $outputDir)) {
  New-Item -Path $outputDir -ItemType Directory | Out-Null
}

Write-Host "Building backend-api.exe..." -ForegroundColor Cyan
python -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name backend-api `
  --distpath $outputDir `
  --paths $repoRoot `
  backend/app/server_entry.py

Write-Host "Backend executable created at $outputDir\\backend-api\\backend-api.exe" -ForegroundColor Green
