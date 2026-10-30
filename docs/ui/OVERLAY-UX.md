# Halo in-Meet overlay: UX spec

Reference mockup: `docs/ui/overlay-mix-b.html` (the locked look). Where this spec and `docs/DECISIONS.md` disagree, DECISIONS wins: no halo rings; the name above the head is the halo.

Scope is limited to the locked decisions in `docs/DECISIONS.md`. This spec adds no product scope.

## 1. Layers and z-order

- Each Meet tile gets one overlay layer, absolutely positioned inside that tile.
  - The layer has `pointer-events:none`. Only the pills take pointer events.
  - Because it is clipped to the tile, it can never reach Meet's bottom bar, captions band or side panel.
- Z-order: video < Meet's name label and speaking icon < Halo layer < Halo popovers. Popovers use the native popover API, so they sit in the top layer.
- Halo UI that is not per tile (the badge, the Setup panel and the consent dialog) is described in section 7.

## 2. Face mode (up to 6 tiles)

### Face box

- The Face Tracker sends a normalised `[cx, cy, w, h]` for each tile.
- The box is **never drawn** and never saved.
- Overlay positions are percentages of the tile, so the layout scales from tiles of about 200 px up to full screen.
- Tiles beyond the first 6 faces use Frame mode.

### Halo ring

- Shape: an ellipse above the head.
  - centre y = faceTop - 0.1 x faceH
  - rx = 0.46 x faceW
  - ry = 0.11 x faceW
- Stroke: a gradient `#ffc861 -> #fff4d6 -> #ffc861` with `vector-effect: non-scaling-stroke`, plus a 1 px dark hairline shadow so the ring still reads on bright walls.

| State | Trigger | Look |
|---|---|---|
| idle | Halo is on | 1.25 px stroke, opacity 0.42 |
| speaking | Meet's speaking highlight, applied **immediately** without waiting for AI | 2.2 px stroke, opacity 1, drop-shadow 3 px + 9 px `rgba(255,200,100,.55)`, 1.8 s breathe (opacity 1 -> 0.78) |
| thinking | the speaker paused and no point has arrived yet | a `#fff3d1` light segment (13% of the ring) circles the ring every 1.3 s. Reduced motion: a static dotted ring |

### Name chip

- Sits on top of the ring, centred on the face.
- Text: 12 px / 600 IBM Plex Sans. The role is 11 px in `#cfd3da`.
- Background: the chip glass (section 4) with a pill radius (999 px), padding 5/10 px.
- While the person is speaking, the chip gets a 1 px gold ring `rgba(255,217,138,.5)` and a 16 px glow `rgba(255,200,100,.35)` on top of the glass edge. The ring above the head carries the main speaking glow.
- The chip's top is clamped to at least 21 px so it never leaves the tile.
- Roles typed in the Setup panel update the chip live.

### Point placement

1. **Side.** Points go on whichever side of the face has more free width.
   - The side is decided once per face lock.
   - It never flips with language and never flips when new points arrive.
2. **Anchor.** The top of the stack lines up with the top of the face box. The horizontal gap from the face edge is `max(10px, 2.6% of tile width)`.
3. **Max width.** `min(300px, room beside the face - 10px)`.
4. **Too narrow.** If there is less than 140 px beside the face, the stack drops to a strip.
   - The strip is one row, top-anchored 2 px under the chin (the face-box bottom), at left 10 px (6 px on tiles under 320 px). It holds 1 point, with `+N` inline beside it.
   - It needs 28 px under the chin plus Meet's name-label zone (24 px). If that room is missing (a low face, or a tile under about 230 px), the stack stays beside the face on the wider side, squeezed to the room there.
   - It may cover the chest. It never covers the face. Because it hangs from the chin instead of sitting on the bottom edge, it cannot ride up over the face when text wraps.
5. **Fit.** Points are placed in rank order. A point that would push the stack into Meet's name-label zone (bottom 30 px of the tile), or push a Frame stack into the corner name chip (top 36 px), folds into `+N` together with every lower-ranked point. Room for the `+N` chip is reserved. Checked at 200 to 624 px tiles, in EN and AR: no pill touches a face box.
6. **Captions.** In the extension, the same fit rule must also treat Meet's captions band as a floor if that band overlaps the tile. The mockup has captions in a separate band, so this case does not arise there.

## 3. Frame mode (no face found)

Frame mode applies when the camera is off, an avatar is shown, a screen is being shared, or the tile is beyond the first 6 faces.

- **Halo signal.** A 2 px gold line along the top edge, spanning 12% to 88% of the width.
  - speaking: full opacity plus a 12 px glow
  - thinking: a light sweeps along the line every 1.3 s
  - reduced motion: a static dashed line
- **Avatar tiles.**
  - The name chip sits top-left, inset 10 px.
  - Pills stack bottom-left above Meet's label (bottom 34 px), with a max width of `min(340px, tile - 20px)`.
- **Screen share.** The share surface itself is a Frame-mode surface.
  - The presenter's name chip and pills go **top-right**, because slide titles usually sit top-left.
    - top: 42 px
    - right: 10 px
    - max width: `min(300px, 38%)`
  - The presenter's points **move** from their camera tile to the share, so each person has one stack.
  - The presenter's camera tile keeps its ring and name chip.

## 4. Glass material (one system)

Every Halo surface uses the same material: point chips, the name pill, `+N`, the badge, the toast, the point popover, the badge menu, the Setup panel and the consent dialog. There are two weights. Chips are small and sit on video. Popovers and panels are larger and hold more small text, so they get a darker tint.

| Token | Chip weight | Popover / panel weight |
|---|---|---|
| Tint under the blur | `--glass: rgba(16,18,22,.72)` (hover `rgba(16,18,22,.82)`) | `--glass-strong: rgba(16,18,22,.78)` |
| Backdrop | `--glass-fx: blur(16px) saturate(170%)` | `--glass-fx-lg: blur(24px) saturate(170%)` |
| Edge (inner highlight) | `--glass-edge: inset 0 1px 0 rgba(255,255,255,.14), inset 0 0 0 1px rgba(255,255,255,.08)`. No real borders | same |
| Shadow | `--glass-shadow: 0 4px 14px rgba(0,0,0,.18)` | `--glass-shadow-lg: 0 16px 40px rgba(0,0,0,.35)` |
| Radius | `--r-chip: 14px` (16 px on tiles of 900 px and up); name pill, badge and `+N` use 999 px | `--r-pop: 18px` popover and menu; `--r-panel: 20px` Setup panel and consent dialog |
| No backdrop-filter | `@supports not (backdrop-filter)`: a solid `--glass-solid: rgba(16,18,22,.9)` | same |

- **One accent.** Gold `#ffd98a` (`--halo`) is the only UI accent: focus ring, `UPDATED`, the speaking glow, the menu's "on" dot, the primary button and links. The 4 kind colours appear only on the kind mark.
- **Inside glass.** Fields and segmented controls are a lighter well, `rgba(255,255,255,.07)` with an inset 1 px `rgba(255,255,255,.1)` edge. Hover rows are `rgba(255,255,255,.07)`. Dividers are `rgba(255,255,255,.08)`.
- **Text.** Primary `#f5f7fa`, secondary `#cfd3da` (`--chip-sub`), ageing `#d5d9df`.
- **No sheen under text.** The highlight is an edge only, because a white gradient under the text would cost about 1.8:1 of contrast on bright video.

**Contrast.** This is computed, not eyeballed. The blur of a pure-white frame is still white, so white is the worst case. Over black, every value is above 8.7:1.

| Composite on pure white | Primary | Ageing | Secondary | Gold | Kind marks (non-text, need 3:1) |
|---|---|---|---|---|---|
| Chip `.72` -> `#535457` | 7.03 | 5.32 | 5.02 | 5.58 | point 4.16, question 5.23, decision 4.95, pushback 3.42 |
| Popover `.78` -> `#454649` | 8.79 | 6.66 | 6.28 | 6.98 | point 5.20, question 6.54, decision 6.19, pushback 4.28 |

## 4b. Point chips

| Property | Value |
|---|---|
| Material | Chip glass (section 4): radius 14 px, padding 7/12 px, gap 7 px |
| Text | `#f5f7fa`, 13 px / 1.35, weight 500. Arabic is 14 px / 1.5 in IBM Plex Sans Arabic (fallback Noto Sans Arabic, then Segoe UI). Every `[lang=ar]` element uses the Arabic stack. The Latin stack also lists IBM Plex Sans Arabic, so stray Arabic in English UI never falls back to an arbitrary system face |
| Contrast | See section 4. AA holds on any video |
| Lines | Max 2. Tiles under 320 px get 1 line, with an ellipsis, and 4 px vertical padding |
| Kind mark | One mark at the inline start, in the kind colour. A plain point gets a 6 px dot. A signal kind gets its glyph instead. It sits at the right in RTL. There is no side bar |
| Kind colours | point `#8ec5ff`, question `#ffd166`, decision `#6ee7b7`, pushback `#ff8f85` |
| Kind glyph | A 1.1 em inline SVG with a 2.2 px stroke: question mark, check (decision), return arrow (pushback, mirrored in RTL). The dot versus a glyph is the non-colour cue. The mark never dims, so it keeps 3:1 |
| Rank 1 | Only when the stack holds 2 or more points: a brighter glass edge (`inset 0 1px 0 rgba(255,255,255,.24)`, `inset 0 0 0 1px rgba(255,255,255,.18)`). No extra colour |
| Lifetime hairline | 1.5 px `rgba(255,255,255,.3)`, 3 px above the bottom, inset 12 px. `scaleX` = remaining life. JS writes it every frame on the hairline element only, never on the glass chip itself, so it freezes when paused. Its origin flips in RTL |
| Overflow | Points over the cap fold into a `+N` chip (11 px / 600, `#cfd3da`, chip glass, radius 999 px) at the end of the stack. The `+N` chip is built once per stack and toggled with `hidden`. It is not interactive |

**Size steps.** These are container queries on the tile width.

| Tile width | Text size (EN / AR) | Name chip | Points cap |
|---|---|---|---|
| under 300 px | 12 / 13 px | 11 px, role hidden under 320 px | 1 |
| 300 to 419 px | 12 / 13 px | 11 px | 2 |
| 420 to 480 px | 12 / 13 px | 11 px | 3 |
| 481 to 899 px | 13 / 14 px | 12 px | 3 |
| 900 px and up | 15 / 16 px | 14 px | 3 |

- The effective cap is `min(user density 1-3, width cap)`. The default user density is 3.
- **Rank.** The stack is ordered by Insight's rank. The mockup uses a stand-in: decision > pushback > question > point, then newest first.

## 5. Timings and states

| Event | Behaviour |
|---|---|
| Speaker starts | The ring or edge glows straight from Meet's speaking highlight, with 150 ms transitions |
| Speaker pauses | Thinking state, until the point lands (about 3 s typical, p90 under 4 s) |
| Point arrives | `--t-enter` 240 ms `cubic-bezier(.2,.7,.2,1)`: fade, scale .97 -> 1 and a 6 px slide from the face side (up 6 px in the strip or frame). No blur, because a `filter` on a `backdrop-filter` element glitches in Chromium. It is a one-shot Web Animation that plays when the chip first becomes visible. An `aria-live` announcement plays |
| Correction | Same id, same element, replaced in place: a `--t-fast` 160 ms text crossfade, a gold `UPDATED` / `مُحدَّث` tag (10 px) plus a glow on the kind mark for 4 s, and the lifetime restarts. The popover shows "Corrected HH:MM · from “…”" in the viewer's current language, bidi-isolated |
| Ageing | At 72% of its life, the text dims to `#d5d9df` (5.32:1 worst case). The kind mark stays at full strength |
| Expiry | 60 s live (the demo uses 22 s), then a `--t-exit` 400 ms fade plus scale to 0.96, then removal |
| Fold / unfold | The chip is hidden (`.fold`, `display:none`), never destroyed. A chip that unfolds later plays the entrance once, because it really appears |
| Reorder / surface move | The same element is moved. Nothing replays |
| Popover, menu, panel, dialog open | `--t-pop` 180 ms: fade plus scale .96 -> 1. The point popover grows out of its chip (transform-origin = chip centre, top edge when it opens below, bottom edge when above). The menu grows from the badge and the Setup panel from its top-right corner |

### Render rule (no flash)

- Each point owns one chip element, created the first time it is rendered and keyed by point id (`q.el`).
- A render only moves, reorders, folds or updates text and classes on chips that already exist.
- A chip is removed only when its point leaves the live set: it expired, or the demo loop reset.
- The `+N` chip, the Frame-mode edge, the name pill and the ring are built once per surface.
- Fit is measured from summed chip heights, never from live offsets, so a chip still fading out cannot push others into a fold.
- The per-frame lifetime write goes to the hairline child, not the glass chip.

These rules fix the flash Karim saw. Before, `render()` made new chips just to measure them and threw away the ones that did not fit. A point that folded was destroyed (faded out), then rebuilt with a fresh entrance on a later render. Exiting chips stayed in the flow and skewed the next fit, and the `+N` chip was removed and re-appended on every render. One example: at 31.2 s, Omar's "Sandbox fix" appeared, faded out 0.4 s later, and "Ship Apple Pay…" popped in 3.4 s late.

## 6. Language and the original quote

- The viewer's language defaults to English. In Arabic, a pill gets `lang=ar dir=rtl`, the Arabic font and +1 px of size. Its side and order stay the same.
- Clicking or pressing Enter on a pill opens a popover with:
  - the kind (icon and label)
  - the speaker and the meeting timestamp
  - the translated text
  - the **original quote** in a blockquote (a lighter glass well, radius 12 px, no side border). Its base direction is set by the majority script, so a mostly-Arabic, code-switched line reads RTL even when it starts with an English word
  - the correction history ("Corrected HH:MM · from “…”")
  - "shown N s after pause"
  - **Open in notes**, which goes to the transcript line and the recording moment
- It is a glass card: popover weight (section 4), radius 18 px, padding 16/18 px, width `min(340px, 100vw - 24px)`. It enters in 180 ms (section 5).
- The popover uses the native popover API, so Esc and light dismiss (a click outside) both close it. Esc returns focus to the pill. Focus moves into the card, so Tab reaches "Open in notes".
- It opens below the pill, or above it if it would reach Meet's captions band or bottom bar. It never covers them.

## 7. Badge, consent, recording and controls

All of these surfaces use the same glass (section 4):

- **Chip weight.** The badge (radius 999 px) and the toast (radius 14 px).
- **Popover weight.** The badge menu (radius 18 px, rows radius 12 px), the Setup panel (radius 20 px) and the consent dialog (radius 20 px, `::backdrop` `rgba(0,0,0,.35)`).
- **Buttons.** Primary buttons are the gold accent with `#1b1608` text. Secondary buttons are `rgba(255,255,255,.08)` pills.

### Badge

- Always visible at the top-left of the stage while Halo is active.
- It shows:
  - the halo logo
  - "Halo"
  - a pulsing red `REC` while the Recorder is on (video is kept 7 days)
  - an eye toggle
- When overlays are hidden, the badge **stays** and reads `Halo · hidden`.

### Badge menu

The menu holds:

- Hide/show overlays (`Alt+H`)
- Points language EN/AR
- Points per face 1-3
- Meeting setup…
- Post consent notice to Meet chat
- Recorder switch ("video kept 7 days, then deleted")
- Open meeting notes
- A privacy line: "No face images are saved. Halo never infers emotion or personality."

### Consent

- The menu item opens an **editable** dialog, prefilled with a bilingual notice. The notice covers:
  - transcription
  - the 7-day video
  - notes kept until deleted
  - the free-credit provider-use line
  - that anyone can ask to pause
- Nothing posts until the user presses **Post to chat**.
- After posting, the menu shows "Posted HH:MM · post again".

### Alt+H

- Toggles all tile layers (opacity and visibility, 250 ms).
- Only bare Alt+H counts, and key repeat is ignored. Ctrl+Alt+H (Cmd+Ctrl+H on Mac) is Meet's raise-hand shortcut, so it passes through untouched.
- Halo keeps running while the layers are hidden.

### Toasts

- Halo's confirmations ("Context saved", "Overlays hidden") hang under the badge at the top-left of the stage for 2.8 s.
- They never sit over Meet's captions or bottom bar.

### Setup panel

- Docks in Meet's 360 px side-panel slot. It is never a modal and never sits over the bottom bar.
- It contains:
  - Subject
  - Agenda (one item per line)
  - An optional role per participant
  - "My points language"
- "Save context" emits `meeting.context`.

## 8. Accessibility

- Pills are native `<button>`s in tab order. Each has the label `"Name, Kind: text. Show original quote"`.
- If a focused pill expires or folds into `+N`, focus moves to the Halo badge instead of being lost.
- The badge's accessible name carries its state, for example "Halo is on, recording (video kept 7 days), overlays hidden. Open Halo menu".
- The focus ring is a 2 px `#ffd98a` outline with a 2 px offset.
- An `aria-live="polite"` region announces new and updated points. Its `lang` follows the viewer's language.
- `prefers-reduced-motion`:
  - turns off slides, scale-ins, breathing, shimmer and sweeps. CSS animations and transitions are switched off globally, and the chip and popover Web Animations check `matchMedia('(prefers-reduced-motion: reduce)')` and skip
  - makes the thinking state static (a dotted ring or a dashed edge)
  - keeps the lifetime hairline shrinking, since that is not vestibular motion
- All chip and popover text meets WCAG AA on a pure white background (computed in section 4). The `backdrop-filter` fallback is more opaque, so it only raises contrast.

## 9. Privacy guardrails (UI)

- The face box is never drawn and never stored. No face crops are saved.
- Camera-off tiles use Meet's own initial avatar.
- The UI makes no emotion or personality inference anywhere.

## Open questions for Karim

1. **Badge location.**
   - Option A: float it top-left over the stage (the mockup).
   - Option B: inject it into the empty left area of Meet's bottom bar (variant B).

   B is more discoverable, but more fragile against Meet DOM changes. Pick one for the Meet Adapter.
2. **Screen-share points.** Should the presenter's points move to the share surface (now the rule), or stay on their camera tile?
3. **Rank source.** Does Insight send an explicit rank, or should the overlay keep the kind order decision > pushback > question > point?
4. **Kind label text.** Is the icon plus colour enough? Variant B also printed a small-caps label ("PUSHBACK"), which is easier to read in a demo video but adds reading load.
5. **Thinking state.** Keep the subtle ring light, or also show variant B's dashed ghost card in the stack, which is more visible for judges?
6. **Consent notice wording.** Is the bilingual text (including the free-credit provider-use line) final? Should Halo nudge the user if no notice has been posted after N minutes?
7. **Captions.** Should the overlay read Meet's captions-band rectangle (from the Meet Adapter) to keep stacks above it, or just reserve a fixed bottom margin when captions are on?
8. **More than 6 tiles.** Do Frame-mode tiles in a big grid still show pills, or only the edge glow plus `+N`, to cut noise?
9. **Real Meet DOM.** The day-0 meet-overlay probe must confirm that tile rectangles and the speaking highlight are readable. All of the geometry above assumes they are.
