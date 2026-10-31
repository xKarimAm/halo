// Start gate: the popup's Start must come from a user gesture on the Meet
// tab (Chrome needs the gesture for tabCapture). The active tab's URL is
// checked here (pure, unit-tested); the entry wrapper supplies it and shows
// the message.
export type MeetTabTarget = { ok: true; meetingCode: string } | { ok: false; message: string };

const MEET_HOST = "meet.google.com";
const CODE_SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)+$/i;

/** Outcome of the popup's Start handoff: refusal blocks, warning degrades. */
export type StartResult = { ok: true; warning?: string } | { ok: false; message: string };

export function parseMeetTab(url: string | undefined): MeetTabTarget {
  if (!url) {
    return { ok: false, message: "Open a Google Meet call, then press Start." };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: "Open a Google Meet call, then press Start." };
  }
  if (parsed.hostname !== MEET_HOST) {
    return {
      ok: false,
      message: "Start from inside a Google Meet call: this tab is not a Meet tab.",
    };
  }
  const segment = parsed.pathname.split("/").filter((s) => s.length > 0)[0];
  if (!segment || !CODE_SEGMENT.test(segment)) {
    return {
      ok: false,
      message: "Start from inside a Meet call, not the Meet homepage.",
    };
  }
  return { ok: true, meetingCode: segment };
}
