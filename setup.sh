#!/usr/bin/env sh
# Halo setup for macOS and Linux. Run from the repo folder:  sh setup.sh   (sh setup.sh --no-start)
# Same steps as setup.ps1: uv, .env with a hidden key prompt, the extension build, then Halo.
# ponytail: untested on macOS/Linux (Halo is tested on Windows 11); the steps are the README's.
set -e
cd "$(dirname "$0")"
step() { printf '\n== %s\n' "$1"; }

step "1/4 uv (runs the Python backend)"
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is missing; installing it from astral.sh (the official installer)."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
uv --version

step "2/4 .env (your Meta Model API key)"
[ -f .env ] || cp .env.example .env
ask_key() {
  if grep -Eq "^$1=[^[:space:]]" .env; then echo "$1 is already set."; return; fi
  printf '%s (hidden; Enter to skip): ' "$2"
  stty -echo 2>/dev/null || true; read -r key; stty echo 2>/dev/null || true; echo
  [ -n "$key" ] || { echo "Skipped $1."; return; }
  tmp=$(mktemp)
  awk -v k="$1" -v v="$key" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' .env > "$tmp" && mv "$tmp" .env
  echo "$1 saved in .env."
}
ask_key META_API_KEY "Paste your Meta Model API key"
ask_key BASETEN_API_KEY "Optional Spark Open key on Baseten"

step "3/4 The Chrome extension"
ext="$(pwd)/extension/.output/chrome-mv3"
if [ ! -f "$ext/manifest.json" ]; then
  if command -v npm >/dev/null 2>&1; then
    npm --prefix extension install && npm --prefix extension run build
  else
    echo "Node.js is missing: install Node 22+ from https://nodejs.org, or, if the repo's Releases page has halo-extension.zip, unzip it into $ext, then run this again."
    exit 1
  fi
fi
echo "Extension ready: $ext"
echo "In Chrome: open chrome://extensions, turn on Developer mode, click Load unpacked, pick that folder."

step "4/4 Start Halo"
if [ "$1" = "--no-start" ]; then echo "Skipped. Start it later with: uv run halo"; exit 0; fi
echo "Leave this window open while you use Halo. The extension pairs on its own; the pill in its popup says Connected."
exec uv run halo
