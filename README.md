<div align="center">

# Halo

### A bilingual Arabic/English meeting copilot for Google Meet, running on Meta models.

**What matters in the meeting, on the speaker's tile, while they're still talking.**

[![CI](https://github.com/xKarimAm/halo/actions/workflows/ci.yml/badge.svg)](https://github.com/xKarimAm/halo/actions/workflows/ci.yml)
[![Runtime AI: Meta models only](https://img.shields.io/badge/runtime_AI-Meta_models_only-0866ff?style=flat-square&logo=meta&logoColor=white)](#meta-models-used-and-where)
[![Arabic + English](https://img.shields.io/badge/speech-Arabic_%2B_English_%2B_mixed-c8553d?style=flat-square)](docs/FEATURES.md)
[![Python 3.12 with uv](https://img.shields.io/badge/Python_3.12-uv-3776ab?style=flat-square&logo=python&logoColor=white)](docs/INSTALL.md)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3_extension-4285f4?style=flat-square&logo=googlechrome&logoColor=white)](extension/)
[![Runs on 127.0.0.1](https://img.shields.io/badge/runs-127.0.0.1_only-555?style=flat-square)](SECURITY.md)
[![MIT license](https://img.shields.io/badge/license-MIT-f4c430?style=flat-square)](LICENSE)

[Judging in 5 minutes](#judging-in-5-minutes) · [Install](docs/INSTALL.md) · [Features](docs/FEATURES.md) · [User guide](docs/USER-GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

<br />

<img src="docs/ui/screens/notes-meeting.png" alt="Halo's notes for a scripted product review: an AI title and summary, the four people with their roles, the action items board with owners and jump-to-moment buttons, and a chat-style transcript." width="49%" />
<img src="docs/ui/screens/notes-meeting-ar.png" alt="The same notes page in Arabic, right to left, for a scripted Arabic meeting about a release date." width="49%" />

<sub>Notes from two of the demo meetings that <code>packaging/demo.py</code> plays through the real Meta models: English, and the same page in Arabic.</sub>

</div>

> [!IMPORTANT]
> Every AI model Halo calls at runtime is a Meta model: Muse Voice Transcribe, Muse Spark (1.3 contributor, or Spark Open when its key is set) and, optionally, SAM 3.1 on your own GPU. The [table below](#meta-models-used-and-where) names each one, its endpoint and the file that calls it.

> [!NOTE]
> Built solo by Karim for the Meta Global AI Developer Hackathon (Indie track). All code was written during the event: the first commit is Oct 30, 2026. Claude Code and Muse Code / OpenCode were my coding tools and Gemini my research tool; Halo calls none of them ([details](#built-with)).

---

Halo is built for meetings that switch between Arabic and English mid-sentence. It listens on your own PC and, a few seconds after someone says something that matters, puts it on their video tile in the language you read best.

- **Live bubbles.** A point, a question, a decision or a pushback appears as a glass bubble on the speaker's tile. Colour is urgency, and the exact words are one click away in their own script.
- **A live coach.** A side panel whispers 0 to 3 tips: a decision with no owner, a question nobody answered, someone who hasn't spoken. Alone in a call, it coaches a rehearsal.
- **Notes when the call ends.** An AI title and summary, an action items board with owners, decisions, open questions, a person-by-person view, a chat-style transcript with jumps into the recording, and Markdown export.
- **Ask your meetings.** Ask in English or Arabic ("who owns the signup numbers?") and get a short answer with the exact stored lines it came from. An Arabic question finds an English meeting and the other way round.

Everything runs on your PC: a Chrome extension plus a small Python backend on `127.0.0.1`. Nothing is hosted and there are no accounts. Only the model calls leave your machine. The full list, with what has been checked live and what only by tests, is in [Features](docs/FEATURES.md).

## Judging in 5 minutes

1. Install it with your Meta Model API key in `.env` ([Install](docs/INSTALL.md)).
2. `uv run python packaging/demo.py` plays three scripted meetings (English, Arabic, mixed) through the real Meta models. No call needed; it takes about 3 minutes and prints a notes link per meeting.
3. `uv run halo`, then open http://127.0.0.1:8765. You get the meetings list, the notes, the action items board and the speaking panel. Try **Ask your meetings** at the top, for example "Who owns the signup numbers?" or, in Arabic, "ماذا قررنا بشأن موعد إطلاق النسخة 3.0؟".
4. Live: load the extension, pair, join a Google Meet call with a headset and press **Start** ([steps 5 and 6](docs/INSTALL.md#5-load-the-extension-and-pair)).

No key? `$env:HALO_FAKES = "1"; uv run halo` boots offline, and the tests need no key at all: `uv run pytest backend contracts -q` and `npm --prefix extension test`.

## Quick start

You need Chrome, Git, [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js 22+, a headset and a Meta Model API key. In PowerShell:

```powershell
git clone https://github.com/xKarimAm/halo.git
cd halo
copy .env.example .env          # then put your key after META_API_KEY=
npm --prefix extension install
npm --prefix extension run build
uv run halo                     # prints the pairing code; leave it open
```

Then in Chrome: `chrome://extensions`, **Developer mode**, **Load unpacked**, pick `extension\.output\chrome-mv3`, click the Halo icon and type the pairing code. The [install guide](docs/INSTALL.md) has a check after every step, plus Spark Open, Halo mode, updating and uninstalling.

## Meta models used and where

| Model | Exact id | Endpoint | Called from | What it does |
|---|---|---|---|---|
| Muse Voice Transcribe (realtime) | `muse-voice-transcribe-1.0` | `wss://api.meta.ai/v1/asr/realtime` | `backend/halo/transcriber/` (`protocol.py` builds the handshake, `transport.py` holds the socket; the URL is in `rig/fakes/config.py`) | Speech to text. Two sessions per meeting: the call audio in `DIARIZATION` mode (who said what) and your mic in `ENDPOINTING` mode. Language bias Arabic + English. |
| Muse Spark Open (open weights, Baseten by default; Modal or a local server through `.env`) | `meta-models/muse-spark-open-1026` | `https://inference.baseten.co/v1` | `backend/halo/llm/llm.py` (the one shared model client) | The first choice for every text call when its key is set: live points (`backend/halo/insight/`), urgency/kind tags (`backend/halo/classifier/`), the live coach (`backend/halo/coach/`), the end-of-meeting notes (`backend/halo/notes_builder/`) and Ask your meetings (`backend/halo/notes_service/ask.py`). |
| Muse Spark 1.3 (contributor) | `muse-spark-1.3-contributor` | `https://api.meta.ai/v1` | `backend/halo/llm/llm.py` | Runs every text call when no Spark Open key is set (the simplest setup: one Meta key). With a Spark Open key, it is the per-call failover when Spark Open takes over 4 s, fails twice (bad JSON, HTTP 429 or 5xx) or rejects the key; after 30 s Spark Open gets tried again. Same five callers as above. |
| SAM 3.1 (open weights, optional) | Meta's SAM 3.1 weights via the `unsloth/sam3.1` Hugging Face mirror (`transformers` `Sam3Model`) | `http://127.0.0.1:8766/faces` (your own GPU) | `packaging/sam_worker.py`, called by `extension/src/face_detector/sam.ts` | Halo mode: finds the speaker's face in their tile so the name sits above the head. Frames stay in memory on your PC. Without the worker, Frame mode. |

The Chrome extension calls no models itself; it talks to the local backend and, in Halo mode, to the local SAM worker.

## How it works

<img src="docs/architecture/halo-architecture.svg" alt="Halo's architecture: the Chrome extension in the Meet tab sends audio and page events over one local WebSocket to the FastAPI backend, whose modules talk only over an in-process event bus and call Meta's Voice and Spark models; the notes page reads the same SQLite store." width="100%" />

1. The extension captures the call audio and your mic, and reads Meet's page for tiles, names and who is highlighted as speaking.
2. Both go over one local WebSocket to the backend. Every message is a typed envelope, validated against `contracts/` and acknowledged.
3. Muse Voice turns the audio into turns, and the correlator matches each turn to the right person on screen.
4. Spark reads the attributed turns and returns points; a second pass re-checks urgency; the coach reads the meeting so far.
5. When the meeting ends, Spark writes the notes in one schema-checked call. Everything is stored in local SQLite and served as the notes page.

The [architecture page](docs/architecture/index.html) (open it locally) explains why each part exists and what was left out on purpose. [ARCHITECTURE.md](docs/ARCHITECTURE.md) walks one meeting end to end.

**What was hard.** Meet's speaking highlight trails the audio, so the correlator uses a lag window and locks a speaker after 3 agreeing turns. Points have to land while they still matter, so they trigger at the speaker's pause rather than the end of the sentence. The coach has to know when to stay quiet: I tuned it in blind-judged loops on 10 scripted meetings, where one model wrote the tips and a separate judge scored old against new without knowing which was which. The last round cut invented owners and dates from 4 to 1.

## What's in here, and why

| Path | Why it exists |
|---|---|
| [`contracts/`](contracts/) | The only thing modules share: one JSON Schema per message, with the Python and TypeScript types generated from it. A mismatch fails CI instead of a live call. |
| [`backend/halo/`](backend/halo/) | The FastAPI backend, one folder per module (Gateway, Transcriber, Correlator, Insight, Classifier, Coach, Notes Builder, Notes Service, Recorder, Event Store). Modules talk only over the event bus; `uv run lint-imports` fails the build if one imports another. |
| [`extension/`](extension/) | The Chrome extension (WXT + TypeScript): setup popup, capture, Meet adapter, overlay. It holds no keys and calls no models. |
| [`notes-page/`](notes-page/) | The notes page, plain HTML/CSS/JS with no build step, so the backend serves it as files. |
| [`packaging/`](packaging/) | `demo.py` (three meetings without a call), `sam_worker.py` (the optional SAM 3.1 worker) and the release check. |
| [`rig/`](rig/) | The offline test rig: fake Voice and Spark servers on the real wire protocols, a fake Meet page that loads the real extension, and a replayer. It is how the pipeline is tested without a call or a key. |
| [`docs/`](docs/) | Install, features, user guide, troubleshooting, architecture and [DECISIONS.md](docs/DECISIONS.md), the locked decisions with their reasons. |
| `AGENTS.md`, `CLAUDE.md`, `.agents/`, per-folder `PLAN.md` / `STATE.md` | Instructions for the coding agents I built Halo with: each module has a plan and a file map, so an agent reads one folder instead of the whole repo. |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | Runs on every PR: contracts, codegen drift, Python tests, Ruff, import lanes, mypy, the extension's typecheck and tests, and the notes page's render tests in Chromium. |

## What's deliberately not here

| Not here | Why |
|---|---|
| A hosted server, accounts or a cloud database | A meeting tool hears private calls. Keeping it on `127.0.0.1` means nothing to sign up for and nothing of yours on someone else's server. |
| Any non-Meta model at runtime | The hackathon asks for Meta models, so Halo has one model client (`llm.py`) and no other AI SDK. An earlier MediaPipe face detector was removed for this reason; SAM 3.1 replaced it. |
| An embedding model or vector database for Ask | It would add a non-Meta model. Ask expands the question into English and Arabic keywords with Spark, scores stored passages, and has Spark answer from the top ones with citations. |
| Video in the recording | The recording is call audio and your mic only: smaller, and nobody's face is stored. |
| Posting into the Meet chat | Halo never writes into the call. The consent notice is copied for you to paste. |
| A Chrome Web Store listing | This is a hackathon build, loaded unpacked. The manifest key is pinned, so the extension id (which the backend's Origin check expects) is the same on every machine. |
| `CONTRIBUTING.md` | Solo hackathon project. Issues are welcome; [SECURITY.md](SECURITY.md) says how to report a security problem. |

## Built with

Claude Code (Anthropic) and Muse Code / OpenCode on Muse Spark 1.3 were my coding tools: they wrote code, tests and docs with me. Gemini was used for research only. None of them is called by Halo at runtime, and the repo has no Anthropic, OpenAI or LangChain package. Every model Halo itself calls is a Meta model ([table](#meta-models-used-and-where)).

`git log` shows the whole history from Oct 30, 2026. No code came from older projects.

## License

MIT, see [LICENSE](LICENSE).
