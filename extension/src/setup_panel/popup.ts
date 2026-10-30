import type { PortMeetingContext } from "../../../../../contracts/ext/port";
import {
  buildMeetingContext,
  mergeTileNames,
  type RoleRow,
  type SetupForm,
} from "./context";
import { PairingError, pairWithCode } from "./pairing";
import type { SavedSetup, SetupStorage } from "./storage";

/** Minimal Port to the hub: the hub wraps the payload in an envelope. */
export interface PopupPort {
  postMessage(message: PortMeetingContext): void;
}

export interface PopupDeps {
  storage: SetupStorage;
  /** Port to the hub; Save posts one `meeting.context` on it. */
  port: PopupPort;
  /**
   * Current participant names for role prefill. Returns [] until the hub
   * delivers adapter tile names to the panel (open hub_capture/contracts issue).
   */
  listParticipants: () => string[];
  /** Hub_capture's capture handoff, called once per Start click (user gesture). */
  onStart: () => void;
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
export async function initPopup(root: HTMLElement, deps: PopupDeps): Promise<void> {
  const saved: SavedSetup = await deps.storage.load();
  const pairFn = deps.pairFn ?? pairWithCode;

  let rows: RoleRow[] = mergeTileNames(
    (saved.context?.roles ?? []).map((role) => ({ name: role.name, role: role.role ?? "" })),
    deps.listParticipants(),
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

  const startButton = el("button", { id: "start-btn", type: "button" }, "Start") as HTMLButtonElement;
  startButton.addEventListener("click", () => {
    deps.onStart();
  });
  root.appendChild(startButton);
}
