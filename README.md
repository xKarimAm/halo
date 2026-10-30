# Halo

A bilingual (Arabic / English) copilot for Google Meet. Each person's **name floats above their head** — the name is the halo — and up to three glass speech bubbles beside their face show what they just said that matters: a point, a question, a decision or a pushback, in your language, with the original quote one click away. After the call, a Notes page gives every person their role, relevant points, own points and action items grouped by urgency, each linked to the transcript line and the recording moment.

Built for the Meta AI Developer Hackathon (Oct 27 – Nov 4, 2026) with Muse Voice Transcribe, Muse Spark Open (open weights, on Baseten), Muse Spark 1.3 and the Muse Code coding agent.

Everything runs on your own PC: a Chrome extension plus a local Python backend. Nothing is hosted; only the model calls leave the machine.

> Status: under construction. Install steps below are the target; they become real as the modules land.

## Requirements

- Windows, macOS or Linux with Chrome
- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 22+ (to build the extension)
- A **headset** (without one, your mic re-captures the call)
- API keys: Meta Model API, Baseten

## Install

```bash
git clone https://github.com/xKarimAm/halo.git
cd halo
cp .env.example .env        # then put your keys in .env
uv run halo                 # starts the backend and prints a 6-digit pairing code
```

```bash
cd extension
npm install
npm run build               # output: extension/.output/chrome-mv3
```

In Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick `extension/.output/chrome-mv3`. Open `http://127.0.0.1:8765/pair`, type the code into the Halo popup once.

## Use

1. Join a Google Meet call, click the Halo icon, fill in subject, agenda and roles, press **Start**.
2. Post the consent notice in the Meet chat (the popup gives you the text).
3. After the call, open the Notes link Halo shows you.

## Layout

| Path | What |
|---|---|
| `contracts/` | The only thing modules share: message envelope, ACK rules, event schemas (AsyncAPI + JSON Schema), generated types |
| `backend/` | FastAPI modular monolith: Gateway, Transcriber, Correlator, Insight, Classifier, Notes Builder, Notes Service, Recorder, Event Store |
| `extension/` | WXT/TypeScript Chrome extension: Setup Panel, Capture, Meet Adapter, Frame Source, Face Detector, Overlay |
| `rig/` | Offline test rig: Fake Meet page, fake engines, Replayer |
| `docs/` | Decisions, architecture diagram, UI source of truth, build plans |

Architecture: [`docs/architecture/halo-v2-final.drawio`](docs/architecture/halo-v2-final.drawio). Decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## License

MIT
