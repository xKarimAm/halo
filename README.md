# Halo

Hey, I'm Karim. Halo is a bilingual Arabic/English copilot for Google Meet. While people talk, little glass speech bubbles pop up on their video tile with the stuff that matters: a point, a question, a decision or a pushback, in your language, with the original quote one click away. After the call there's a Notes page with each person's role, their points and the action items.

It all runs on your own PC: a Chrome extension plus a small Python backend. Nothing is hosted and there are no logins. Only the model calls leave your machine.

Built solo for the Meta Global AI Developer Hackathon (Indie track). MIT licensed.

## Judging in 5 minutes

1. Install it (see [Install](#install)) with your Meta Model API key in `.env`.
2. `uv run python packaging/demo.py` plays three scripted meetings (English, Arabic, mixed) through the real Meta models. No call needed; it takes about 3 minutes and prints a notes link per meeting.
3. `uv run halo`, then open http://127.0.0.1:8765. You get the meetings list, the notes, the action items board and the speaking panel.
4. Live: load the extension, pair, join a Google Meet call with a headset and press **Start** (see [Run it](#run-it)).

No key? `$env:HALO_FAKES = "1"; uv run halo` boots offline, and the tests run with no key at all (see [Try it without keys](#try-it-without-keys)).

## Built during the event

Everything in this repo was written during the hackathon. The first commit is Oct 30, 2026 and `git log` shows the whole history. No code came from older projects.

By default Halo runs in **Frame mode**: the bubbles sit inside the speaker's tile. **Halo mode** (the name floating above the speaker's head, the actual "halo") runs on SAM 3.1 through an optional local worker that needs an NVIDIA GPU; it is wired end to end but not yet checked on a live call. The organisers asked that every runtime model be a Meta model, so Halo ships no other face detector.

**Built with.** Claude Code (Anthropic) and Muse Code / OpenCode on Muse Spark 1.3 were my coding tools. They wrote code, tests and docs. Gemini was used for research only. None of them is called by Halo at runtime. Every model Halo itself calls is a Meta model (table below).

## Meta models used and where

Every AI model Halo calls at runtime is a Meta model. These are all of them:

| Model | Exact id | Endpoint | Called from | What it does |
|---|---|---|---|---|
| Muse Voice Transcribe (realtime) | `muse-voice-transcribe-1.0` | `wss://api.meta.ai/v1/asr/realtime` | `backend/halo/transcriber/` (`protocol.py` builds the handshake, `transport.py` holds the socket; the URL is in `rig/fakes/config.py`) | Speech to text. Two sessions per meeting: the call audio in `DIARIZATION` mode (who said what) and your mic in `ENDPOINTING` mode. Language bias Arabic + English. |
| Muse Spark Open (open weights, Baseten by default; Modal or a local server through `.env`, see Install) | `meta-models/muse-spark-open-1026` | `https://inference.baseten.co/v1` | `backend/halo/llm/llm.py` (the one shared model client) | The first choice for every text call when its key is set: live points (`backend/halo/insight/`), urgency/kind tags (`backend/halo/classifier/`), the live coach (`backend/halo/coach/`) and the end-of-meeting notes (`backend/halo/notes_builder/`). |
| Muse Spark 1.3 (contributor) | `muse-spark-1.3-contributor` | `https://api.meta.ai/v1` | `backend/halo/llm/llm.py` | Runs every text call when no Spark Open key is set (the simplest setup: one Meta key). With a Spark Open key, it is the per-call failover when Spark Open takes over 4 s, fails twice (bad JSON, HTTP 429 or 5xx) or rejects the key; after 30 s Spark Open gets tried again. Same four callers as above. |
| SAM 3.1 (open weights, optional) | Meta's SAM 3.1 weights via the `unsloth/sam3.1` Hugging Face mirror (`transformers` `Sam3Model`) | `http://127.0.0.1:8766/faces` (your own GPU) | `packaging/sam_worker.py`, called by `extension/src/face_detector/sam.ts` | Halo mode: finds the speaker's face in their tile so the name and bubbles sit above the head. Frames stay in memory on your PC. Without the worker, Frame mode. |

The Chrome extension calls no models itself; it talks to the local backend and, in Halo mode, to the local SAM worker.

## What you need

- Windows 10 or 11 (macOS and Linux should work too, but I tested on Windows)
- Google Chrome
- [Git](https://git-scm.com/)
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (it runs the Python side). Halo needs Python 3.12+; if you don't have it, `uv python install 3.12` gets it.
- [Node.js](https://nodejs.org/) 22 or newer (only to build the extension)
- A **headset**. Without one your mic picks up the call again and you get echo.
- A Meta Model API key. A Spark Open key (Baseten, or a Modal proxy token) is optional: without one, every text call runs on Spark 1.3 contributor.

## Install

Open PowerShell:

```powershell
git clone https://github.com/xKarimAm/halo.git
cd halo
copy .env.example .env
notepad .env
```

In Notepad, fill in your keys and save:

```
META_API_KEY=your Meta Model API key
BASETEN_API_KEY=your Baseten key (optional)
```

To run Spark Open somewhere other than Baseten (a Modal shared endpoint, or a local llama.cpp / Ollama server), fill in the three `HALO_PRIMARY_*` lines plus the key line they name (for Modal, `MODAL_PROXY_TOKEN=...`); `.env.example` has a worked example for each. Without that key line, Halo quietly runs everything on Spark 1.3 contributor.

`.env` is git-ignored, so your keys stay on your PC. Never commit them.

Then build the extension:

```powershell
npm --prefix extension install
npm --prefix extension run build
```

The built extension lands in `extension\.output\chrome-mv3`. (`npm install` may report vulnerabilities: they are all in the build tools. The extension itself ships with no npm dependencies; `npm --prefix extension audit --omit=dev` says 0.)

## Run it

**1. Start the backend** (from the `halo` folder):

```powershell
uv run halo
```

The first run installs the Python packages, then you'll see something like:

```
Halo backend on http://127.0.0.1:8765 - pairing code: 123456
```

Leave that window open. Quick check: http://127.0.0.1:8765/healthz should say `"status":"ok"`.

**2. Load the extension.** In Chrome go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked** and pick the `extension\.output\chrome-mv3` folder.

**3. Pair (once).** Click the Halo icon in the toolbar, type the 6-digit code from the backend window and press **Pair**. It should say "Paired". The pairing sticks across backend restarts.

**4. The mic.** Nothing to set up: at Start, Halo opens your mic inside the Meet tab under the permission you already gave Meet. If Meet has no mic permission, Halo runs on the call audio only.

**5. Start in a call.** Join a Google Meet call, open the Halo popup, fill in the subject, the agenda (one item per line) and people's roles if you like (your points language is under **Preferences**), then press **Start** once. It turns to **Running**; pressing it again does nothing. Start only works on a `meet.google.com` call tab.

Please tell everyone in the call that Halo is recording and transcribing before you start. **Copy consent notice** in the popup, under Start, copies a bilingual notice for you to paste into the Meet chat.

**6. Notes.** Open http://127.0.0.1:8765/notes for the list of meetings and click yours. The page shows the live points while the call runs, and the full notes once the meeting has ended.

The meeting ends when you press **Stop** in the popup, leave the call, or close the Meet tab. A "Meeting notes are ready" toast with a link then shows on the Meet page.

Everything Halo saves (transcripts, notes, recordings) lives in the `data` folder next to the code. Delete that folder to wipe it.

## Try it without a call (demo meetings)

With your Meta key in `.env`, this plays three scripted meetings through the real pipeline: an English product review, an Arabic deadline dispute and a mixed Arabic/English launch sync. Insight, the classifier, the coach and the notes builder all run on the Meta models; only Meet, the mic and speech-to-text are skipped. It takes about 3 minutes and prints a notes link for each meeting:

```powershell
uv run python packaging/demo.py
```

Then (with `uv run halo` running) open http://127.0.0.1:8765/notes. It is safe to run while the backend runs.

## Halo mode (optional, NVIDIA GPU)

Halo mode needs the SAM 3.1 worker running next to the backend. Once, from the `halo` folder:

```powershell
uv venv .venv-sam --python 3.12
uv pip install --python .venv-sam --index-strategy unsafe-best-match -r packaging/requirements-sam.txt
```

Then, in a second PowerShell window, each time (the first run downloads the SAM 3.1 weights, a few GB):

```powershell
.venv-sam\Scripts\python packaging/sam_worker.py
```

Measured on an RTX 3080 Ti: about 220 ms per frame, 2 GB of video memory. If the worker is not running, Halo quietly stays in Frame mode.

## Try it without keys

You can boot the backend offline with fake engines, which is handy to check the install (it stays in fake mode for that PowerShell window only):

```powershell
$env:HALO_FAKES = "1"
uv run halo
```

And the unit tests (no keys, no network, under a minute):

```powershell
uv run pytest backend contracts -q
npm --prefix extension test
```

A plain `uv run pytest` also runs the end-to-end rig tests. Those start their own backend on port 8765 and drive Chromium through Playwright, so stop your own `uv run halo` first.

## What's in here

| Path | What |
|---|---|
| `contracts/` | The only thing the modules share: message schemas and the ACK rules |
| `backend/halo/` | The FastAPI backend: Gateway, Transcriber, Correlator, Insight, Classifier, Coach, Notes Builder, Notes Service, Recorder, Event Store |
| `packaging/` | `demo.py` (demo meetings), `sam_worker.py` (optional SAM 3.1 worker), release checks |
| `extension/` | The Chrome extension (WXT + TypeScript): setup popup, capture, Meet adapter, overlay |
| `notes-page/` | The Notes page the backend serves |
| `rig/` | Offline test rig: fake Meet page, fake engines, replayer |
| `docs/` | Decisions, architecture diagram, UI designs |

More docs: [user guide](docs/USER-GUIDE.md) (solo and team use), [troubleshooting](docs/TROUBLESHOOTING.md), [architecture](docs/ARCHITECTURE.md). Start with [`docs/DECISIONS.md`](docs/DECISIONS.md) if you want the why behind things. The architecture diagram is [`docs/architecture/halo-v2-final.drawio`](docs/architecture/halo-v2-final.drawio).

## License

MIT, see [LICENSE](LICENSE).
