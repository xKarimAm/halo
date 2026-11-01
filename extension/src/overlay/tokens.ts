// Tokens from docs/ui/overlay-mix-b.html (the only token source): smoked
// glass + Aurora hue, kind discs are solid colour, black glyph, 1.5px ring.
export const KIND_COLORS = {
  point: "#8ecbf5",
  question: "#c3a8ff",
  decision: "#7fdcc0",
  pushback: "#ffb199",
} as const;

// Live 2026-11-01 (Karim): colour means urgency only (red / amber / blue,
// the usual severity order); kind is a glyph on a neutral disc.
export const URGENCY_COLORS = { urgent: "#ff4d5e", medium: "#f5b301", later: "#5aa9ff" } as const;
export const KIND_GLYPHS = { point: "•", question: "?", decision: "✓", pushback: "≠" } as const;

export const DARK = "#0b0f1a";
// The one UI accent (OVERLAY-UX section 4): primary button, links, focus ring.
export const HALO_GOLD = "#ffd98a";
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
.halo-utab.halo-u-urgent{background:${URGENCY_COLORS.urgent}}
.halo-utab.halo-u-medium{background:${URGENCY_COLORS.medium}}
.halo-utab.halo-u-later{background:${URGENCY_COLORS.later}}
.halo-useal{position:absolute;top:-6px;inset-inline-end:6px;width:${URGENCY_SEAL_PX}px;height:${URGENCY_SEAL_PX}px;display:grid;place-items:center;font:900 9px/1 Inter,system-ui,sans-serif;color:${DARK};z-index:1}
.halo-useal.halo-u-urgent{background:${URGENCY_COLORS.urgent};clip-path:polygon(50% 0,100% 100%,0 100%)}
.halo-useal.halo-u-medium{background:${URGENCY_COLORS.medium};border-radius:50%}
.halo-useal.halo-u-later{background:${URGENCY_COLORS.later};border-radius:3px}
.halo-kind{flex:none;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.92);color:${DARK};font:800 11px/1 Inter,system-ui,sans-serif;box-shadow:0 0 0 1.5px ${DARK}}
.halo-chip-urgent{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.urgent}}
.halo-chip-medium{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.medium}}
.halo-chip-later{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.later}}
.halo-legend{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;padding:10px 12px;border-radius:14px;background:rgba(16,18,22,.86);backdrop-filter:blur(24px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.halo-legend .halo-swatch{width:12px;height:12px;border-radius:3px}
.halo-pop-actions{display:flex;gap:8px;margin-top:10px}
.halo-aged{color:#d5d9df}
.halo-thinking{animation:halo-sweep 1.3s linear infinite}
.halo-thinking-dotted{border-bottom:2px dotted #fff3d1}
@media (prefers-reduced-motion:reduce){.halo-thinking{animation:none}}
.halo-controls{position:fixed;top:12px;left:12px;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:calc(100vw - 24px);font:500 12px/1.25 Inter,system-ui,sans-serif;color:#f5f7fa}
.halo-badge,.halo-controls .halo-btn,.halo-toast{background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR};box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 0 1px rgba(255,255,255,.08)}
.halo-badge{padding:5px 12px;border-radius:999px;font-weight:600}
.halo-btn{padding:5px 12px;border:0;border-radius:999px;background:rgba(255,255,255,.08);color:#f5f7fa;font:inherit;cursor:pointer}
.halo-btn.halo-primary{background:${HALO_GOLD};color:#1b1608}
.halo-toast{flex-basis:100%;display:flex;align-items:center;gap:10px;width:max-content;max-width:100%;padding:8px 8px 8px 12px;border-radius:14px}
.halo-toast[hidden]{display:none}
.halo-toast a{color:${HALO_GOLD}}
.halo-dismiss{border:0;background:none;color:#cfd3da;font:inherit;font-size:16px;line-height:1;cursor:pointer}
.halo-dialog{width:min(440px,calc(100vw - 24px));box-sizing:border-box;padding:16px 18px;border:0;border-radius:20px;background:rgba(16,18,22,.78);backdrop-filter:blur(24px) saturate(170%);box-shadow:0 16px 40px rgba(0,0,0,.35);color:#f5f7fa;font:500 13px/1.4 Inter,system-ui,sans-serif}
.halo-dialog::backdrop{background:rgba(0,0,0,.35)}
.halo-dialog h2{margin:0 0 6px;font-size:15px}
.halo-dialog p{margin:0 0 10px;color:#cfd3da}
.halo-notice{display:block;box-sizing:border-box;width:100%;padding:10px;border:0;border-radius:12px;background:rgba(255,255,255,.07);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);color:#f5f7fa;font:inherit;resize:vertical}
.halo-dialog .halo-copy-status{margin:8px 0 0;min-height:1.4em;color:${HALO_GOLD}}
.halo-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.halo-lang{padding:5px 10px;border:0;border-radius:999px;background:rgba(12,14,18,.66);backdrop-filter:${GLASS_BLUR};box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);color:#f5f7fa;font:inherit;cursor:pointer}
.halo-lang option{background:#16181d;color:#f5f7fa}
.halo-popover{position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:16px 18px;border-radius:18px;background:rgba(16,18,22,.78);backdrop-filter:blur(24px) saturate(170%);box-shadow:0 16px 40px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.08);color:#f5f7fa;font:500 12px/1.4 Inter,system-ui,sans-serif;animation:halo-pop-in 180ms ease-out}
@keyframes halo-pop-in{from{opacity:0;transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){.halo-popover{animation:none}}
.halo-chip *{pointer-events:none}
.halo-popover[hidden]{display:none}
.halo-popover p{margin:0 0 6px}
.halo-popover .halo-pop-head{color:#cfd3da;font-weight:600}
.halo-popover blockquote{margin:0;padding:8px 12px;border-radius:12px;background:rgba(255,255,255,.07);font-size:13px}
.halo-popover blockquote[lang=ar]{font-size:14px}
.halo-controls :focus-visible,.halo-dialog :focus-visible,.halo-popover:focus-visible,.halo-popover :focus-visible{outline:2px solid ${HALO_GOLD};outline-offset:2px}
`;
