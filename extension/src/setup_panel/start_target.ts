// Start gate: the popup's Start must come from a user gesture on the Meet
// tab (Chrome needs the gesture for tabCapture). The active tab's URL is
// checked here (pure, unit-tested); the entry wrapper supplies it and shows
// the message.
export type CallPlatform = "meet" | "zoom" | "teams";
export type MeetTabTarget =
  | { ok: true; platform: CallPlatform; meetingCode: string }
  | { ok: false; message: string };

const MEET_HOST = "meet.google.com";
const CODE_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)+$/i;
const NOT_A_CALL = "Start from inside a Meet, Zoom or Teams call: this tab is not a call tab.";
const OPEN_A_CALL = "Open a Meet, Zoom or Teams call, then press Start.";
// Zoom web client: app.zoom.us/wc/<number>/join|start, or <sub>.zoom.us/wc/join/<number>.
const ZOOM_PATH = /^\/wc\/(?:join\/)?(\d{9,12})(?:\/|$)/;
// Teams web: the in-call URL is not stable (verified only for the join links),
// so any Teams page counts, all under one code: a join link that redirects to
// /v2/ must not split one meeting in two. A new Teams meeting needs Stop first.
const TEAMS_HOSTS = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"];

function isHost(host: string, base: string): boolean {
  return host === base || host.endsWith("." + base);
}

function zoomOrTeams(parsed: URL): MeetTabTarget | null {
  if (isHost(parsed.hostname, "zoom.us")) {
    const m = ZOOM_PATH.exec(parsed.pathname);
    return m ? { ok: true, platform: "zoom", meetingCode: m[1] }
      : { ok: false, message: "Join the Zoom call in the browser (Join from your browser), then press Start." };
  }
  if (TEAMS_HOSTS.some((h) => isHost(parsed.hostname, h))) {
    return { ok: true, platform: "teams", meetingCode: "teams" };
  }
  return null;
}

/** Outcome of the popup's Start handoff: refusal blocks, warning degrades. */
export type StartResult = { ok: true; warning?: string } | { ok: false; message: string };

/** Storage key: the Start that is running (written by the popup at Start). */
export const RUNNING_KEY = "halo.runningMeeting";

export interface RunningMeeting {
  tabId: number;
  meetingCode: string;
}

/**
 * A Start stays running while the hub is open and its tab is still on the
 * same call: leaving the call (or closing the tab) frees Start for the next
 * one, and so does the hub ending the meeting (Stop, left, tab closed);
 * anything else makes a repeat press a no-op instead of a second capture.
 */
export function stillRunning(
  rec: RunningMeeting | undefined,
  tabUrl: string | undefined,
  hubOpen: boolean,
  hubMeetingRunning: boolean, // the hub's halo.meetingRunning: false after any meeting.ended
): boolean {
  if (!rec || !hubOpen || !hubMeetingRunning) return false;
  const tab = parseMeetTab(tabUrl);
  return tab.ok && tab.meetingCode === rec.meetingCode;
}

export function parseMeetTab(url: string | undefined): MeetTabTarget {
  if (!url) {
    return { ok: false, message: OPEN_A_CALL };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: OPEN_A_CALL };
  }
  if (parsed.protocol !== "https:") return { ok: false, message: NOT_A_CALL };
  if (parsed.hostname !== MEET_HOST) return zoomOrTeams(parsed) ?? { ok: false, message: NOT_A_CALL };
  // Live Meet URLs can be /meet/<code> as well as /<code> (seen 2026-10-31),
  // so take the last segment that looks like a meeting code.
  const segment = parsed.pathname
    .split("/")
    .filter((s) => CODE_SEGMENT.test(s))
    .pop();
  if (!segment) {
    return {
      ok: false,
      message: "Start from inside a Meet call, not the Meet homepage.",
    };
  }
  return { ok: true, platform: "meet", meetingCode: segment };
}
