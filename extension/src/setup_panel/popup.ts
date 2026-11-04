import type { PortMeetingContext } from "../../../contracts/ext/port";
import {
  buildMeetingContext,
  mergeTileNames,
  type RoleRow,
  type SetupForm,
} from "./context";
import { PairingError, pairWithCode } from "./pairing";
import type { MicState, SavedSetup, SetupStorage, UrgencyStyle, ViewMode } from "./storage";
import type { StartResult } from "./start_target";

/** Minimal Port to the hub: the hub wraps the payload in an envelope. */
export interface PopupPort {
  postMessage(message: PortMeetingContext): void;
}

export interface PopupDeps {
  storage: SetupStorage;
  /** Port to the hub; Save posts one `meeting.context` on it. */
  port: PopupPort;
  /** Current participant names for role prefill (hub's `halo/tileNames`). */
  listParticipants: () => string[] | Promise<string[]>;
  /**
   * Hub_capture's capture handoff, called once per Start (the user gesture
   * Chrome needs for tabCapture). A refusal or capture warning comes back
   * as the result and is shown under the Start button.
   */
  onStart: () => StartResult | Promise<StartResult> | void;
  /** True while a Start is still live: Start then shows Running and ignores presses. */
  meetingRunning?: () => Promise<boolean>;
  /** True when the active tab is a Meet call (drives "Ready for meeting"). */
  onMeetCall?: () => Promise<boolean>;
  /** Live `halo.micState` updates (the Meet tab writes it when the mic opens). */
  watchMicState?: (onChange: (state: MicState, label?: string) => void) => void;
  /** Ends the running meeting; the Stop button exists only when this is given. */
  onStop?: () => void | Promise<void>;
  pairFn?: (code: string) => Promise<string>;
  /** True when the local Halo app answers (`/healthz`). Absent: assumed up. */
  checkBackend?: () => Promise<boolean>;
  /** Automatic pairing (`POST /pair/auto`). Absent or refused: the 6-digit code shows. */
  autoPair?: () => Promise<string>;
  /** Defaults to navigator.clipboard (tests pass a fake). */
  clipboard?: { writeText(text: string): unknown };
}

/** Pasted into Meet chat by the user at the start (DECISIONS 10). Karim
 * 2026-11-02: lives here beside Start, no longer on the Meet overlay. */
export const CONSENT_NOTICE =
  "Halo is recording and transcribing this meeting on this PC to show live points and notes. " +
  "Recordings and notes stay on this PC until deleted. / " +
  "يقوم Halo بتسجيل هذا الاجتماع ونسخه على هذا الجهاز لعرض النقاط والملاحظات المباشرة. " +
  "تبقى التسجيلات والملاحظات على هذا الجهاز حتى يتم حذفها.";

function el(tag: string, attrs: Record<string, string> = {}, text = ""): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  node.textContent = text;
  return node;
}

function field(container: HTMLElement, labelText: string, input: HTMLElement): void {
  const label = el("label", { class: "f" }, labelText);
  label.appendChild(input);
  container.appendChild(label);
}

/** A section card: a title row, then its body. */
function card(id: string, title: HTMLElement): { card: HTMLElement; head: HTMLElement } {
  const node = el("section", { id, class: "card glass" });
  const head = el("div", { class: "head" });
  head.append(title);
  node.appendChild(head);
  return { card: node, head };
}

/** Stable per-person hue for the initial avatar (same name, same colour). */
function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * Button feedback, one shape for every button: "busy" shows a spinner and
 * ignores presses, "done" shows the success look, "idle" is pressable.
 * The state lives in data-state (styled in entrypoints/popup/style.css).
 */
type ButtonState = "idle" | "busy" | "done";
function setButton(button: HTMLButtonElement, state: ButtonState, label: string): void {
  button.dataset.state = state;
  button.textContent = label;
  button.disabled = state !== "idle";
  button.setAttribute("aria-busy", String(state === "busy"));
}

/** Shows a short-lived confirmation ("Saved ✓") on an element, then hides it. */
function flash(node: HTMLElement, text: string, ms = 1500): void {
  node.textContent = text;
  node.removeAttribute("hidden");
  setTimeout(() => node.setAttribute("hidden", "true"), ms);
}

export function micStatusText(state: SavedSetup["micState"], label?: string): string {
  // Chrome labels read "Microphone (Arctis Nova Pro Wireless) (1038:12e0)": keep the name.
  const name = (label ?? "").replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").replace(/^Microphone \((.*)\)$/, "$1").trim();
  if (state === "granted") return name ? `Microphone: ${name}` : "Microphone: ready";
  if (state === "denied") return "Microphone: blocked in Meet, tab audio only";
  return "Microphone: starts with Start";
}

/**
 * Boot the toolbar popup (Karim 2026-11-04: sections, not steps). A status
 * pill on top; This call (Start) first; Meeting topic (optional,
 * folds to its subject); Preferences (save on change); Pair again in the
 * footer. Pairing is automatic when the Halo app answers; the 6-digit code
 * shows only when that is missing or refused. Busy, done and error states
 * on every button. Start is
 * idempotent: once running it shows Running and further presses do
 * nothing. "Copy consent notice" beside Start puts the notice on the
 * clipboard for Meet chat; nothing automates Meet chat.
 */
export async function initPopup(root: HTMLElement, deps: PopupDeps): Promise<void> {
  const saved: SavedSetup = await deps.storage.load();
  const pairFn = deps.pairFn ?? pairWithCode;
  const [participants, runningAtOpen, onMeetCall] = await Promise.all([
    deps.listParticipants(),
    deps.meetingRunning?.().catch(() => false) ?? false,
    deps.onMeetCall?.().catch(() => true) ?? true,
  ]);

  let rows: RoleRow[] = mergeTileNames(
    (saved.context?.roles ?? []).map((role) => ({ name: role.name, role: role.role ?? "" })),
    participants,
  );
  if (rows.length === 0) {
    rows = [{ name: "", role: "" }];
  }

  let paired = Boolean(saved.token);
  let savedOnce = Boolean(saved.context);
  let running = runningAtOpen;
  let micState = saved.micState;
  let micLabel = saved.micLabel;
  let backendUp: boolean | undefined; // undefined: not checked (no checkBackend)
  let connecting = false;
  let autoRefused = false;
  let changing = false; // Pair again asked for the code
  const header = el("header", { class: "top" });
  const logo = el("h1", { class: "logo" }, "Halo");
  logo.prepend(el("i"));
  const conn = el("span", { id: "conn", class: "pill", role: "status" });
  header.append(logo, el("span", { class: "sp" }), conn);
  root.append(header);

  // Pairing: only shown when something is needed (app down, or a code).
  const pairSection = el("section", { id: "pair-section", class: "card glass" });
  const downNote = el("div", { class: "down" });
  downNote.append(
    el("b", {}, "The Halo app isn't running"),
    el("p", { class: "tiny" }, "Open a terminal in the Halo folder and run:"),
    el("code", {}, "uv run halo"),
  );
  const retryButton = el("button", { id: "retry", type: "button", class: "btn" }) as HTMLButtonElement;
  setButton(retryButton, "idle", "Try again");
  downNote.appendChild(retryButton);
  const pairPrompt = el("p", { class: "tiny" });
  const pairForm = el("div", { class: "row" });
  const codeInput = el("input", {
    id: "pair-code",
    class: "in",
    inputmode: "numeric",
    maxlength: "6",
    placeholder: "6-digit code",
    "aria-label": "Pairing code",
  }) as HTMLInputElement;
  const pairButton = el("button", { id: "pair-btn", type: "button", class: "btn" }) as HTMLButtonElement;
  setButton(pairButton, "idle", "Pair");
  pairForm.append(codeInput, pairButton);
  const pairError = el("p", { id: "pair-error", class: "err", role: "alert", hidden: "true" });
  pairSection.append(downNote, pairPrompt, pairForm, pairError);
  root.appendChild(pairSection);

  // This call: readiness, mic, Start / Stop, consent.
  const { card: startSection } = card("start-section", el("b", { class: "title" }, "This call"));
  const readyState = el("p", { id: "ready-state", class: "ready", role: "status" });
  const micLine = el("p", { id: "mic-state", class: "tiny" });

  // Meeting topic: optional. A saved meeting folds to its subject.
  const formTitle = el("div", { class: "title" });
  const formSummary = el("span", { class: "tiny" });
  formTitle.append(el("b", {}, "Meeting topic"), formSummary);
  const { card: form, head: formHead } = card("meeting-form", formTitle);
  const saveState = el("span", { id: "save-state", class: "ok", role: "status", hidden: "true" });
  const editButton = el("button", { id: "meeting-edit", type: "button", class: "link" }, "Edit") as HTMLButtonElement;
  formHead.append(el("span", { class: "sp" }), saveState, editButton);
  let editing = false;

  const subjectInput = el("input", { id: "subject", class: "in" }) as HTMLInputElement;
  subjectInput.value = saved.context?.subject ?? "";

  // Footer: which computer this is paired with, and Pair again.
  const footer = el("footer", { class: "foot" });
  const pairState = el("b", { id: "pair-state" });
  const pairHint = el("span", { class: "tiny" });
  const changeButton = el("button", { id: "pair-change", type: "button", class: "link" }, "Pair again") as HTMLButtonElement;
  footer.append(pairState, pairHint, el("span", { class: "sp" }), changeButton);

  const renderSteps = (): void => {
    const down = backendUp === false;
    conn.textContent = down ? "Halo app not running" : paired ? "Connected" : connecting ? "Connecting" : "Not paired";
    conn.dataset.tone = down ? "bad" : paired ? "ok" : "wait";
    const wantCode = changing || (!paired && (!deps.autoPair || autoRefused));
    pairSection.hidden = !down && paired && !changing;
    downNote.hidden = !down;
    pairForm.hidden = down || !wantCode;
    pairPrompt.hidden = down;
    pairPrompt.textContent = wantCode ? "Enter the 6-digit code the Halo app printed." : "Connecting to the Halo app…";
    pairState.textContent = paired ? "Paired" : "Not paired";
    pairHint.textContent = paired ? "with this computer" : "";
    const folded = savedOnce && !editing;
    form.classList.toggle("folded", folded);
    formSummary.textContent = folded ? subjectInput.value : savedOnce ? "" : "optional";
    editButton.hidden = !folded;
    startSection.classList.toggle("todo", !paired || down);
    // One readiness line: what Start will do, or what is missing first.
    const ready = running
      ? { text: "Running: Halo is listening to the call", tone: "live" }
      : down
        ? { text: "Start the Halo app first", tone: "wait" }
        : !paired
          ? { text: "Pair first", tone: "wait" }
          : !onMeetCall
            ? { text: "Open your Meet, Zoom or Teams call, then press Start", tone: "wait" }
            : { text: "Ready for meeting", tone: "ok" };
    readyState.textContent = ready.text;
    readyState.dataset.tone = ready.tone;
    micLine.textContent = micStatusText(micState, micLabel);
    micLine.dataset.tone = micState === "denied" ? "warn" : "";
  };

  /** Check the app, then pair on our own when we can. `force` re-pairs (Pair again). */
  const connect = async (force = false): Promise<void> => {
    if (deps.checkBackend) backendUp = await deps.checkBackend().catch(() => false);
    if (backendUp !== false && deps.autoPair && (!paired || force)) {
      connecting = true;
      renderSteps();
      try {
        await deps.storage.saveToken(await deps.autoPair());
        paired = true;
        changing = false;
        autoRefused = false;
      } catch (error) {
        if (error instanceof PairingError && error.status === 0) backendUp = false;
        else { autoRefused = true; if (force) changing = true; }
      }
      connecting = false;
    }
    renderSteps();
  };

  retryButton.addEventListener("click", () => {
    if (retryButton.dataset.state !== "idle") return;
    setButton(retryButton, "busy", "Checking");
    void connect().finally(() => setButton(retryButton, "idle", "Try again"));
  });
  changeButton.addEventListener("click", () => {
    pairError.setAttribute("hidden", "true");
    if (deps.autoPair && !autoRefused) { void connect(true); return; }
    changing = true;
    renderSteps();
    codeInput.focus();
  });
  editButton.addEventListener("click", () => {
    editing = true;
    renderSteps();
    subjectInput.focus();
  });

  pairButton.addEventListener("click", () => {
    if (pairButton.dataset.state !== "idle") return;
    void (async () => {
      pairError.setAttribute("hidden", "true");
      codeInput.removeAttribute("aria-invalid");
      setButton(pairButton, "busy", "Pairing");
      try {
        const token = await pairFn(codeInput.value);
        await deps.storage.saveToken(token);
        paired = true;
        changing = false;
        renderSteps();
      } catch (error) {
        const message =
          error instanceof PairingError ? error.message : "Pairing failed. Try again.";
        pairError.textContent = message;
        pairError.removeAttribute("hidden");
        codeInput.setAttribute("aria-invalid", "true");
      } finally {
        setButton(pairButton, "idle", "Pair");
      }
    })();
  });
  codeInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") pairButton.click();
  });

  const agendaInput = el("textarea", { id: "agenda", class: "in", placeholder: "One item per line" }) as HTMLTextAreaElement;
  agendaInput.value = (saved.context?.agenda ?? []).join("\n");
  const langSelect = el("select", { id: "viewer-lang", class: "in" }) as HTMLSelectElement;
  for (const lang of ["en", "ar"] as const) {
    const option = el("option", { value: lang }, lang === "en" ? "English" : "Arabic");
    (option as HTMLOptionElement).selected = (saved.context?.viewer_lang ?? "en") === lang;
    langSelect.appendChild(option);
  }
  const projectInput = el("input", { id: "project", class: "in", placeholder: "Optional" }) as HTMLInputElement;
  projectInput.value = saved.context?.project_id ?? "";
  const rolesBox = el("div", { id: "roles" });

  const renderRows = (): void => {
    rolesBox.textContent = "";
    for (const row of rows) {
      const avatar = el("span", { class: "av", "aria-hidden": "true" });
      const paint = (): void => {
        avatar.textContent = (row.name.trim()[0] ?? "?").toUpperCase();
        avatar.style.setProperty("--h", String(hueOf(row.name)));
      };
      paint();
      const nameInput = el("input", { class: "role-name", "aria-label": "Name" }) as HTMLInputElement;
      nameInput.value = row.name;
      nameInput.placeholder = "Name";
      nameInput.addEventListener("input", () => {
        row.name = nameInput.value;
        paint();
      });
      const roleInput = el("input", { class: "role-role", "aria-label": "Role" }) as HTMLInputElement;
      roleInput.value = row.role;
      roleInput.placeholder = "+ role";
      roleInput.addEventListener("input", () => {
        row.role = roleInput.value;
      });
      const line = el("div", { class: "role-row person" });
      line.append(avatar, nameInput, roleInput);
      rolesBox.appendChild(line);
    }
  };
  renderRows();

  field(form, "Topic", subjectInput);
  field(form, "Agenda", agendaInput);
  form.appendChild(el("span", { class: "f" }, "People and roles"));
  form.appendChild(rolesBox);

  // Preferences: points language, project, urgency-mark style. Each saves on change.
  const { card: prefsSection } = card("prefs-section", el("b", { class: "title" }, "Preferences"));
  const prefsSaved = el("span", { id: "prefs-saved", class: "ok", role: "status", hidden: "true" });
  prefsSection.querySelector(".head")?.append(el("span", { class: "sp" }), prefsSaved);
  const prefsGrid = el("div", { class: "two" });
  field(prefsGrid, "My points language", langSelect);
  field(prefsGrid, "Project", projectInput);
  prefsSection.appendChild(prefsGrid);
  // Viewer preference: bubble urgency-mark style. Writes immediately so the
  // overlay (watching the same key) switches live; restored on every open.
  const prefs = el("div", { id: "viewer-prefs", class: "row" });
  prefs.appendChild(el("span", { class: "f" }, "Urgency marks"));
  const urgencySaved = el("span", { id: "urgency-saved", class: "ok", role: "status", hidden: "true" });
  const seg = el("span", { class: "seg", role: "radiogroup", "aria-label": "Urgency marks" });
  for (const [value, labelText] of [["words", "Words"], ["symbols", "Symbols"]] as const) {
    const radio = el("input", { type: "radio", name: "urgency-style", value }) as HTMLInputElement;
    radio.checked = (saved.urgencyStyle ?? "words") === value;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      void deps.storage.saveUrgencyStyle(value as UrgencyStyle).then(
        () => flash(urgencySaved, "Saved ✓"),
        () => flash(urgencySaved, "Not saved", 3000),
      );
    });
    const option = el("label", {}, labelText);
    option.prepend(radio);
    seg.appendChild(option);
  }
  prefs.append(urgencySaved, seg);
  prefsSection.appendChild(prefs);

  // Karim 2026-11-04: pick Frame even with a camera on (name in the tile corner).
  const view = el("div", { id: "view-mode", class: "row" });
  view.appendChild(el("span", { class: "f" }, "View"));
  const viewSaved = el("span", { class: "ok", role: "status", hidden: "true" });
  const viewSeg = el("span", { class: "seg", role: "radiogroup", "aria-label": "View" });
  for (const [value, labelText, hint] of [["face", "Camera", "Name above the head"], ["frame", "Frame", "Name in the tile corner"]] as const) {
    const radio = el("input", { type: "radio", name: "view-mode", value }) as HTMLInputElement;
    radio.checked = (saved.viewMode ?? "face") === value;
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      void deps.storage.saveViewMode(value as ViewMode).then(
        () => flash(viewSaved, "Saved ✓"),
        () => flash(viewSaved, "Not saved", 3000),
      );
    });
    const option = el("label", { title: hint }, labelText);
    option.prepend(radio);
    viewSeg.appendChild(option);
  }
  view.append(viewSaved, viewSeg);
  prefsSection.appendChild(view);

  /** Builds the meeting context from the form, stores it and sends it to the hub. */
  const saveContext = async (): Promise<void> => {
    const formState: SetupForm = {
      subject: subjectInput.value,
      agendaText: agendaInput.value,
      rows,
      viewerLang: langSelect.value === "ar" ? "ar" : "en",
      projectId: projectInput.value,
    };
    const data = buildMeetingContext(formState);
    await deps.storage.saveContext(data);
    deps.port.postMessage({ type: "meeting.context", data });
  };
  for (const input of [langSelect, projectInput]) {
    input.addEventListener("change", () => {
      void saveContext().then(
        () => flash(prefsSaved, "Saved ✓"),
        () => flash(prefsSaved, "Not saved", 3000),
      );
    });
  }

  const saveRow = el("div", { class: "row end" });
  const saveError = el("p", { id: "save-error", class: "err", role: "alert", hidden: "true" });
  const saveButton = el("button", { id: "save-btn", type: "button", class: "btn" }) as HTMLButtonElement;
  setButton(saveButton, "idle", "Save");
  saveButton.addEventListener("click", () => {
    if (saveButton.dataset.state !== "idle") return;
    void (async () => {
      saveError.setAttribute("hidden", "true");
      setButton(saveButton, "busy", "Saving");
      try {
        await saveContext();
        flash(saveState, "Saved ✓");
        savedOnce = true;
        editing = false;
        renderSteps();
      } catch {
        saveError.textContent = "Could not save. Try again.";
        saveError.removeAttribute("hidden");
      } finally {
        setButton(saveButton, "idle", "Save");
      }
    })();
  });
  saveRow.append(saveError, saveButton);
  form.appendChild(saveRow);

  // The mic is opened by the Meet tab at Start under Meet's own permission,
  // so there is nothing to grant here; the line follows it live.
  const micSection = el("div", { id: "mic-section", class: "mic" });
  micSection.append(readyState, micLine);
  startSection.appendChild(micSection);
  deps.watchMicState?.((state, label) => {
    micState = state;
    if (label !== undefined) micLabel = label;
    renderSteps();
  });

  const startButton = el("button", { id: "start-btn", type: "button", class: "btn sage block" }) as HTMLButtonElement;
  const stopButton = el("button", { id: "stop-btn", type: "button", class: "btn block" }) as HTMLButtonElement;
  const startMessage = el("p", { id: "start-error", class: "err", role: "alert", hidden: "true" });
  const showStartMessage = (text: string): void => {
    startMessage.textContent = text;
    startMessage.classList.remove("note");
    startMessage.removeAttribute("hidden");
  };
  const renderStart = (): void => {
    if (running) setButton(startButton, "done", "Running");
    else setButton(startButton, "idle", "Start");
    stopButton.hidden = !running || !deps.onStop;
    if (stopButton.hidden || stopButton.dataset.state !== "busy") setButton(stopButton, "idle", "Stop");
    renderSteps();
  };
  startButton.addEventListener("click", () => {
    // Idempotent: busy or running ignores the press (the button is disabled
    // too; this guard covers a click queued before the disable lands).
    if (startButton.dataset.state !== "idle") return;
    void (async () => {
      startMessage.setAttribute("hidden", "true");
      setButton(startButton, "busy", "Starting");
      let result: StartResult | undefined;
      try {
        result = (await deps.onStart()) as StartResult | undefined;
      } catch (error) {
        result = { ok: false, message: `Start failed: ${error instanceof Error ? error.message : error}` };
      }
      if (!result || result.ok) {
        running = true;
        if (result?.warning) showStartMessage(result.warning);
      } else {
        showStartMessage(result.message);
      }
      renderStart();
    })();
  });
  stopButton.addEventListener("click", () => {
    if (stopButton.dataset.state !== "idle" || !deps.onStop) return;
    void (async () => {
      setButton(stopButton, "busy", "Stopping");
      try {
        await deps.onStop?.();
        running = false;
        showStartMessage("Meeting ended. Your meeting page is being built.");
        startMessage.classList.add("note");
      } catch {
        showStartMessage("Could not stop. Try again.");
      }
      setButton(stopButton, "idle", "Stop");
      renderStart();
    })();
  });
  const consentButton = el("button", { id: "consent-btn", type: "button", class: "btn block" }, "Copy consent notice") as HTMLButtonElement;
  const consentState = el("p", { id: "consent-state", class: "tiny", role: "status" });
  consentButton.addEventListener("click", () => {
    void (async () => {
      try {
        await (deps.clipboard ?? navigator.clipboard).writeText(CONSENT_NOTICE);
        consentState.textContent = "Copied. Paste it into Meet chat.";
      } catch {
        consentState.textContent = "Copy failed. Try again.";
      }
    })();
  });
  startSection.append(startButton, stopButton, startMessage, consentButton, consentState);
  root.append(startSection, form, prefsSection, footer);
  renderStart();
  void connect();
}
