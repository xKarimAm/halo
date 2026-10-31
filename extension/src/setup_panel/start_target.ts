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
  return { ok: true, meetingCode: segment };
}
