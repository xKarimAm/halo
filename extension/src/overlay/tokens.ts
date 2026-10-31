// Tokens from docs/ui/overlay-mix-b.html (the only token source): smoked
// glass + Aurora hue, kind discs are solid colour, black glyph, 1.5px ring.
export const KIND_COLORS = {
  point: "#8ecbf5",
  question: "#c3a8ff",
  decision: "#7fdcc0",
  pushback: "#ffb199",
} as const;

export const DARK = "#0b0f1a";
export const GLASS_BLUR = "blur(16px) saturate(140%) brightness(.85)";

// Urgency-mark geometry: words tabs from urgency draft 2, symbol seals from
// draft 1 scaled ~25% down (19px -> 14px). Tabs sit fused on the chip's top
// edge; seals ride the chip's top inline-end corner. Logical insets keep both
// correct in RTL.
export const URGENCY_TAB_FONT_PX = 9;
export const URGENCY_SEAL_PX = 14;
export const POINT_LIFETIME_MS = 60_000;
export const AGEING_FRACTION = 0.72;

export const OVERLAY_CSS = `
.halo-name{position:absolute;font:500 12px/1.25 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:999px;color:rgba(255,255,255,.9);background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR}}
.halo-stack{position:absolute;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.halo-chip{position:relative;display:flex;align-items:center;gap:6px;padding:5px 9px 5px 6px;border-radius:9px;font:500 12px/1.25 Inter,system-ui,sans-serif;color:#fff;background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR};cursor:pointer}
.halo-utab{position:absolute;top:-9px;inset-inline-start:10px;padding:1px 7px;border-radius:9px 9px 0 0;font:700 ${URGENCY_TAB_FONT_PX}px/1.5 Inter,system-ui,sans-serif;letter-spacing:.06em;color:${DARK};z-index:1}
.halo-utab.halo-u-urgent{background:#ff3b5c}
.halo-utab.halo-u-medium{background:#f5b301}
.halo-utab.halo-u-later{background:#aab0b8}
.halo-useal{position:absolute;top:-6px;inset-inline-end:6px;width:${URGENCY_SEAL_PX}px;height:${URGENCY_SEAL_PX}px;display:grid;place-items:center;font:900 9px/1 Inter,system-ui,sans-serif;color:${DARK};z-index:1}
.halo-useal.halo-u-urgent{background:#ff3b5c;clip-path:polygon(50% 0,100% 100%,0 100%)}
.halo-useal.halo-u-medium{background:#f5b301;border-radius:50%}
.halo-useal.halo-u-later{border:2px solid #aab0b8}
.halo-kind{flex:none;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;color:${DARK};box-shadow:0 0 0 1.5px ${DARK}}
.halo-aged{color:#d5d9df}
.halo-thinking{animation:halo-sweep 1.3s linear infinite}
.halo-thinking-dotted{border-bottom:2px dotted #fff3d1}
@media (prefers-reduced-motion:reduce){.halo-thinking{animation:none}}
`;
