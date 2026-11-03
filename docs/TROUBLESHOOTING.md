# Troubleshooting

Halo writes three files you can read when something looks wrong. They live in the `data` folder next to the code (or wherever `HALO_DATA_DIR` points):

- `backend.log`: the full log.
- `alerts.jsonl`: one line per warning or error. A message that repeats is written at most once a minute, with a count of the repeats.
- `health.json`: rewritten every 5 s. It lists each part's health, how many seconds ago the last call audio and mic audio arrived, and a `problems` list in plain words.

Open http://127.0.0.1:8765/healthz for the same health in the browser.

## Setup

| You see | What it means | Fix |
|---|---|---|
| `warning: META_API_KEY is empty in .env` when the backend starts | No Meta key, so no transcripts, points or notes | Put your key after `META_API_KEY=` in `.env`, save, restart `uv run halo`. Or try it offline with `$env:HALO_FAKES = "1"` (see README). |
| `note: no Spark Open key, so every text call runs on muse-spark-1.3-contributor (fine)` | You only set the Meta key | Nothing to do. Add `BASETEN_API_KEY` only if you have a Spark Open key. |
| `Port 8765 is already in use: another Halo backend is probably running.` | Another Halo backend already runs on port 8765 | Close the other `uv run halo` window (or use that one). |
| Popup: **Backend unreachable at 127.0.0.1:8765.** | The backend is not running | Start `uv run halo` and leave the window open. |
| Popup: **Wrong code. Check the code and try again.** | The code does not match, or it was already used | Use the 6-digit code from the backend window. A code works once; restarting the backend prints a fresh one. |
| Popup: **Start from inside a Meet call, not the Meet homepage.** / **...this tab is not a Meet tab.** | Start only works on a `meet.google.com/<code>` call tab | Join the call first, then click the Halo icon in that tab. |
| `chrome://extensions` shows an error on Halo | The extension was built from an older checkout, or not built | Run `npm --prefix extension run build`, then press the reload arrow on the Halo card. |

## In a call

| You see | What it means | Fix |
|---|---|---|
| Popup: **Microphone: blocked in Meet, tab audio only** | Meet has no mic permission, so Halo hears only the other people | Allow the mic for meet.google.com (the camera/mic icon in the address bar), then press Stop and Start again. |
| `health.json` problem: `mic audio is pure silence (level 0)` | The mic Halo opened sends silence (a muted or wrong device) | Unmute in Meet, or pick the right mic in Meet's settings, then Stop and Start. The popup names the mic Halo opened. |
| `health.json` problem: `no tab audio for N s during an open meeting` | Halo gets no call audio | Keep the Meet tab open (minimised is fine; closed ends the meeting). Stop and Start again. |
| `health.json` problem: `N extension sockets open at once (repeat Start?)` | More than one capture is running | Press Stop, wait two seconds, press Start once. |
| The other people hear themselves (echo) | Your speakers feed the call back into your mic | Use a headset. |
| No bubbles, but the caption shows words | The model is slow or failing | Look in `alerts.jsonl` for `llm` lines. A rate limit (HTTP 429) clears on its own; a 401 means the key is wrong. |
| No names above heads, bubbles sit in the tile | Frame mode: the SAM 3.1 worker is not running | Optional. See "Halo mode" in the README; it needs an NVIDIA GPU. |
| Alt+H did nothing | Halo's bubbles are hidden or shown with Alt+H; the pill then says "Halo · hidden" | Press Alt+H again with the Meet tab focused. |

## After the call

| You see | What it means | Fix |
|---|---|---|
| No "Meeting notes are ready" toast | The meeting has not ended yet | Press Stop in the popup, leave the call, or close the tab. Notes take a few seconds to a minute. |
| The notes page says **AI summary failed, showing live notes.** | The notes model call failed twice, so Halo kept the live points and suggested actions | The meeting is still saved. Check `alerts.jsonl` for the model error. |
| Playing the recording does nothing | That meeting has no recording file in `data/recordings` (demo meetings from `packaging/demo.py` have no audio) | Expected for demo meetings. For a call, check `alerts.jsonl` for `recorder` lines. |
| I want to delete everything | Everything Halo saved is in the `data` folder | Stop the backend and delete the `data` folder. |
