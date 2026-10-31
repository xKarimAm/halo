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
  /** Opens the one-time microphone-permission page. */
  onRequestMicPermission: () => void;
  /** Stop button: ends the running meeting (meeting.ended "left"). */
  onStop?: () => void;
  /** True while a meeting runs; Stop is shown only then. */
  meetingRunning?: () => Promise<boolean>;
  /** Live mic permission of the extension origin (Permissions API state). */
  micPermission?: () => Promise<string>;
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

function labeledInput(
  container: HTMLElement,
  labelText: string,
  input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): void {
  const label = el("label", {}, labelText);
  label.appendChild(input);
  container.appendChild(label);
}

/**
 * Boot the toolbar popup. Restores the saved token + context, prefills role
 * rows from participant names, and wires Pair / Save / Start. Contains no
 * consent UI: consent lives in the Overlay lane only.
 */
export function micStatusText(state: SavedSetup["micState"]): string {
  if (state === "granted") return "Microphone: ready";
  if (state === "denied") return "Microphone: blocked — tab audio only";
  return "Microphone: not set up yet";
}

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

  root.appendChild(el("h1", {}, "Halo setup"));

  const pairSection = el("section", { id: "pair-section" });
  const codeInput = el("input", {
    id: "pair-code",
    inputmode: "numeric",
    maxlength: "6",
    placeholder: "6-digit code",
  }) as HTMLInputElement;
  const pairButton = el("button", { id: "pair-btn", type: "button" }, "Pair") as HTMLButtonElement;
  const pairError = el("p", { id: "pair-error", hidden: "true" });
  const pairState = el("p", { id: "pair-state" }, saved.token ? "Paired" : "Not paired");
  pairSection.append(codeInput, pairButton, pairError, pairState);
  root.appendChild(pairSection);

  pairButton.addEventListener("click", () => {
    void (async () => {
      pairError.setAttribute("hidden", "true");
      try {
        const token = await pairFn(codeInput.value);
        await deps.storage.saveToken(token);
        pairState.textContent = "Paired";
      } catch (error) {
        const message =
          error instanceof PairingError ? error.message : "Pairing failed. Try again.";
        pairError.textContent = message;
        pairError.removeAttribute("hidden");
      }
    })();
  });

  const form = el("section", { id: "meeting-form" });
  const subjectInput = el("input", { id: "subject" }) as HTMLInputElement;
  subjectInput.value = saved.context?.subject ?? "";
  const agendaInput = el("textarea", { id: "agenda" }) as HTMLTextAreaElement;
  agendaInput.value = (saved.context?.agenda ?? []).join("\n");
  const langSelect = el("select", { id: "viewer-lang" }) as HTMLSelectElement;
  for (const lang of ["en", "ar"] as const) {
    const option = el("option", { value: lang }, lang === "en" ? "English" : "Arabic");
    (option as HTMLOptionElement).selected = (saved.context?.viewer_lang ?? "en") === lang;
    langSelect.appendChild(option);
  }
  const projectInput = el("input", { id: "project" }) as HTMLInputElement;
  projectInput.value = saved.context?.project_id ?? "";
  const rolesBox = el("div", { id: "roles" });

  const renderRows = (): void => {
    rolesBox.textContent = "";
    for (const row of rows) {
      const nameInput = el("input", { class: "role-name" }) as HTMLInputElement;
      nameInput.value = row.name;
      nameInput.placeholder = "Name";
      nameInput.addEventListener("input", () => {
        row.name = nameInput.value;
      });
      const roleInput = el("input", { class: "role-role" }) as HTMLInputElement;
      roleInput.value = row.role;
      roleInput.placeholder = "Role (optional)";
      roleInput.addEventListener("input", () => {
        row.role = roleInput.value;
      });
      const line = el("div", { class: "role-row" });
      line.append(nameInput, roleInput);
      rolesBox.appendChild(line);
    }
  };
  renderRows();

  labeledInput(form, "Subject", subjectInput);
  labeledInput(form, "Agenda (one item per line)", agendaInput);
  form.appendChild(el("span", {}, "People and roles"));
  form.appendChild(rolesBox);
  labeledInput(form, "My points language", langSelect);
  labeledInput(form, "Project (optional)", projectInput);

  const saveButton = el("button", { id: "save-btn", type: "button" }, "Save") as HTMLButtonElement;
  const saveState = el("p", { id: "save-state", hidden: "true" });
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
    })();
  });
  form.append(saveButton, saveState);
  root.appendChild(form);

  // Viewer preference: bubble urgency-mark style. Writes immediately so the
  // overlay (watching the same key) switches live; restored on every open.
  const prefs = el("section", { id: "viewer-prefs" });
  prefs.appendChild(el("span", {}, "Urgency marks"));
  for (const [value, labelText] of [["words", "Words"], ["symbols", "Symbols"]] as const) {
    const radio = el("input", { type: "radio", name: "urgency-style", value }) as HTMLInputElement;
    radio.checked = (saved.urgencyStyle ?? "words") === value;
    radio.addEventListener("change", () => {
      if (radio.checked) void deps.storage.saveUrgencyStyle(value as UrgencyStyle);
    });
    const option = el("label", {}, labelText);
    option.prepend(radio);
    prefs.appendChild(option);
  }
  root.appendChild(prefs);

  // One-time microphone grant: the offscreen document cannot prompt, so a
  // dedicated extension page calls getUserMedia once and keeps the grant.
  const micSection = el("section", { id: "mic-section" });
  // halo.micState goes stale when the grant is revoked in site settings;
  // the live permission state wins whenever it is not "granted".
  const permission = await deps.micPermission?.().catch(() => undefined);
  const shownMic = permission === "denied" ? "denied" : permission === "prompt" ? undefined : saved.micState;
  const micState = el("p", { id: "mic-state" }, micStatusText(shownMic));
  const micButton = el("button", { id: "mic-btn", type: "button" }, "Allow microphone") as HTMLButtonElement;
  micButton.addEventListener("click", () => {
    deps.onRequestMicPermission();
  });
  micSection.append(micState, micButton);
  root.appendChild(micSection);

  const startButton = el("button", { id: "start-btn", type: "button" }, "Start") as HTMLButtonElement;
  const startMessage = el("p", { id: "start-error", hidden: "true" });
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
        stopButton.removeAttribute("hidden");
        if (result.warning) showStartMessage(result.warning);
      } else {
        showStartMessage(result.message);
      }
    })();
  });
  const stopButton = el("button", { id: "stop-btn", type: "button" }, "Stop") as HTMLButtonElement;
  if (!(await deps.meetingRunning?.().catch(() => false))) stopButton.setAttribute("hidden", "true");
  stopButton.addEventListener("click", () => {
    deps.onStop?.();
    stopButton.setAttribute("hidden", "true");
    showStartMessage("Meeting ended. Your notes are being built.");
  });
  root.append(startButton, stopButton, startMessage);
}
