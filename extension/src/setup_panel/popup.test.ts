// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortMeetingContext } from "../../../contracts/ext/port";
import type { MeetingContext } from "../../../contracts/ext/gen/types";
import goldenContext from "../../../contracts/golden/meeting.context.json";
import { PairingError } from "./pairing";
import { initPopup, type PopupDeps } from "./popup";
import { memorySetupStorage } from "./storage";

const golden = goldenContext.data as unknown as MeetingContext;

function depsWith(overrides: Partial<PopupDeps> = {}) {
  const posted: PortMeetingContext[] = [];
  const onStart = vi.fn();
  const deps: PopupDeps = {
    storage: memorySetupStorage(),
    port: { postMessage: (message) => posted.push(message) },
    listParticipants: () => [],
    onStart,
    ...overrides,
  };
  // NB: no re-spread of the spies after overrides: an overridden onStart
  // must reach initPopup, while the bare vi.fn stays visible as deps.onStart.
  return { ...deps, posted };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fillSaveForm(root: HTMLElement): void {
  (root.querySelector("#subject") as HTMLInputElement).value = "Launch readiness";
  (root.querySelector("#agenda") as HTMLTextAreaElement).value = "Pricing\nRTL";
  (root.querySelector("#project") as HTMLInputElement).value = "halo-q4";
  const roleInputs = root.querySelectorAll(".role-role");
  (roleInputs[0] as HTMLInputElement).value = "Engineering lead";
  (roleInputs[0] as HTMLInputElement).dispatchEvent(new Event("input"));
}

describe("popup Save", () => {
  it("posts one meeting.context on the Port matching the golden shape", async () => {
    const deps = depsWith({ listParticipants: () => ["Layla", "Omar"] });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    fillSaveForm(root);
    (root.querySelector("#save-btn") as HTMLButtonElement).click();
    await flush();
    expect(deps.posted).toHaveLength(1);
    expect(deps.posted[0]).toEqual({ type: "meeting.context", data: golden });
  });

  it("persists the saved context for the next open", async () => {
    const deps = depsWith({ listParticipants: () => ["Layla", "Omar"] });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    fillSaveForm(root);
    (root.querySelector("#save-btn") as HTMLButtonElement).click();
    await flush();
    expect(await deps.storage.load()).toMatchObject({ context: golden });
  });
});

describe("popup Start", () => {
  it("is idempotent: Starting, then Running, and repeat presses do nothing", async () => {
    let finish: (r: { ok: true }) => void = () => {};
    const onStart = vi.fn(() => new Promise<{ ok: true }>((resolve) => { finish = resolve; }));
    const deps = depsWith({ onStart });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const start = root.querySelector("#start-btn") as HTMLButtonElement;
    expect(onStart).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i += 1) start.click(); // tonight's 5 presses
    expect(start.dataset.state).toBe("busy");
    expect(start.textContent).toBe("Starting");
    finish({ ok: true });
    await flush();
    expect(start.dataset.state).toBe("done");
    expect(start.textContent).toBe("Running");
    expect(start.disabled).toBe(true);
    start.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(root.querySelector("#ready-state")?.textContent).toMatch(/Running/);
  });

  it("opens as Running when a Start is still live, and never calls onStart", async () => {
    const deps = depsWith({ meetingRunning: async () => true });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const start = root.querySelector("#start-btn") as HTMLButtonElement;
    expect(start.textContent).toBe("Running");
    start.click();
    expect(deps.onStart).not.toHaveBeenCalled();
  });

  it("a thrown Start comes back pressable with the reason", async () => {
    const deps = depsWith({ onStart: async () => { throw new Error("no tab"); } });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const start = root.querySelector("#start-btn") as HTMLButtonElement;
    start.click();
    await flush();
    expect(start.dataset.state).toBe("idle");
    expect(root.querySelector("#start-error")?.textContent).toMatch(/no tab/);
  });

  it("Stop exists only with onStop; it ends the meeting and frees Start", async () => {
    const without = depsWith({ meetingRunning: async () => true });
    const a = document.createElement("div");
    await initPopup(a, without);
    expect((a.querySelector("#stop-btn") as HTMLElement).hidden).toBe(true);

    const onStop = vi.fn(async () => {});
    const deps = depsWith({ meetingRunning: async () => true, onStop });
    const root = document.createElement("div");
    await initPopup(root, deps);
    const stop = root.querySelector("#stop-btn") as HTMLButtonElement;
    expect(stop.hidden).toBe(false);
    stop.click();
    expect(stop.textContent).toBe("Stopping");
    await flush();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(stop.hidden).toBe(true);
    expect((root.querySelector("#start-btn") as HTMLButtonElement).textContent).toBe("Start");
    expect(root.querySelector("#start-error")?.textContent).toMatch(/Meeting ended/);
  });

  it("shows a refusal message and starts nothing on a refused Start", async () => {
    const deps = depsWith({
      onStart: async () => ({ ok: false as const, message: "Open a Google Meet call, then press Start." }),
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    (root.querySelector("#start-btn") as HTMLButtonElement).click();
    await flush();
    const error = root.querySelector("#start-error") as HTMLElement;
    expect(error.hasAttribute("hidden")).toBe(false);
    expect(error.textContent).toMatch(/Google Meet call/);
  });

  it("shows a capture warning but still starts on a degraded Start", async () => {
    const deps = depsWith({
      onStart: async () => ({ ok: true as const, warning: "Audio capture failed. Started without audio." }),
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    (root.querySelector("#start-btn") as HTMLButtonElement).click();
    await flush();
    const error = root.querySelector("#start-error") as HTMLElement;
    expect(error.hasAttribute("hidden")).toBe(false);
    expect(error.textContent).toMatch(/without audio/);
  });
});

describe("popup microphone", () => {
  it("shows the mic state as a status only, with no grant button", async () => {
    const deps = depsWith();
    await deps.storage.saveMicState("denied");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#mic-state")?.textContent).toMatch(/tab audio only/);
    expect(root.querySelector("#mic-btn")).toBeNull();
  });

  it("defaults to starting with Start", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#mic-state")?.textContent).toMatch(/starts with Start/);
  });
});

describe("popup pairing", () => {
  it("stores the token and shows Paired on success", async () => {
    const deps = depsWith({ pairFn: async () => "tok-abc" });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    (root.querySelector("#pair-code") as HTMLInputElement).value = "123456";
    (root.querySelector("#pair-btn") as HTMLButtonElement).click();
    await flush();
    expect(await deps.storage.load()).toMatchObject({ token: "tok-abc" });
    expect(root.querySelector("#pair-state")?.textContent).toBe("Paired");
  });

  it("shows a visible error and stores nothing on a wrong code", async () => {
    const deps = depsWith({
      pairFn: async () => {
        throw new PairingError("Wrong code. Check the code and try again.", 401);
      },
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    (root.querySelector("#pair-code") as HTMLInputElement).value = "000000";
    (root.querySelector("#pair-btn") as HTMLButtonElement).click();
    await flush();
    expect(await deps.storage.load()).toEqual({});
    const error = root.querySelector("#pair-error") as HTMLElement;
    expect(error.hasAttribute("hidden")).toBe(false);
    expect(error.textContent).toMatch(/wrong code/i);
  });
});

describe("popup restore", () => {
  it("reopened popup restores saved context and token", async () => {
    const first = depsWith();
    await first.storage.saveToken("tok-abc");
    await first.storage.saveContext(golden);
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, first);
    expect((root.querySelector("#subject") as HTMLInputElement).value).toBe("Launch readiness");
    expect((root.querySelector("#agenda") as HTMLTextAreaElement).value).toBe("Pricing\nRTL");
    expect((root.querySelector("#project") as HTMLInputElement).value).toBe("halo-q4");
    expect(root.querySelector("#pair-state")?.textContent).toBe("Paired");
  });
});

describe("popup readiness and feedback", () => {
  it("reads Pair first, then Open your Meet call, then Ready for meeting", async () => {
    const r1 = document.createElement("div");
    await initPopup(r1, depsWith());
    expect(r1.querySelector("#ready-state")?.textContent).toBe("Pair first");

    const off = depsWith({ onMeetCall: async () => false });
    await off.storage.saveToken("t");
    const r2 = document.createElement("div");
    await initPopup(r2, off);
    expect(r2.querySelector("#ready-state")?.textContent).toMatch(/Open your Meet call/);

    const on = depsWith({ onMeetCall: async () => true });
    await on.storage.saveToken("t");
    const r3 = document.createElement("div");
    await initPopup(r3, on);
    expect(r3.querySelector("#ready-state")?.textContent).toBe("Ready for meeting");
  });

  it("follows the mic state live once the Meet tab opens it", async () => {
    let push: (s: "granted" | "denied") => void = () => {};
    const deps = depsWith({ watchMicState: (fn) => { push = fn; } });
    const root = document.createElement("div");
    await initPopup(root, deps);
    expect(root.querySelector("#mic-state")?.textContent).toMatch(/starts with Start/);
    push("granted");
    expect(root.querySelector("#mic-state")?.textContent).toBe("Microphone: ready");
  });

  it("Pair shows Pairing while it works and marks a wrong code", async () => {
    let fail: (e: Error) => void = () => {};
    const deps = depsWith({ pairFn: () => new Promise<string>((_r, reject) => { fail = reject; }) });
    const root = document.createElement("div");
    await initPopup(root, deps);
    const pair = root.querySelector("#pair-btn") as HTMLButtonElement;
    pair.click();
    expect(pair.textContent).toBe("Pairing");
    expect(pair.disabled).toBe(true);
    fail(new PairingError("Wrong code"));
    await flush();
    expect(pair.textContent).toBe("Pair");
    expect(pair.disabled).toBe(false);
    expect(root.querySelector("#pair-code")?.getAttribute("aria-invalid")).toBe("true");
  });

  it("Save confirms with Saved and folds the card", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    await initPopup(root, deps);
    (root.querySelector("#save-btn") as HTMLButtonElement).click();
    expect((root.querySelector("#save-btn") as HTMLButtonElement).textContent).toBe("Saving");
    await flush();
    const state = root.querySelector("#save-state") as HTMLElement;
    expect(state.hidden).toBe(false);
    expect(state.textContent).toMatch(/Saved/);
    expect(root.querySelector("#meeting-form")?.classList.contains("folded")).toBe(true);
  });
});

describe("popup three steps", () => {
  it("folds finished steps to one line; Change and Edit reopen them", async () => {
    const deps = depsWith();
    await deps.storage.saveToken("tok-abc");
    await deps.storage.saveContext(golden);
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#step-label")?.textContent).toBe("Step 3 of 3");
    const form = root.querySelector("#meeting-form") as HTMLElement;
    expect(form.classList.contains("folded")).toBe(true);
    expect(form.textContent).toMatch(/Launch readiness/);
    expect((root.querySelector("#pair-code")?.parentElement as HTMLElement).hidden).toBe(true);
    (root.querySelector("#meeting-edit") as HTMLButtonElement).click();
    expect(form.classList.contains("folded")).toBe(false);
    (root.querySelector("#pair-change") as HTMLButtonElement).click();
    expect((root.querySelector("#pair-code")?.parentElement as HTMLElement).hidden).toBe(false);
  });

  it("a fresh popup starts on step 1 with the code field open", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#step-label")?.textContent).toBe("Step 1 of 3");
    expect((root.querySelector("#pair-code")?.parentElement as HTMLElement).hidden).toBe(false);
    expect(root.querySelector("#meeting-form")?.classList.contains("folded")).toBe(false);
  });
});

describe("popup consent", () => {
  it("contains no consent control (consent lives in the Overlay)", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.innerHTML).not.toMatch(/consent/i);
  });
});

describe("popup urgency toggle", () => {
  it("defaults to Words and writes the choice immediately", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const words = root.querySelector('input[name="urgency-style"][value="words"]') as HTMLInputElement;
    const symbols = root.querySelector('input[name="urgency-style"][value="symbols"]') as HTMLInputElement;
    expect(words.checked).toBe(true);
    symbols.click();
    await flush();
    expect(await deps.storage.load()).toMatchObject({ urgencyStyle: "symbols" });
    words.click();
    await flush();
    expect(await deps.storage.load()).toMatchObject({ urgencyStyle: "words" });
  });

  it("restores a saved Symbols choice on reopen", async () => {
    const deps = depsWith();
    await deps.storage.saveUrgencyStyle("symbols");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const symbols = root.querySelector('input[name="urgency-style"][value="symbols"]') as HTMLInputElement;
    expect(symbols.checked).toBe(true);
  });
});

describe("popup prefill", () => {
  it("awaits async participant names from the hub storage", async () => {
    const deps = depsWith({ listParticipants: async () => ["Layla", "Omar"] });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const names = [...root.querySelectorAll(".role-name")].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(names).toEqual(["Layla", "Omar"]);
  });

  it("renders one row per participant name", async () => {
    const deps = depsWith({ listParticipants: () => ["Layla", "Omar"] });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const names = [...root.querySelectorAll(".role-name")].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(names).toEqual(["Layla", "Omar"]);
  });

  it("keeps free-text rows typed before anyone joins", async () => {
    const deps = depsWith({ listParticipants: () => ["Layla"] });
    await deps.storage.saveContext({
      subject: "s",
      agenda: [],
      roles: [{ name: "Layla", role: "Engineering lead" }],
      viewer_lang: "en",
    });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    const names = [...root.querySelectorAll(".role-name")].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(names).toContain("Layla");
  });
});

// Issue #72: Stop ends the running meeting.
describe("popup Stop", () => {
  it("is hidden while no meeting runs", async () => {
    const root = document.createElement("div");
    await initPopup(root, depsWith({ meetingRunning: async () => false }));
    expect(root.querySelector("#stop-btn")?.hasAttribute("hidden")).toBe(true);
  });

  it("shows while a meeting runs, and a click stops it and hides", async () => {
    const onStop = vi.fn();
    const root = document.createElement("div");
    await initPopup(root, depsWith({ meetingRunning: async () => true, onStop }));
    const stop = root.querySelector("#stop-btn") as HTMLButtonElement;
    expect(stop.hasAttribute("hidden")).toBe(false);
    stop.click();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(stop.hasAttribute("hidden")).toBe(true);
  });

  it("appears after a successful Start", async () => {
    const root = document.createElement("div");
    await initPopup(root, depsWith({ onStart: () => ({ ok: true }) }));
    (root.querySelector("#start-btn") as HTMLButtonElement).click();
    await flush();
    expect(root.querySelector("#stop-btn")?.hasAttribute("hidden")).toBe(false);
  });
});

beforeEach(() => {
  document.body.textContent = "";
});
