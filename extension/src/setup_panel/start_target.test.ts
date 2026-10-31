import { describe, expect, it } from "vitest";
import { parseMeetTab, stillRunning } from "./start_target";

describe("parseMeetTab", () => {
  it("accepts a Meet call tab and returns the meeting code", () => {
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij")).toEqual({
      ok: true, meetingCode: "abc-defg-hij",
    });
  });

  it("accepts the live /meet/<code> URL form", () => {
    expect(parseMeetTab("https://meet.google.com/meet/pft-kcbx-bxv")).toEqual({
      ok: true, meetingCode: "pft-kcbx-bxv",
    });
  });

  it("strips query strings and trailing slashes", () => {
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij?authuser=0")).toEqual({
      ok: true, meetingCode: "abc-defg-hij",
    });
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij/")).toEqual({
      ok: true, meetingCode: "abc-defg-hij",
    });
  });

  it("refuses a non-Meet tab with a visible message", () => {
    const res = parseMeetTab("https://mail.google.com/mail/u/0/");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/not a Meet tab/);
  });

  it("refuses the Meet homepage and an empty tab with a visible message", () => {
    for (const url of ["https://meet.google.com/", "https://meet.google.com", undefined, ""]) {
      const res = parseMeetTab(url);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/Open a Google Meet call|Meet homepage/);
    }
  });
});

describe("stillRunning", () => {
  const rec = { tabId: 7, meetingCode: "abc-defg-hij" };
  it("is running while the hub is open and the tab is on the same call", () => {
    expect(stillRunning(rec, "https://meet.google.com/abc-defg-hij?authuser=0", true)).toBe(true);
  });
  it("frees Start when the call changed, the tab left Meet, or the hub is gone", () => {
    expect(stillRunning(rec, "https://meet.google.com/xyz-abcd-efg", true)).toBe(false);
    expect(stillRunning(rec, "https://meet.google.com/", true)).toBe(false);
    expect(stillRunning(rec, undefined, true)).toBe(false);
    expect(stillRunning(rec, "https://meet.google.com/abc-defg-hij", false)).toBe(false);
    expect(stillRunning(undefined, "https://meet.google.com/abc-defg-hij", true)).toBe(false);
  });
});
