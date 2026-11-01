# Halo

Hey, I'm Karim. Halo is a bilingual Arabic/English copilot for Google Meet. While people talk, little glass speech bubbles pop up on their video tile with the stuff that matters: a point, a question, a decision or a pushback, in your language, with the original quote one click away. After the call there's a Notes page with each person's role, their points and the action items.

It all runs on your own PC: a Chrome extension plus a small Python backend. Nothing is hosted and there are no logins. Only the model calls leave your machine.

Built solo for the Meta Global AI Developer Hackathon (Indie track). MIT licensed.

## Built during the event

Everything in this repo was written during the hackathon. The first commit is Oct 30, 2026 and `git log` shows the whole history. No code came from older projects.

What works today is **Frame mode**: the bubbles sit inside the speaker's tile. The face-anchored version (name floating above the head, the actual "halo") is next, on SAM 3.1. There's MediaPipe face detector code in `extension/src/face_detector/`, but nothing loads it: `extension/src/entrypoints/meet.content.ts` never mounts it, because the organisers asked that every runtime model be a Meta model.

## Meta models used and where

Every AI model Halo calls at runtime is a Meta model. These are all of them:

| Model | Exact id | Endpoint | Called from | What it does |
|---|---|---|---|---|
| Muse Voice Transcribe (realtime) | `muse-voice-transcribe-1.0` | `wss://api.meta.ai/v1/asr/realtime` | `backend/halo/transcriber/` (`protocol.py` builds the handshake, `transport.py` holds the socket; the URL is in `rig/fakes/config.py`) | Speech to text. Two sessions per meeting: the call audio in `DIARIZATION` mode (who said what) and your mic in `ENDPOINTING` mode. Language bias Arabic + English. |
| Muse Spark Open (open weights) | `meta-models/muse-spark-open-1026` on Baseten (default), or `meta-models/Muse-Spark-Open-816B-A42B` on a Modal shared endpoint | `https://inference.baseten.co/v1` by default; any OpenAI-compatible host through `HALO_PRIMARY_BASE_URL` in `.env` | `backend/halo/llm/llm.py` (the one shared model client) | The default for every text call: live points (`backend/halo/insight/`), urgency/kind tags (`backend/halo/classifier/`) and the end-of-meeting notes (`backend/halo/notes_builder/`). |
| Muse Spark 1.3 (contributor) | `muse-spark-1.3-contributor` | `https://api.meta.ai/v1` | `backend/halo/llm/llm.py` | Per-call failover when Spark Open takes over 4 s, fails twice (bad JSON, HTTP 429 or 5xx), or has a missing or rejected key. After 30 s Spark Open gets tried again. Same three callers as above. |

The Chrome extension calls no models at all; it only talks to the local backend.

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

To run Spark Open somewhere other than Baseten (a Modal shared endpoint, or a local llama.cpp / Ollama server), fill in the three `HALO_PRIMARY_*` lines instead; `.env.example` has a worked example for each.

`.env` is git-ignored, so your keys stay on your PC. Never commit them.

Then build the extension:

```powershell
npm --prefix extension install
npm --prefix extension run build
```

The built extension lands in `extension\.output\chrome-mv3`.

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

Please tell everyone in the call that Halo is recording and transcribing before you start. The **Consent notice** button next to the Halo badge (top left of the Meet page) copies a bilingual notice for you to paste into the Meet chat.

**6. Notes.** Open http://127.0.0.1:8765/api/meetings, copy the `meeting_id` of your call and open `http://127.0.0.1:8765/notes/<meeting_id>`. The page shows the live points while the call runs, and the full notes once the meeting has ended.

The meeting ends when you press **Stop** in the popup, leave the call, or close the Meet tab. A "notes are ready" toast with a link then shows on the Meet page.

Everything Halo saves (transcripts, notes, recordings) lives in the `data` folder next to the code. Delete that folder to wipe it.

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
| `backend/halo/` | The FastAPI backend: Gateway, Transcriber, Correlator, Insight, Classifier, Notes Builder, Notes Service, Recorder, Event Store |
| `extension/` | The Chrome extension (WXT + TypeScript): setup popup, capture, Meet adapter, overlay |
| `notes-page/` | The Notes page the backend serves |
| `rig/` | Offline test rig: fake Meet page, fake engines, replayer |
| `docs/` | Decisions, architecture diagram, UI designs |

Start with [`docs/DECISIONS.md`](docs/DECISIONS.md) if you want the why behind things. The architecture diagram is [`docs/architecture/halo-v2-final.drawio`](docs/architecture/halo-v2-final.drawio).

## License

MIT, see [LICENSE](LICENSE).
