# Muse Voice Transcribe (realtime)

- Endpoint `wss://api.meta.ai/v1/asr/realtime`, model `muse-voice-transcribe-1.0`.
- Auth goes in the first JSON frame, `authorization.accessToken = "Bearer <key>"`, sent within 10 s of connecting. The HTTP `Authorization` header is ignored on this endpoint.
- Audio: mono 16-bit little-endian PCM at 16 kHz or 24 kHz, sent as binary frames paced at real time.

## Halo runs two sessions per meeting

| Stream | Mode | Speaker |
|---|---|---|
| Tab audio (everyone else) | `DIARIZATION` | labels `A`, `B`, ... per session |
| Mic (the Halo user) | `ENDPOINTING` | always "you" |

Mode is fixed at the handshake. Pass Meet tile names and Setup Panel terms as `keywords`, and `languageBias: ["arabic", "english"]`. Both are hints.

## Events

- Turn lifecycle: `speechStart` → partials → `speaker` → `speechEnd` → `speechComplete`.
- Partials are cumulative: each replaces the last, so update in place. `final: true` marks completion.
- A `speaker` event labels the span before it. `speechComplete` arrives asynchronously, so key everything by `turnId`, never by arrival order.
- Diarization covers non-overlapping speech only.

## Session rules the Transcriber must enforce

| Server check | Close code | Halo behaviour |
|---|---|---|
| No handshake within 10 s | 1008 | Send the handshake immediately on connect |
| More than 5 s of audio backlog | 1008 | Pace against an absolute clock; never burst buffered audio |
| Ingress below real time for 10 s | 1008 | Send silence frames whenever the tab is quiet or muted |
| Session open longer than 60 min | 1011 | Rotate to a fresh session before 60 min; speaker labels reset, so emit a rotation event for the Correlator to re-map |
| Rate limited | 1013 | Back off and reconnect |
