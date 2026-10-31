/**
 * Thin WXT entry wrapper for the toolbar popup (setup_panel lane).
 * Boots the popup with chrome-backed deps. Start implements the live
 * capture handoff: the active tab must be the Meet call (the click is the
 * user gesture Chrome needs for tabCapture), the tab's media stream id is
 * minted here and travels through the halo.pendingStart handoff; the
 * offscreen hub consumes it with getUserMedia and derives the self name.
 * Tile names come from the hub's `halo/tileNames` storage (issue #6).
 */
import { initPopup } from "../../setup_panel/popup";
import { chromeSetupStorage } from "../../setup_panel/storage";
import { parseMeetTab, type StartResult } from "../../setup_panel/start_target";

declare const chrome: any;

const TILE_NAMES_KEY = "halo/tileNames";

function getMediaStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId: string) => {
      const err = chrome.runtime.lastError;
      if (err || !streamId) reject(new Error(err?.message ?? "tabCapture failed"));
      else resolve(streamId);
    });
  });
}

async function handleStart(): Promise<StartResult> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const target = parseMeetTab(tab?.url);
  if (!target.ok || tab?.id === undefined) {
    return {
      ok: false,
      message: target.ok
        ? "Start from inside a Google Meet call: this tab has no id."
        : target.message,
    };
  }
  let streamId: string | undefined;
  let warning: string | undefined;
  try {
    streamId = await getMediaStreamId(tab.id);
  } catch (err) {
    // Real capture cannot run under Playwright; the rig starts without
    // audio. Never block the meeting on capture here: the backend fakes
    // cover the joined gate, and the manual check covers real capture.
    warning = `Audio capture failed (${err instanceof Error ? err.message : err}). Started without audio.`;
  }
  chrome.runtime.sendMessage({
    type: "halo/hub.start",
    platform: "meet",
    meeting_code: target.meetingCode,
    self_name: "",
    streamId,
  });
  return warning ? { ok: true, warning } : { ok: true };
}

const root = document.getElementById("halo-setup");
if (!root) {
  throw new Error("Halo setup: missing #halo-setup root");
}
if (typeof chrome === "undefined" || !chrome) {
  throw new Error("Halo setup: chrome APIs unavailable");
}

const port = chrome.runtime.connect({ name: "halo-hub" });

// Build stamp (wxt.config.ts version_name): which build is loaded.
const manifest = chrome.runtime.getManifest();
const build = document.createElement("p");
build.id = "halo-build";
build.textContent = `Build ${manifest.version_name ?? manifest.version}`;
root.after(build);

void initPopup(root, {
  storage: chromeSetupStorage(chrome.storage.local),
  port,
  listParticipants: async () => {
    const items = await chrome.storage.local.get(TILE_NAMES_KEY);
    const names = items?.[TILE_NAMES_KEY];
    return Array.isArray(names) ? names.filter((n) => typeof n === "string") : [];
  },
  onStart: () => handleStart(),
  onRequestMicPermission: () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
  },
});
