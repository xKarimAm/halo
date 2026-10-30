import { describe, expect, it, vi } from "vitest";

import type { Tile } from "../../../contracts/ext/meeting-adapter";
import type { PortSpeakerActive, PortTilesSnapshot } from "../../../contracts/ext/port";
import { createPortSync } from "./port_sync";

const tile: Tile = {
  tile_id: "id-1",
  name: "Karim Amer",
  is_self: false,
  rect: [8, 8, 400, 225],
  video_w: 1280,
  video_h: 720,
  fit: "cover",
  captions_rect: null,
};

function fakeAdapter() {
  const tileCbs: ((tiles: Tile[]) => void)[] = [];
  const speakingCbs: ((event: { tile_id: string; speaking: boolean; ts_ms: number }) => void)[] =
    [];
  const remove = <T>(cbs: T[], cb: T): (() => void) => () => {
    const index = cbs.indexOf(cb);
    if (index >= 0) {
      cbs.splice(index, 1);
    }
  };
  return {
    tiles: () => [tile],
    onTiles: (cb: (tiles: Tile[]) => void) => {
      tileCbs.push(cb);
      return remove(tileCbs, cb);
    },
    onSpeaking: (cb: (event: { tile_id: string; speaking: boolean; ts_ms: number }) => void) => {
      speakingCbs.push(cb);
      return remove(speakingCbs, cb);
    },
    emitTiles: (tiles: Tile[]) => tileCbs.forEach((cb) => cb(tiles)),
    emitSpeaking: (tile_id: string, speaking: boolean, ts_ms: number) =>
      speakingCbs.forEach((cb) => cb({ tile_id, speaking, ts_ms })),
  };
}

describe("createPortSync", () => {
  it("posts tiles.snapshot and speaker.active Port messages to the hub", () => {
    const posted: (PortTilesSnapshot | PortSpeakerActive)[] = [];
    const adapter = fakeAdapter();
    const stop = createPortSync({ postMessage: (message) => posted.push(message) }, adapter);
    adapter.emitTiles([tile]);
    adapter.emitSpeaking("id-1", true, 1760000001000);
    stop();
    expect(posted).toEqual([
      { type: "tiles.snapshot", data: { tiles: [tile] } },
      { type: "speaker.active", data: { tile_id: "id-1", speaking: true, ts_ms: 1760000001000 } },
    ]);
  });

  it("stops posting after unsubscribe", () => {
    const postMessage = vi.fn();
    const adapter = fakeAdapter();
    const stop = createPortSync({ postMessage }, adapter);
    stop();
    adapter.emitTiles([tile]);
    adapter.emitSpeaking("id-1", true, 1);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
