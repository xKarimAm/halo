import { describe, expect, it } from "vitest";
import { MIC_DEVICE_KEY, rememberMeetMic } from "./mic_device";

function streamWith(tracks: { kind: string; deviceId: string }[]): MediaStream {
  const all = tracks.map((t) => ({ kind: t.kind, getSettings: () => ({ deviceId: t.deviceId }) }));
  return {
    getAudioTracks: () => all.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

describe("rememberMeetMic", () => {
  // Live 2026-11-01: Windows' default mic was a silent virtual device
  // (SteelSeries Sonar); Meet used the headset. Halo must open Meet's mic.
  it("records the mic Meet opened, and still returns Meet its stream", async () => {
    const dataset: Record<string, string | undefined> = {};
    const stream = streamWith([{ kind: "video", deviceId: "cam" }, { kind: "audio", deviceId: "headset-id" }]);
    const devices = { getUserMedia: async (_c?: unknown) => stream };
    rememberMeetMic(devices, { dataset });
    expect(await devices.getUserMedia({ audio: true, video: true })).toBe(stream);
    expect(dataset[MIC_DEVICE_KEY]).toBe("headset-id");
  });

  it("a video-only call leaves the last mic in place", async () => {
    const dataset: Record<string, string | undefined> = { [MIC_DEVICE_KEY]: "headset-id" };
    const devices = { getUserMedia: async (_c?: unknown) => streamWith([{ kind: "video", deviceId: "cam" }]) };
    rememberMeetMic(devices, { dataset });
    await devices.getUserMedia({ video: true });
    expect(dataset[MIC_DEVICE_KEY]).toBe("headset-id");
  });
});
