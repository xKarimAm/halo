import type { PortMeetingContext } from "../../../contracts/ext/port";
import {
  buildMeetingContext,
  mergeTileNames,
  type RoleRow,
  type SetupForm,
} from "./context";
import { PairingError, pairWithCode } from "./pairing";
import type { MicState, SavedSetup, SetupStorage, UrgencyStyle } from "./storage";
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
  watchMicState?: (onChange: (state: MicState) => void) => void;
  /** Ends the running meeting; the Stop button exists only when this is given. */
  onStop?: () => void | Promise<void>;
  pairFn?: (code: string) => Promise<string>;
}

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

/** A numbered step card ("Three steps" design): number disc + title row. */
function stepCard(id: string, num: string, title: HTMLElement): { card: HTMLElement; head: HTMLElement; disc: HTMLElement } {
  const card = el("section", { id, class: "card glass" });
  const disc = el("span", { class: "num", "aria-hidden": "true" }, num);
  const head = el("div", { class: "head" });
  head.append(disc, title);
  card.appendChild(head);
  return { card, head, disc };
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

export function micStatusText(state: SavedSetup["micState"]): string {
  if (state === "granted") return "Microphone: ready";
  if (state === "denied") return "Microphone: blocked in Meet, tab audio only";
  return "Microphone: starts with Start";
}

/**
 * Boot the toolbar popup ("Three steps": Pair, About this meeting, Start;
 * Sage & Clay tokens in entrypoints/popup/style.css). Restores the saved
 * token + context, prefills role rows from participant names, and wires
 * Pair / Save / Start with busy, done and error states. Start is
 * idempotent: once running it shows Running and further presses do
 * nothing. Contains no consent UI: consent lives in the Overlay lane only.
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

  // Header + progress strip. The step shown is the first unfinished one.
  let paired = Boolean(saved.token);
  let savedOnce = Boolean(saved.context);
  let running = runningAtOpen;
  let micState = saved.micState;
  const header = el("header", { class: "top" });
  const logo = el("h1", { class: "logo" }, "Halo");
  logo.prepend(el("i"));
  const stepLabel = el("span", { id: "step-label", class: "tiny" });
  header.append(logo, el("span", { class: "sp" }), stepLabel);
  const bars = el("div", { class: "steps", "aria-hidden": "true" });
  for (let i = 0; i < 3; i += 1) bars.appendChild(el("i"));
  root.append(header, bars);

  // Step 1: Pair. Folds to one "Paired" line once paired; Change reopens it.
  const pairTitle = el("div", { class: "title" });
  const pairState = el("b", { id: "pair-state" });
  const pairHint = el("span", { class: "tiny" });
  pairTitle.append(pairState, pairHint);
  const { card: pairSection, head: pairHead, disc: pairDisc } = stepCard("pair-section", "1", pairTitle);
  const changeButton = el("button", { id: "pair-change", type: "button", class: "link" }, "Change") as HTMLButtonElement;
  pairHead.append(el("span", { class: "sp" }), changeButton);
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
  pairSection.append(pairForm, pairError);
  root.appendChild(pairSection);

  // Step 2: About this meeting. A saved meeting folds to one line (its
  // subject) so Start stays in view; Edit reopens it.
  const formTitle = el("div", { class: "title" });
  const formSummary = el("span", { class: "tiny" });
  formTitle.append(el("b", {}, "About this meeting"), formSummary);
  const { card: form, head: formHead, disc: formDisc } = stepCard("meeting-form", "2", formTitle);
  const saveState = el("span", { id: "save-state", class: "ok", role: "status", hidden: "true" });
  const editButton = el("button", { id: "meeting-edit", type: "button", class: "link" }, "Edit") as HTMLButtonElement;
  formHead.append(el("span", { class: "sp" }), saveState, editButton);
  let editing = false;

  // Step 3: Start, with one readiness line and the mic detail under it.
  const { card: startSection } = stepCard("start-section", "3", el("b", { class: "title" }, "Start"));
  const readyState = el("p", { id: "ready-state", class: "ready", role: "status" });
  const micLine = el("p", { id: "mic-state", class: "tiny" });

  const subjectInput = el("input", { id: "subject", class: "in" }) as HTMLInputElement;
  subjectInput.value = saved.context?.subject ?? "";

  const renderSteps = (): void => {
    const step = !paired ? 1 : !savedOnce ? 2 : 3;
    stepLabel.textContent = running ? "Running" : `Step ${step} of 3`;
    bars.querySelectorAll("i").forEach((bar, i) => bar.classList.toggle("done", running || i < step));
    pairState.textContent = paired ? "Paired" : "Not paired";
    pairHint.textContent = paired ? "with this computer" : "enter the code from the Halo app";
    pairDisc.textContent = paired ? "✓" : "1";
    changeButton.hidden = !paired;
    pairForm.hidden = paired;
    const folded = savedOnce && !editing;
    form.classList.toggle("folded", folded);
    formDisc.textContent = savedOnce ? "✓" : "2";
    formSummary.textContent = folded ? subjectInput.value : "";
    editButton.hidden = !folded;
    startSection.classList.toggle("todo", !paired);
    // One readiness line: what Start will do, or what is missing first.
    const ready = running
      ? { text: "Running: Halo is listening to the call", tone: "live" }
      : !paired
        ? { text: "Pair first", tone: "wait" }
        : !onMeetCall
          ? { text: "Open your Meet call, then press Start", tone: "wait" }
          : { text: "Ready for meeting", tone: "ok" };
    readyState.textContent = ready.text;
    readyState.dataset.tone = ready.tone;
    micLine.textContent = micStatusText(micState);
    micLine.dataset.tone = micState === "denied" ? "warn" : "";
  };
  changeButton.addEventListener("click", () => {
    pairForm.hidden = !pairForm.hidden;
    if (!pairForm.hidden) codeInput.focus();
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

  field(form, "Subject", subjectInput);
  field(form, "Agenda", agendaInput);
  form.appendChild(el("span", { class: "f" }, "People and roles"));
  form.appendChild(rolesBox);

  // Preferences drawer: points language, project, urgency-mark style.
  const drawer = el("details", { class: "drawer" });
  drawer.appendChild(el("summary", {}, "Preferences"));
  const prefsGrid = el("div", { class: "two" });
  field(prefsGrid, "My points language", langSelect);
  field(prefsGrid, "Project", projectInput);
  drawer.appendChild(prefsGrid);
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
  drawer.appendChild(prefs);
  form.appendChild(drawer);

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
  root.appendChild(form);

  // The mic is opened by the Meet tab at Start under Meet's own permission,
  // so there is nothing to grant here; the line follows it live.
  const micSection = el("div", { id: "mic-section", class: "mic" });
  micSection.append(readyState, micLine);
  startSection.appendChild(micSection);
  deps.watchMicState?.((state) => {
    micState = state;
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
        showStartMessage("Meeting ended. Your notes are being built.");
        startMessage.classList.add("note");
      } catch {
        showStartMessage("Could not stop. Try again.");
      }
      setButton(stopButton, "idle", "Stop");
      renderStart();
    })();
  });
  startSection.append(startButton, stopButton, startMessage);
  root.appendChild(startSection);
  renderStart();
}
