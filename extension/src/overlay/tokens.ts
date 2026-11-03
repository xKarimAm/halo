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
export const GLASS_BLUR = "blur(18px) saturate(180%) brightness(1.05)";
// Karim 2026-11-02: lighter, slightly luminous glass (iPhone-like, not
// milky) with a light hairline edge instead of the near-black fill.
const GLASS = `background:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,.06)),rgba(30,34,44,.42);backdrop-filter:${GLASS_BLUR};-webkit-backdrop-filter:${GLASS_BLUR};box-shadow:inset 0 0 0 1px rgba(255,255,255,.2),inset 0 1px 0 rgba(255,255,255,.3),0 4px 14px rgba(0,0,0,.16)`;
const PANEL = `background:linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,.05)),rgba(22,26,34,.72);backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.16),0 12px 32px rgba(0,0,0,.28)`;

// Urgency-mark geometry: words tabs from urgency draft 2, symbol seals from
// draft 1 scaled ~25% down (19px -> 14px). Tabs sit fused on the chip's top
// edge; seals ride the chip's top inline-end corner. Logical insets keep both
// correct in RTL.
export const URGENCY_TAB_FONT_PX = 9;
export const URGENCY_SEAL_PX = 14;
export const POINT_LIFETIME_MS = 60_000;
export const AGEING_FRACTION = 0.72;

export const OVERLAY_CSS = `
.halo-name{position:absolute;font:500 12px/1.25 Inter,system-ui,sans-serif;padding:4px 10px;border-radius:999px;color:#fff;${GLASS}}
.halo-stack{position:absolute;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.halo-tail-l .halo-chip::before,.halo-tail-r .halo-chip::before{content:"";position:absolute;top:50%;width:6px;height:10px;margin-top:-5px;background:rgba(30,34,44,.55)}
.halo-tail-l .halo-chip::before{left:-6px;clip-path:polygon(100% 0,0 50%,100% 100%)}
.halo-tail-r{align-items:flex-end}.halo-tail-r .halo-chip::before{right:-6px;clip-path:polygon(0 0,100% 50%,0 100%)}
.halo-caption{max-width:300px;margin-bottom:4px;padding:5px 10px;border-radius:9px;font:500 13px/1.35 Inter,system-ui,sans-serif;color:#fff;${GLASS}}
.halo-chip{position:relative;display:flex;align-items:center;gap:6px;padding:5px 9px 5px 6px;border-radius:9px;font:500 12px/1.25 Inter,system-ui,sans-serif;color:#fff;${GLASS};border:0;cursor:pointer}
.halo-more{pointer-events:auto;align-self:flex-start;padding:3px 10px;border:0;border-radius:999px;font:600 11px/1.4 Inter,system-ui,sans-serif;color:#eef1f5;cursor:pointer;${GLASS}}
.halo-utab{position:absolute;top:-9px;inset-inline-start:10px;padding:1px 7px;border-radius:9px 9px 0 0;font:700 ${URGENCY_TAB_FONT_PX}px/1.5 Inter,system-ui,sans-serif;letter-spacing:.06em;color:${DARK};z-index:1}
.halo-utab.halo-u-urgent{background:${URGENCY_COLORS.urgent}}
.halo-utab.halo-u-medium{background:${URGENCY_COLORS.medium}}
.halo-utab.halo-u-later{background:${URGENCY_COLORS.later}}
.halo-useal{position:absolute;top:-6px;inset-inline-end:6px;width:${URGENCY_SEAL_PX}px;height:${URGENCY_SEAL_PX}px;display:grid;place-items:center;font:900 9px/1 Inter,system-ui,sans-serif;color:${DARK};z-index:1}
.halo-useal.halo-u-urgent{background:${URGENCY_COLORS.urgent};clip-path:polygon(50% 0,100% 100%,0 100%)}
.halo-useal.halo-u-medium{background:${URGENCY_COLORS.medium};border-radius:50%}
.halo-useal.halo-u-later{background:${URGENCY_COLORS.later};border-radius:3px}
.halo-kind{flex:none;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.92);color:${DARK};font:800 11px/1 Inter,system-ui,sans-serif;box-shadow:0 0 0 1px rgba(255,255,255,.45)}
.halo-chip-urgent{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.urgent},inset 0 0 0 1px rgba(255,255,255,.2),inset 0 1px 0 rgba(255,255,255,.3),0 4px 14px rgba(0,0,0,.16)}
.halo-chip-medium{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.medium},inset 0 0 0 1px rgba(255,255,255,.2),inset 0 1px 0 rgba(255,255,255,.3),0 4px 14px rgba(0,0,0,.16)}
.halo-chip-later{box-shadow:inset 3px 0 0 ${URGENCY_COLORS.later},inset 0 0 0 1px rgba(255,255,255,.2),inset 0 1px 0 rgba(255,255,255,.3),0 4px 14px rgba(0,0,0,.16)}
.halo-menu{display:flex;flex-direction:column;gap:12px;width:max-content;padding:12px 14px;border-radius:16px;${PANEL}}
.halo-menu[hidden]{display:none}
.halo-menu:not([hidden]){animation:halo-pop-in 180ms cubic-bezier(.22,1,.36,1);transform-origin:top center}
.halo-legend{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center}
.halo-legend .halo-swatch{width:12px;height:12px;border-radius:3px}
.halo-pop-actions{display:flex;gap:8px;margin-top:10px}
.halo-aged{color:#d5d9df}
.halo-thinking{animation:halo-sweep 1.3s linear infinite}
.halo-thinking-dotted{border-bottom:2px dotted #fff3d1}
@media (prefers-reduced-motion:reduce){.halo-thinking{animation:none}}
/* Top centre: Meet's clock and meeting code sit top-left (live 2026-11-02). */
.halo-controls{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;flex-direction:column;align-items:center;gap:8px;max-width:calc(100vw - 24px);font:500 12px/1.25 Inter,system-ui,sans-serif;color:#f5f7fa}
.halo-badge,.halo-controls .halo-btn,.halo-toast{${GLASS}}
.halo-badge{padding:5px 12px;border:0;border-radius:999px;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.halo-btn{padding:5px 12px;border:0;border-radius:999px;background:rgba(255,255,255,.08);color:#f5f7fa;font:inherit;cursor:pointer}
.halo-btn.halo-primary{background:${HALO_GOLD};color:#1b1608}
.halo-toast{display:flex;align-items:center;gap:10px;width:max-content;max-width:100%;padding:8px 8px 8px 12px;border-radius:14px}
.halo-toast[hidden]{display:none}
.halo-toast a{color:${HALO_GOLD}}
.halo-nudge .halo-btn{padding:4px 10px}
@media (prefers-reduced-motion:no-preference){.halo-nudge:not([hidden]){animation:halo-nudge-in 320ms cubic-bezier(.22,1,.36,1) both}}
@keyframes halo-nudge-in{from{opacity:0;transform:translateY(-6px)}}
.halo-dismiss{border:0;background:none;color:#cfd3da;font:inherit;font-size:16px;line-height:1;cursor:pointer}
/* Coach: left edge, vertically centred, clear of Meet's tiles' name pills. */
.halo-coach{position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:2147483647;width:min(260px,calc(100vw - 24px));box-sizing:border-box;padding:10px 12px 12px;border-radius:16px;${PANEL};color:#f5f7fa;font:500 12px/1.4 Inter,system-ui,sans-serif;pointer-events:auto}
.halo-coach[hidden]{display:none}
.halo-coach-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-weight:600;letter-spacing:.02em;color:${HALO_GOLD}}
.halo-coach-alert{margin:0 0 8px;padding:6px 9px;border-radius:9px;background:${URGENCY_COLORS.urgent};color:#fff;font-weight:700;font-size:13px}
.halo-coach-alert[hidden]{display:none}
.halo-coach ul{margin:0;padding-inline-start:16px;display:flex;flex-direction:column;gap:6px}
.halo-coach :focus-visible{outline:2px solid ${HALO_GOLD};outline-offset:2px}
.halo-lang{align-self:flex-start;padding:5px 10px;border:0;border-radius:999px;${GLASS};color:#f5f7fa;font:inherit;cursor:pointer}
.halo-lang option{background:#16181d;color:#f5f7fa}
.halo-popover{position:fixed;z-index:2147483647;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:16px 18px;border-radius:18px;background:rgba(16,18,22,.78);backdrop-filter:blur(24px) saturate(170%);box-shadow:0 16px 40px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.08);color:#f5f7fa;font:500 12px/1.4 Inter,system-ui,sans-serif;animation:halo-pop-in 180ms ease-out}
@keyframes halo-pop-in{from{opacity:0;transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){.halo-menu,.halo-popover{animation:none}}
.halo-chip *{pointer-events:none}
.halo-popover[hidden]{display:none}
.halo-popover p{margin:0 0 6px}
.halo-popover .halo-pop-head{color:#cfd3da;font-weight:600}
.halo-popover blockquote{margin:0;padding:8px 12px;border-radius:12px;background:rgba(255,255,255,.07);font-size:13px}
.halo-popover blockquote[lang=ar]{font-size:14px}
.halo-controls :focus-visible,.halo-popover:focus-visible,.halo-popover :focus-visible{outline:2px solid ${HALO_GOLD};outline-offset:2px}
`;
