import { describe, expect, it, vi } from "vitest";

import { PairingError, pairWithCode, PAIR_URL } from "./pairing";
import { pairAuto, PAIR_AUTO_URL } from "./pairing";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pairWithCode", () => {
  it("posts the code to /pair and returns the token", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { token: "tok-abc" }));
    const token = await pairWithCode("123456", fetchFn);
    expect(token).toBe("tok-abc");
    expect(fetchFn).toHaveBeenCalledOnce();
    const firstCall = fetchFn.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe(PAIR_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ code: "123456" });
  });

  it("rejects a malformed code without touching the network", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { token: "tok-abc" }));
    await expect(pairWithCode("12ab", fetchFn)).rejects.toThrow(PairingError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws PairingError on a wrong code and stores nothing", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, { detail: "bad code" }));
    const stored: string[] = [];
    await expect(pairWithCode("000000", fetchFn)).rejects.toMatchObject({ status: 401 });
    expect(stored).toEqual([]);
  });

  it("throws PairingError when the backend is unreachable", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(pairWithCode("123456", fetchFn)).rejects.toThrow(PairingError);
  });

  it("throws PairingError on a 200 without a token field", async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { nope: true }));
    await expect(pairWithCode("123456", fetchFn)).rejects.toThrow(PairingError);
  });
});


describe("pairAuto (Karim 2026-11-04)", () => {
  it("posts to /pair/auto and returns the token", async () => {
    const calls: string[] = [];
    const token = await pairAuto(async (url) => { calls.push(url); return new Response(JSON.stringify({ token: "t1" }), { status: 200 }); });
    expect(token).toBe("t1");
    expect(calls).toEqual([PAIR_AUTO_URL]);
  });
  it("throws with the HTTP status when refused, and status 0 when the app is down", async () => {
    await expect(pairAuto(async () => new Response("{}", { status: 403 }))).rejects.toMatchObject({ status: 403 });
    await expect(pairAuto(async () => { throw new TypeError("Failed to fetch"); })).rejects.toMatchObject({ status: 0 });
  });
});
