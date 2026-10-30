// Scripted fixture for the Fake Meet page. Tile ids/names mirror the seed
// fixture; face boxes are tile-relative [x, y, w, h] in 0..1 (ground truth
// the Face Detector spec consumes, IoU >= 0.7). t0_ms is the meeting clock
// anchor the harness aligns envelopes against.
window.__halo_fixture = {
  t0_ms: 0,
  participants: [
    { tile_id: "spaces/x/devices/1", media_id: "m1", name: "Karim Amer", is_self: true,
      face: [0.38, 0.18, 0.24, 0.42] },
    { tile_id: "spaces/x/devices/2", media_id: "m2", name: "ليلى حسن", is_self: false,
      face: [0.40, 0.20, 0.22, 0.40] },
    { tile_id: "spaces/x/devices/3", media_id: null, name: "Sam Lee", is_self: false,
      face: null },
  ],
  // Speaking timeline: [after_ms, tile_id, speaking]
  speaking: [
    [300, "spaces/x/devices/1", true],
    [900, "spaces/x/devices/1", false],
    [1200, "spaces/x/devices/2", true],
    [1800, "spaces/x/devices/2", false],
  ],
};
