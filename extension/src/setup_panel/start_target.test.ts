import { describe, expect, it } from "vitest";
import { parseMeetTab, stillRunning } from "./start_target";

describe("parseMeetTab", () => {
  it("accepts a Meet call tab and returns the meeting code", () => {
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij")).toEqual({
      ok: true, platform: "meet", meetingCode: "abc-defg-hij",
    });
  });

  it("accepts the live /meet/<code> URL form", () => {
    expect(parseMeetTab("https://meet.google.com/meet/abc-defg-hij")).toEqual({
      ok: true, platform: "meet", meetingCode: "abc-defg-hij",
    });
  });

  it("strips query strings and trailing slashes", () => {
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij?authuser=0")).toEqual({
      ok: true, platform: "meet", meetingCode: "abc-defg-hij",
    });
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij/")).toEqual({
      ok: true, platform: "meet", meetingCode: "abc-defg-hij",
    });
  });

  it("refuses a non-Meet tab with a visible message", () => {
    const res = parseMeetTab("https://mail.google.com/mail/u/0/");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/not a call tab/);
  });

  it("refuses the Meet homepage and an empty tab with a visible message", () => {
    for (const url of ["https://meet.google.com/", "https://meet.google.com", undefined, ""]) {
      const res = parseMeetTab(url);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toMatch(/Open a Meet, Zoom or Teams call|Meet homepage/);
    }
  });
});

describe("stillRunning", () => {
  const rec = { tabId: 7, meetingCode: "abc-defg-hij" };
  it("is running while the hub is open and the tab is on the same call", () => {
    expect(stillRunning(rec, "https://meet.google.com/abc-defg-hij?authuser=0", true, true)).toBe(true);
  });
  it("frees Start when the call changed, the tab left Meet, or the hub is gone", () => {
    expect(stillRunning(rec, "https://meet.google.com/xyz-abcd-efg", true, true)).toBe(false);
    expect(stillRunning(rec, "https://meet.google.com/", true, true)).toBe(false);
    expect(stillRunning(rec, undefined, true, true)).toBe(false);
    expect(stillRunning(rec, "https://meet.google.com/abc-defg-hij", false, true)).toBe(false);
    expect(stillRunning(undefined, "https://meet.google.com/abc-defg-hij", true, true)).toBe(false);
  });
  it("frees Start once the hub ended the meeting (Stop, left the call, tab closed)", () => {
    // #83: the hub writes halo.meetingRunning=false on every meeting.ended,
    // while #86's running record and the hub document both outlive it.
    expect(stillRunning(rec, "https://meet.google.com/abc-defg-hij", true, false)).toBe(false);
  });
});

// Karim 2026-11-04 (DECISIONS 9.2): the Zoom and Teams web clients start a meeting too.
describe("parseMeetTab: Zoom and Teams web clients", () => {
  it("names the platform of every call tab it accepts", () => {
    expect(parseMeetTab("https://meet.google.com/abc-defg-hij")).toMatchObject({ ok: true, platform: "meet" });
  });
  it("accepts the Zoom web client and takes the meeting number", () => {
    for (const url of [
      "https://app.zoom.us/wc/81234567890/join?fromPWA=1",
      "https://app.zoom.us/wc/81234567890/start",
      "https://us05web.zoom.us/wc/join/81234567890",
    ]) {
      expect(parseMeetTab(url)).toEqual({ ok: true, platform: "zoom", meetingCode: "81234567890" });
    }
  });
  it("refuses the Zoom home page and the desktop-client launcher", () => {
    for (const url of ["https://app.zoom.us/wc/home", "https://zoom.us/j/81234567890", "https://evilzoom.us/wc/81234567890/join"]) {
      expect(parseMeetTab(url).ok).toBe(false);
    }
  });
  it("accepts a Teams web tab; the code is the meeting thread when the URL holds one", () => {
    expect(parseMeetTab("https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc123%40thread.v2/0?context=x"))
      .toEqual({ ok: true, platform: "teams", meetingCode: "19:meeting_abc123@thread.v2" });
    expect(parseMeetTab("https://teams.microsoft.com/v2/")).toEqual({ ok: true, platform: "teams", meetingCode: "teams" });
    expect(parseMeetTab("https://teams.live.com/meet/9312345678901?p=x"))
      .toEqual({ ok: true, platform: "teams", meetingCode: "9312345678901" });
  });
  it("tells the user which calls work", () => {
    const res = parseMeetTab("https://mail.google.com/mail/u/0/");
    if (!res.ok) expect(res.message).toMatch(/Meet, Zoom or Teams/);
  });
});
