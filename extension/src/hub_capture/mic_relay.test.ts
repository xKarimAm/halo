import { describe, expect, it } from "vitest";

import { createMicSender, readMicFrame } from "./mic_relay";

function fakePort(opts: { throws?: boolean } = {}) {
  const sent: unknown[] = [];
  let onDisconnect: () => void = () => {};
  return {
    sent,
    disconnect: () => onDisconnect(),
    postMessage: (msg: unknown) => {
      if (opts.throws) throw new Error("Attempting to use a disconnected port object");
      sent.push(msg);
    },
    onDisconnect: { addListener: (fn: () => void) => { onDisconnect = fn; } },
  };
}

describe("mic relay", () => {
  it("round-trips a 100 ms frame through the JSON-safe message", () => {
    const port = fakePort();
    const send = createMicSender(() => port);
    const pcm = new Uint8Array(3200).map((_, i) => i % 256);
    send(pcm, 7000);
    const frame = readMicFrame(JSON.parse(JSON.stringify(port.sent[0])));
    expect(frame?.ts).toBe(7000);
    expect(frame?.pcm).toEqual(pcm);
  });

  it("keeps one Port, reconnects after it dies", () => {
    const ports = [fakePort({ throws: true }), fakePort(), fakePort()];
    let n = 0;
    const send = createMicSender(() => ports[n++]);
    send(new Uint8Array(2), 1); // no hub yet: throws, dropped
    send(new Uint8Array(2), 2);
    send(new Uint8Array(2), 3);
    expect(n).toBe(2);
    expect(ports[1].sent).toHaveLength(2);
    ports[1].disconnect();
    send(new Uint8Array(2), 4);
    expect(n).toBe(3);
    expect(ports[2].sent).toHaveLength(1);
  });

  it("ignores anything that is not a mic frame", () => {
    expect(readMicFrame({ type: "tiles.snapshot" })).toBeNull();
    expect(readMicFrame(null)).toBeNull();
  });
});
