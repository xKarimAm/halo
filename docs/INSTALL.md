# Install and set up Halo

This is the full guide, from a clean PC to a live call. The README has the short version. Each step ends with a check, so you know it worked before moving on. If a check fails, the [troubleshooting](TROUBLESHOOTING.md) page lists every message Halo shows and what to do.

Tested on Windows 11 with PowerShell. macOS and Linux should work with the same commands (use `cp` for `copy` and `/` in paths), but I haven't tested them.

## Fast path: one script

```powershell
git clone https://github.com/xKarimAm/halo.git
cd halo
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

`setup.ps1` does steps 2 to 4 for you: it installs uv if missing, asks for your Meta Model API key (typed hidden, saved only in `.env`) and an optional Baseten key, builds the extension, opens its folder, and starts the backend. It is safe to run again; it skips what is done. Then do step 5 (load the extension; it pairs on its own). On macOS or Linux, `sh setup.sh` does the same (untested there).

The script needs Node.js 22+ to build the extension. If the repo's Releases page has a `halo-extension.zip`, you can unzip that into `extension\.output\chrome-mv3` instead and skip Node.

The rest of this page is the same thing by hand, with a check after each step.

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

You won't need the code unless automatic pairing is refused (step 5).

Leave this window open while you use Halo.

**Check:** http://127.0.0.1:8765/healthz says `"status":"ok"`.

## 5. Load the extension and pair

1. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `extension\.output\chrome-mv3` folder.
3. Click the Halo icon in the toolbar (pin it from the puzzle-piece menu if you don't see it).
4. The popup pairs on its own while the backend is running: the pill at the top says **Connected**. Nothing to type.

**Check:** the pill says "Connected" and the footer says **Paired** · with this computer. Pairing survives backend restarts.

If the pill says "Halo app not running", start `uv run halo` (step 4) and press **Try again**. If automatic pairing is refused (for example the extension was loaded under a different id), the popup asks for the 6-digit code from the backend window instead; a code works only once, and a restart prints a fresh one.

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

**What it costs.** `data/health.json` shows `llm_spend`: calls, tokens and an estimated USD per engine since the backend started, at list price ($1.25 in, $0.15 cached in, $4.25 out per 1M tokens on Baseten). In my run, `packaging/demo.py` (3 scripted meetings, 46 turns) made 101 calls for about $0.12 (`demo.py` prints this at the end). Calls that time out are billed by the provider but not counted here, so for the exact figure use Baseten's **Billing and usage** page, where you can also set a monthly budget that stops requests at the limit.

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

**Check:** it prints `Halo SAM worker on http://127.0.0.1:8766`. In my runs on an RTX 3080 Ti it took about 220 ms per frame and 2 GB of video memory. Without the worker, Halo stays in Frame mode.

## Try it without a call, or test it without a key

- **Demo meetings (needs your Meta key):** `uv run python packaging/demo.py` plays three scripted meetings (English, Arabic, mixed) through the real models. It skips only Meet, the mic and speech-to-text. It takes about 3 minutes and prints a notes link for each. It is safe to run while the backend runs.
- **Tests (no key, no network):** `uv run pytest backend contracts -q` and `npm --prefix extension test`. A plain `uv run pytest` also runs the end-to-end rig: it starts its own backend, fake engines and fake Meet page on free ports and drives Chromium, so your running `uv run halo` is untouched.

## Update

```powershell
git pull
npm --prefix extension run build
```

Then press the reload arrow on the Halo card in `chrome://extensions` and restart `uv run halo`. Your pairing and meetings stay.

## Uninstall

1. Remove Halo in `chrome://extensions`.
2. Delete the `halo` folder. Everything Halo saved (meetings, transcripts, recordings, logs) is in its `data` folder, so this removes it all.
