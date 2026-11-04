# Security

Halo hears your meetings, so this file says exactly what it exposes and how each part is closed off.

## What listens, and where

| Process | Address | Who may use it |
|---|---|---|
| Backend (`uv run halo`) | `127.0.0.1:8765` only | Requests whose `Host` is `127.0.0.1`, `localhost` or `[::1]`; anything else gets 400. This blocks DNS-rebinding pages. |
| `/ws` (the extension's socket) | same | Only the pinned Halo extension Origin (`chrome-extension://dbngpodihegmipdmikpbkflahdkfpgif`), and only after `pair.hello` carries a token this backend issued. Audio frames sent before pairing are dropped. |
| `POST` routes on the notes page (`/api/ask`, re-tag, folders) | same | Same-origin only. A request from another site carries a foreign `Origin` and gets 403, so no web page can spend your model calls or edit your notes. |
| SAM 3.1 worker (optional) | `127.0.0.1:8766` only | `Host` must be `127.0.0.1:8766`, the Origin must be absent or a Chrome extension, and the body must be `image/jpeg`. A web page cannot send that without a CORS preflight, which the worker never answers. |

## Pairing

The backend prints a 6-digit code at start. The code works once. The extension trades it for a random 32-byte token (`secrets.token_urlsafe`). The backend keeps only the token's SHA-256 hash, so the token survives restarts but is never stored in clear text on the backend side.

Since 2026-11-04 the popup pairs on its own: `POST /pair/auto` mints a token only when the request's `Origin` is the pinned Halo extension (`chrome-extension://dbngpodihegmipdmikpbkflahdkfpgif`); any other Origin, or none, gets 403. A web page cannot set that Origin. A program already running on your PC could, but such a program can already read `data/`, so automatic pairing gives it nothing new. The 6-digit code stays as the fallback.

## Keys

- Model keys live in `.env`, which git ignores (`.gitignore`: `.env`, `.env.*`, except `.env.example`).
- Only the backend reads them. The extension holds no key and calls no model.
- No log line, alert or `data/health.json` field contains a key. At start the backend only says whether a key is empty.

## Your data

- Transcripts, notes, recordings and logs stay in `data/` (git-ignored). Delete the folder to wipe everything.
- What leaves your PC: the call and mic audio go to Meta's speech-to-text, and the transcript text goes to Muse Spark (at api.meta.ai, or at Baseten, Modal or your own server when you set a Spark Open key). Video frames never leave the PC; in Halo mode they go only to the local SAM worker.
- **Web searches:** a sentence with a number in it goes to Muse Spark's web search for the live fact check, so that sentence can reach a search engine. Internal plans and figures are meant to be skipped, but the model decides that. To keep every sentence off the web, add `HALO_FACT_CHECK=0` to `.env`.

## Reporting a problem

Please don't post the details in a public issue. Open an issue titled "Security contact" with no details, and I'll reply with a private way to send them.
