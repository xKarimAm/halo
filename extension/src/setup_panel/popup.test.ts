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
  const onRequestMicPermission = vi.fn();
  const deps: PopupDeps = {
    storage: memorySetupStorage(),
    port: { postMessage: (message) => posted.push(message) },
    listParticipants: () => [],
    onStart,
    onRequestMicPermission,
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
  it("calls onStart once per click and never without a click", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(deps.onStart).not.toHaveBeenCalled();
    (root.querySelector("#start-btn") as HTMLButtonElement).click();
    (root.querySelector("#start-btn") as HTMLButtonElement).click();
    expect(deps.onStart).toHaveBeenCalledTimes(2);
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
  it("shows the mic grant state and opens the permission page on click", async () => {
    const deps = depsWith();
    await deps.storage.saveMicState("denied");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#mic-state")?.textContent).toMatch(/tab audio only/);
    (root.querySelector("#mic-btn") as HTMLButtonElement).click();
    expect(deps.onRequestMicPermission).toHaveBeenCalledTimes(1);
  });

  it("a revoked grant beats the stale stored 'granted'", async () => {
    for (const [permission, text] of [["prompt", /not set up yet/], ["denied", /tab audio only/], ["granted", /ready/]] as const) {
      const deps = depsWith({ micPermission: async () => permission });
      await deps.storage.saveMicState("granted");
      const root = document.createElement("div");
      document.body.appendChild(root);
      await initPopup(root, deps);
      expect(root.querySelector("#mic-state")?.textContent).toMatch(text);
    }
  });

  it("defaults to not set up yet", async () => {
    const deps = depsWith();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await initPopup(root, deps);
    expect(root.querySelector("#mic-state")?.textContent).toMatch(/not set up yet/);
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
