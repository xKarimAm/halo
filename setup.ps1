# Halo setup for Windows (PowerShell). Run from the repo folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
# It installs uv if missing, writes .env (your key is typed hidden and stays on this PC),
# builds the extension, opens its folder for Chrome's "Load unpacked", then starts Halo.
# Safe to run again: it skips what is already done. -NoStart stops before starting Halo.
param([switch]$NoStart)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Step "1/4 uv (runs the Python backend)"
if (-not (Have "uv")) {
  Write-Host "uv is missing; installing it from astral.sh (the official installer)."
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
  if (-not (Have "uv")) { throw "uv did not install. Install it from https://docs.astral.sh/uv/ and run this again." }
}
uv --version

Step "2/4 .env (your Meta Model API key)"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
$envText = Get-Content ".env" -Raw
function Ask-Key($name, $prompt) {
  if ($script:envText -match "(?m)^$name=\S") { Write-Host "$name is already set."; return }
  $secure = Read-Host -AsSecureString $prompt
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if (-not $plain) { Write-Host "Skipped $name."; return }
  $script:envText = $script:envText -replace "(?m)^$name=.*$", "$name=$plain"
  Set-Content -Path ".env" -Value $script:envText -NoNewline -Encoding utf8
  Write-Host "$name saved in .env."
}
Ask-Key "META_API_KEY" "Paste your Meta Model API key (hidden; Enter to skip)"
Ask-Key "BASETEN_API_KEY" "Optional Spark Open key on Baseten (hidden; Enter to skip)"

Step "3/4 The Chrome extension"
$ext = Join-Path $PSScriptRoot "extension\.output\chrome-mv3"
if (-not (Test-Path (Join-Path $ext "manifest.json"))) {
  if (Have "npm") {
    npm --prefix extension install
    npm --prefix extension run build
  } else {
    throw "Node.js is not installed, so the extension can't be built. Install Node 22+ from https://nodejs.org, or, if the repo's Releases page has halo-extension.zip, unzip it to extension\.output\chrome-mv3, then run this again."
  }
}
Write-Host "Extension ready: $ext"
Write-Host "In Chrome: open chrome://extensions, turn on Developer mode, click Load unpacked, pick that folder."
if (-not $NoStart) { Start-Process explorer.exe $ext }

Step "4/4 Start Halo"
if ($NoStart) { Write-Host "Skipped (-NoStart). Start it later with: uv run halo"; exit 0 }
Write-Host "Leave this window open while you use Halo. The extension pairs on its own; the pill in its popup says Connected."
uv run halo
