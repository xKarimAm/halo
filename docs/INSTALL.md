# Install and set up Halo

This is the full guide, from a clean PC to a live call. The README has the short version. Each step ends with a check, so you know it worked before moving on. If a check fails, the [troubleshooting](TROUBLESHOOTING.md) page lists every message Halo shows and what to do.

Tested on Windows 11 with PowerShell. macOS and Linux should work with the same commands (use `cp` for `copy` and `/` in paths), but I haven't tested them.

## 1. What you need

| Tool | Why Halo needs it | Check |
|---|---|---|
| Google Chrome | The extension runs in it, and Halo reads the Meet tab | `chrome://version` opens |
| [Git](https://git-scm.com/) | To get the code | `git --version` |
| [uv](https://docs.astral.sh/uv/getting-started/installation/) | Runs the Python backend with the exact locked packages (`uv.lock`) | `uv --version` |
| Python 3.12+ | The backend. `uv python install 3.12` gets it if you don't have it | `uv python find 3.12` |
| [Node.js](https://nodejs.org/) 22+ | Only to build the extension | `node --version` says v22 or higher |
| A headset | Without one, your mic picks the call up again and the others hear echo | |
| A Meta Model API key | Speech-to-text and every text call | |

Optional:

- **A Spark Open key** (Baseten, a Modal proxy token, or your own local server). Without one, every text call runs on Muse Spark 1.3 contributor, which is the simplest setup.
- **An NVIDIA GPU** for Halo mode (SAM 3.1). Without one, Halo runs in Frame mode.

## 2. Get the code and add your key

```powershell
git clone https://github.com/xKarimAm/halo.git
cd halo
copy .env.example .env
notepad .env
```

In Notepad, put your key after `META_API_KEY=` and save. Leave the other lines as they are unless you have a Spark Open key (step 7).

`.env` is git-ignored, so your keys stay on your PC. Never commit them.

**Check:** `uv run halo` (step 4) prints no `META_API_KEY is empty` warning.

## 3. Build the extension

```powershell
npm --prefix extension install
npm --prefix extension run build
```

**Check:** the folder `extension\.output\chrome-mv3` exists and holds `manifest.json`.

`npm install` may report vulnerabilities. They are all in the build tools: the shipped extension has no npm dependencies, and `npm --prefix extension audit --omit=dev` says 0.

## 4. Start the backend

```powershell
uv run halo
```

The first run installs the Python packages. Then it prints:

```
Halo backend on http://127.0.0.1:8765 - pairing code: 123456
```

Leave this window open while you use Halo.

**Check:** http://127.0.0.1:8765/healthz says `"status":"ok"`.

## 5. Load the extension and pair

1. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension\.output\chrome-mv3` folder.
3. Click the Halo icon in the toolbar (pin it from the puzzle-piece menu if you don't see it).
4. Type the 6-digit code from the backend window and press **Pair**.

**Check:** the popup says "Paired". Pairing survives backend restarts, so you do this once. A code works only once; a restart prints a fresh one.

## 6. Your first meeting

1. Join a Google Meet call in Chrome, headset on.
2. Click the Halo icon. Under **About this meeting**, fill in the subject, the agenda (one item per line) and people's roles if you like. Your points language is under **Preferences**.
3. Press **Start** once. It turns to **Running** and names the microphone Halo opened.
4. Tell everyone that Halo is recording and transcribing. **Copy consent notice** puts a bilingual notice on your clipboard to paste into the Meet chat.

The mic needs no setup: Halo opens it inside the Meet tab, under the permission you already gave Meet. If Meet has no mic permission, Halo hears only the call.

**Check:** within a few seconds of someone speaking, their words appear as a caption on their tile, and points follow as glass bubbles.

The meeting ends when you press **Stop**, leave the call, or close the tab. A "Meeting notes are ready" toast then links to the notes. All notes are at http://127.0.0.1:8765.

The [user guide](USER-GUIDE.md) explains everything you see during and after the call, for solo and team use.

## 7. Optional: Spark Open as the first engine

With a Spark Open key, every text call goes to Spark Open first and fails over to Spark 1.3 contributor per call when Spark Open is slow (over 4 s) or fails twice.

- **Baseten:** put the key after `BASETEN_API_KEY=` in `.env`.
- **Modal or a local server** (llama.cpp, Ollama): fill in `HALO_PRIMARY_BASE_URL`, `HALO_PRIMARY_MODEL`, `HALO_PRIMARY_KEY_VAR`, and the key line that `HALO_PRIMARY_KEY_VAR` names. `.env.example` has a worked example for each.

**Check:** after a restart, the backend no longer prints `note: no Spark Open key`.

## 8. Optional: Halo mode (NVIDIA GPU)

Halo mode puts the speaker's name above their head. It needs the SAM 3.1 worker running next to the backend. Set it up once:

```powershell
uv venv .venv-sam --python 3.12
uv pip install --python .venv-sam --index-strategy unsafe-best-match -r packaging/requirements-sam.txt
```

Then run it in a second PowerShell window each time (the first run downloads the SAM 3.1 weights, a few GB):

```powershell
.venv-sam\Scripts\python packaging/sam_worker.py
```

**Check:** it prints `Halo SAM worker on http://127.0.0.1:8766`. Measured on an RTX 3080 Ti: about 220 ms per frame and 2 GB of video memory. Without the worker, Halo stays in Frame mode.

## Try it without a call or without a key

- **Demo meetings (needs your Meta key):** `uv run python packaging/demo.py` plays three scripted meetings (English, Arabic, mixed) through the real models. It skips only Meet, the mic and speech-to-text. It takes about 3 minutes and prints a notes link for each. It is safe to run while the backend runs.
- **No key at all:** `$env:HALO_FAKES = "1"; uv run halo` boots on offline fake engines. It stays in fake mode for that PowerShell window only.
- **Tests (no key, no network):** `uv run pytest backend contracts -q` and `npm --prefix extension test`. A plain `uv run pytest` also runs the end-to-end rig, which starts its own backend on port 8765 and drives Chromium, so stop your own `uv run halo` first.

## Update

```powershell
git pull
npm --prefix extension run build
```

Then press the reload arrow on the Halo card in `chrome://extensions` and restart `uv run halo`. Your pairing and meetings stay.

## Uninstall

1. Remove Halo in `chrome://extensions`.
2. Delete the `halo` folder. Everything Halo saved (meetings, transcripts, recordings, logs) is in its `data` folder, so this removes it all.
