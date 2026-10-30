# setup_panel: PLAN

## Job
Wave 3 (W2, Oct 31 afternoon – Nov 1). Ring 2. This module owns **only the popup**. The toolbar popup: its Start click is the user gesture Chrome needs for `tabCapture`. Pairing UI (frontend side; backend side is the Gateway): type the 6-digit code once → `POST /pair {code}` → token stored in `chrome.storage.local` (manifest key pinned so the extension id never changes). Meeting form: subject, agenda (one item per line), an optional role per participant, “My points language” (initial value only — later changes happen in the Overlay badge menu), optional project. No consent UI here: the consent dialog, notice text and “Copy notice” button live in the Overlay lane (one consent flow only).

## Inputs (contracts consumed)
HTTP `POST /pair {code} -> {token}` (plain HTTP, before any meeting). User input in the popup. Participant names surfaced from the Meet Adapter via the hub (Port) for the role fields.

## Outputs (contracts emitted)
`meeting.context {subject, agenda: string[], roles: [{name, role?}], viewer_lang: en|ar, project_id?}` sent over the Port to the hub, which forwards it on the socket (⇄ ACK). “Save context” emits it once per save; later language changes never come from here — the Overlay sends Port `set_viewer_lang` and the hub re-sends its latest context. No other envelopes. Hide/show and points-per-face are extension-local (`chrome.storage.local`), never sent.

## Lane (the files it owns)
`extension/src/setup_panel/**` (+ tests). Entry wrapper: `extension/src/entrypoints/popup/` (thin, boots this module).

## Depends on
`contracts`, Gateway `/pair`. Port shape owned by `contracts` (`contracts/ext/port.ts`).

## Fakes it tests with
Playwright + Replayer Mode B on the Fake Meet page (diagram test for this box); golden `meeting.context` sample from `contracts`.

## Done = tests
Run: `npm --prefix extension test`; L3 `npm --prefix rig/fake_meet test`. Concrete cases (diagram box: Playwright + Replayer B): (1) type code → `POST /pair` → token in `chrome.storage.local`; wrong code → visible error, nothing stored. (2) Fill subject/agenda/roles/language, Save → one `meeting.context` on the Port matching the golden shape (`agenda` split one per line, empty role omitted). (3) Start click opens the hub (user-gesture path) and capture begins; without the click nothing captures. (4) The popup contains no consent control (assert the consent flow exists only in the Overlay). (5) Reopened popup restores saved context + token (no re-pairing).

## Cut line
Ring 2. No ✂ number of its own; Arabic polish beyond RTL is ✂6 (`overlay`, `notes-page`). The never-cut consent flow lives in `overlay`, not here.

## Doubts
Answered: pairing is HTTP + token storage (batches 1, 3). Answered (review): this module owns only the popup. Language changes after setup go Overlay → Port `set_viewer_lang` → hub re-sends its latest `meeting.context`; no consent button here (the notice text and copy flow are in the Overlay lane). Unreviewed remainder of the old default, still to confirm: the popup pre-fills participant rows from the adapter's current tiles; names typed before anyone joins are kept as free-text roles and matched by exact name when tiles appear.
