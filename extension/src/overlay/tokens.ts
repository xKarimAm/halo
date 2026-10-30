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
export const POINT_LIFETIME_MS = 60_000;
export const AGEING_FRACTION = 0.72;

export const OVERLAY_CSS = `
.halo-name{position:absolute;font:500 12px/1.25 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:999px;color:rgba(255,255,255,.9);background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR}}
.halo-stack{position:absolute;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.halo-chip{display:flex;align-items:center;gap:6px;padding:5px 9px 5px 6px;border-radius:9px;font:500 12px/1.25 Inter,system-ui,sans-serif;color:#fff;background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR};cursor:pointer}
.halo-kind{flex:none;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;color:${DARK};box-shadow:0 0 0 1.5px ${DARK}}
.halo-aged{color:#d5d9df}
.halo-thinking{animation:halo-sweep 1.3s linear infinite}
.halo-thinking-dotted{border-bottom:2px dotted #fff3d1}
@media (prefers-reduced-motion:reduce){.halo-thinking{animation:none}}
`;
