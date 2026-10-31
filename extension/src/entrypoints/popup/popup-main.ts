/**
 * Thin WXT entry wrapper for the toolbar popup (setup_panel lane).
 * Boots the popup with chrome-backed deps. Start implements the live
 * capture handoff: the active tab must be the Meet call (the click is the
 * user gesture Chrome needs for tabCapture), the tab's media stream id is
 * minted here and travels through the halo.pendingStart handoff; the
 * offscreen hub consumes it with getUserMedia and derives the self name.
 * Tile names come from the hub's `halo/tileNames` storage (issue #6).
 */
import "./style.css";
import { initPopup } from "../../setup_panel/popup";
import { chromeSetupStorage, MIC_STATE_KEY, type MicState } from "../../setup_panel/storage";
import {
  parseMeetTab,
  RUNNING_KEY,
  stillRunning,
  type RunningMeeting,
  type StartResult,
} from "../../setup_panel/start_target";
import { MIC_START_MESSAGE } from "../../hub_capture/mic_relay";
import { MEETING_RUNNING_KEY } from "../../hub_capture/hub";

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

/** The Start recorded at RUNNING_KEY is still live (see stillRunning). */
async function meetingRunning(): Promise<boolean> {
  const items = await chrome.storage.local.get([RUNNING_KEY, MEETING_RUNNING_KEY]);
  const rec = items?.[RUNNING_KEY] as RunningMeeting | undefined;
  if (!rec) return false;
  const tab = await chrome.tabs.get(rec.tabId).catch(() => undefined);
  // runtime.getContexts (Chrome 116+): the hub's offscreen document is open.
  const hubs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] }).catch(() => []);
  return stillRunning(rec, tab?.url, hubs.length > 0, items?.[MEETING_RUNNING_KEY] === true);
}

async function activeTab(): Promise<{ id?: number; url?: string } | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function handleStart(): Promise<StartResult> {
  const tab = await activeTab();
  const target = parseMeetTab(tab?.url);
  if (!target.ok || tab?.id === undefined) {
    return {
      ok: false,
      message: target.ok
        ? "Start from inside a Google Meet call: this tab has no id."
        : target.message,
    };
  }
  // Second guard behind the popup's Running state: a live Start is never
  // repeated (each repeat used to stack another capture).
  if (await meetingRunning()) return { ok: true };
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
  const running: RunningMeeting = { tabId: tab.id, meetingCode: target.meetingCode };
  await chrome.storage.local.set({ [RUNNING_KEY]: running });
  chrome.runtime.sendMessage({
    type: "halo/hub.start",
    platform: "meet",
    meeting_code: target.meetingCode,
    self_name: "",
    streamId,
  });
  // Mic stream 1: the Meet tab's content script opens it under Meet's own
  // mic permission (no prompt, no extra page). No content script (a Meet
  // tab opened before the extension loaded): tab audio only.
  chrome.tabs.sendMessage(tab.id, { type: MIC_START_MESSAGE }).catch(() => {});
  return warning ? { ok: true, warning } : { ok: true };
}

const root = document.getElementById("halo-setup");
if (!root) {
  throw new Error("Halo setup: missing #halo-setup root");
}
if (typeof chrome === "undefined" || !chrome) {
  throw new Error("Halo setup: chrome APIs unavailable");
}

const port = { postMessage: (msg: unknown) => chrome.runtime.connect({ name: "halo-hub" }).postMessage(msg) }; // fresh per Save: a Port opened before the hub existed is dead

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
  // Stop: the hub ends the meeting (reason "left") and stops its capture.
  onStop: () => { chrome.runtime.sendMessage({ type: "halo/hub.stop" }).catch(() => {}); },
  meetingRunning,
  onMeetCall: async () => parseMeetTab((await activeTab())?.url).ok,
  watchMicState: (onChange) => {
    chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>) => {
      const next = changes[MIC_STATE_KEY]?.newValue;
      if (next === "granted" || next === "denied") onChange(next as MicState);
    });
  },
});
