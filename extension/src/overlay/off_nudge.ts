// "Halo is off" nudge (Karim 2026-11-04): in a Meet call with Halo not
// running, a small toast under the Halo badge says so, once per call.
// Two cases: Halo never started (after a short delay, so a quick Start
// is never nagged), and Halo stopped mid-call (at once).

/** Time in a call before "Halo is off" shows. */
export const OFF_NUDGE_DELAY_MS = 20_000;

export type NudgeKind = "off" | "stopped";

export interface OffNudge {
  setInCall(inCall: boolean): void;
  setRunning(running: boolean): void;
  /** "Not this call": quiet until the next call. */
  dismiss(): void;
}

export function createOffNudge(
  deps: { show: (kind: NudgeKind) => void; hide: () => void },
  delayMs = OFF_NUDGE_DELAY_MS,
): OffNudge {
  let inCall = false;
  let running = false;
  let ranThisCall = false;
  let dismissed = false;
  let visible = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stopTimer = () => { clearTimeout(timer); timer = undefined; };
  const show = (kind: NudgeKind) => {
    if (dismissed || visible) return;
    visible = true;
    deps.show(kind);
  };
  const hide = () => {
    stopTimer();
    if (!visible) return;
    visible = false;
    deps.hide();
  };
  const arm = () => {
    if (!inCall || running || dismissed || visible || timer) return;
    timer = setTimeout(() => { timer = undefined; if (inCall && !running) show("off"); }, delayMs);
  };

  return {
    setInCall(next) {
      if (next === inCall) return;
      inCall = next;
      if (inCall) arm();
      else { hide(); ranThisCall = false; dismissed = false; }
    },
    setRunning(next) {
      if (next === running) return;
      running = next;
      if (running) { ranThisCall = inCall || ranThisCall; hide(); return; }
      if (inCall && ranThisCall) show("stopped");
      else arm();
    },
    dismiss() {
      dismissed = true;
      hide();
    },
  };
}

const COPY: Record<NudgeKind, string> = {
  off: "Halo is off for this call.",
  stopped: "Halo stopped. This call is no longer noted.",
};

/**
 * The toast itself, inside the Halo controls bar (top centre) when it is
 * there. `onStart` asks the extension to open its setup panel; when it
 * cannot, the toast says where the Start button is instead.
 */
export function mountOffNudge(
  doc: Document,
  actions: { onStart: () => Promise<boolean>; onDismiss: () => void },
): { show: (kind: NudgeKind) => void; hide: () => void } {
  const box = doc.createElement("div");
  box.className = "halo-toast halo-nudge";
  box.setAttribute("role", "status");
  box.hidden = true;
  const text = doc.createElement("span");
  const start = doc.createElement("button");
  start.type = "button";
  start.className = "halo-btn halo-primary";
  start.textContent = "Start Halo";
  const later = doc.createElement("button");
  later.type = "button";
  later.className = "halo-btn";
  later.textContent = "Not this call";
  box.append(text, start, later);
  (doc.querySelector(".halo-controls") ?? doc.body).append(box);

  start.addEventListener("click", () => {
    void actions.onStart().then((opened) => {
      if (opened) return;
      text.textContent = "Click the Halo icon in the toolbar, then Start.";
      start.hidden = true;
    });
  });
  later.addEventListener("click", () => actions.onDismiss());

  return {
    show(kind) {
      text.textContent = COPY[kind];
      start.hidden = false;
      box.hidden = false;
    },
    hide() { box.hidden = true; },
  };
}
