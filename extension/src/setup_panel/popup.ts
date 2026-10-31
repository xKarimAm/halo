import type { PortMeetingContext } from "../../../contracts/ext/port";
import {
  buildMeetingContext,
  mergeTileNames,
  type RoleRow,
  type SetupForm,
} from "./context";
import { PairingError, pairWithCode } from "./pairing";
import type { SavedSetup, SetupStorage, UrgencyStyle } from "./storage";
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
   * Hub_capture's capture handoff, called once per Start click (the user
   * gesture Chrome needs for tabCapture). A refusal or capture warning
   * comes back as the result and is shown under the Start button.
   */
  onStart: () => StartResult | Promise<StartResult> | void;
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

export function micStatusText(state: SavedSetup["micState"]): string {
  if (state === "granted") return "Microphone: ready";
  if (state === "denied") return "Microphone: blocked in Meet, tab audio only";
  return "Microphone: starts with Start";
}

/**
 * Boot the toolbar popup ("Three steps": Pair, About this meeting, Start;
 * Sage & Clay tokens in entrypoints/popup/style.css). Restores the saved
 * token + context, prefills role rows from participant names, and wires
 * Pair / Save / Start. Contains no consent UI: consent lives in the Overlay
 * lane only.
 */
export async function initPopup(root: HTMLElement, deps: PopupDeps): Promise<void> {
  const saved: SavedSetup = await deps.storage.load();
  const pairFn = deps.pairFn ?? pairWithCode;

  let rows: RoleRow[] = mergeTileNames(
    (saved.context?.roles ?? []).map((role) => ({ name: role.name, role: role.role ?? "" })),
    await deps.listParticipants(),
  );
  if (rows.length === 0) {
    rows = [{ name: "", role: "" }];
  }

  // Header + progress strip. The step shown is the first unfinished one.
  let paired = Boolean(saved.token);
  let savedOnce = Boolean(saved.context);
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
  const pairButton = el("button", { id: "pair-btn", type: "button", class: "btn" }, "Pair") as HTMLButtonElement;
  pairForm.append(codeInput, pairButton);
  const pairError = el("p", { id: "pair-error", class: "err", hidden: "true" });
  pairSection.append(pairForm, pairError);
  root.appendChild(pairSection);

  // Step 2: About this meeting. Step 3: Start (with the mic status).
  // A saved meeting folds to one line (its subject) so Start stays in view.
  const formTitle = el("div", { class: "title" });
  const formSummary = el("span", { class: "tiny" });
  formTitle.append(el("b", {}, "About this meeting"), formSummary);
  const { card: form, head: formHead, disc: formDisc } = stepCard("meeting-form", "2", formTitle);
  const editButton = el("button", { id: "meeting-edit", type: "button", class: "link" }, "Edit") as HTMLButtonElement;
  formHead.append(el("span", { class: "sp" }), editButton);
  let editing = false;
  const { card: startSection } = stepCard("start-section", "3", el("b", { class: "title" }, "Start"));

  const renderSteps = (): void => {
    const step = !paired ? 1 : !savedOnce ? 2 : 3;
    stepLabel.textContent = `Step ${step} of 3`;
    bars.querySelectorAll("i").forEach((bar, i) => bar.classList.toggle("done", i < step));
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
    startSection.classList.toggle("todo", step < 3);
  };
  editButton.addEventListener("click", () => {
    editing = true;
    renderSteps();
    subjectInput.focus();
  });
  changeButton.addEventListener("click", () => {
    pairForm.hidden = !pairForm.hidden;
    if (!pairForm.hidden) codeInput.focus();
  });

  pairButton.addEventListener("click", () => {
    void (async () => {
      pairError.setAttribute("hidden", "true");
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
      }
    })();
  });

  const subjectInput = el("input", { id: "subject", class: "in" }) as HTMLInputElement;
  subjectInput.value = saved.context?.subject ?? "";
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
  const seg = el("span", { class: "seg", role: "radiogroup", "aria-label": "Urgency marks" });
  for (const [value, labelText] of [["words", "Words"], ["symbols", "Symbols"]] as const) {
    const radio = el("input", { type: "radio", name: "urgency-style", value }) as HTMLInputElement;
    radio.checked = (saved.urgencyStyle ?? "words") === value;
    radio.addEventListener("change", () => {
      if (radio.checked) void deps.storage.saveUrgencyStyle(value as UrgencyStyle);
    });
    const option = el("label", {}, labelText);
    option.prepend(radio);
    seg.appendChild(option);
  }
  prefs.appendChild(seg);
  drawer.appendChild(prefs);
  form.appendChild(drawer);

  const saveRow = el("div", { class: "row end" });
  const saveButton = el("button", { id: "save-btn", type: "button", class: "btn" }, "Save") as HTMLButtonElement;
  const saveState = el("p", { id: "save-state", class: "ok", hidden: "true" });
  saveButton.addEventListener("click", () => {
    void (async () => {
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
      saveState.textContent = "Saved";
      saveState.removeAttribute("hidden");
      savedOnce = true;
      editing = false;
      renderSteps();
    })();
  });
  saveRow.append(saveState, saveButton);
  form.appendChild(saveRow);
  root.appendChild(form);

  // Status only: the Meet tab captures the mic at Start under Meet's own
  // permission, so there is nothing to grant here.
  const micSection = el("div", { id: "mic-section", class: "mic" });
  micSection.appendChild(el("p", { id: "mic-state" }, micStatusText(saved.micState)));
  startSection.appendChild(micSection);

  const startButton = el("button", { id: "start-btn", type: "button", class: "btn sage block" }, "Start") as HTMLButtonElement;
  const startMessage = el("p", { id: "start-error", class: "err", hidden: "true" });
  const showStartMessage = (text: string): void => {
    startMessage.textContent = text;
    startMessage.removeAttribute("hidden");
  };
  startButton.addEventListener("click", () => {
    void (async () => {
      const result = (await deps.onStart()) as StartResult | undefined;
      if (!result) return; // legacy void handoff: started, nothing to show
      startMessage.setAttribute("hidden", "true");
      if (result.ok) {
        if (result.warning) showStartMessage(result.warning);
      } else {
        showStartMessage(result.message);
      }
    })();
  });
  startSection.append(startButton, startMessage);
  root.appendChild(startSection);
  renderSteps();
}
