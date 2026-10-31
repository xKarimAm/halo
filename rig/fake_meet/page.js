// Fake Meet page: builds probe-faithful tiles (issue #47) from
// window.__halo_fixture. DOM is built with createElement/textContent only
// (the server sends Trusted Types headers, so innerHTML building would
// throw, as on Meet).
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") || "video";
  const captionsOn = params.get("captions") !== "0";
  const fixture = window.__halo_fixture;
  const grid = document.getElementById("g");
  const truth = { mode, tiles: [], faces: [] };
  window.__halo_truth = truth;

  function paint(ctx, p, w, h) {
    ctx.fillStyle = "#5f6368";
    ctx.fillRect(0, 0, w, h);
    if (!p.face) return;
    const [fx, fy, fw, fh] = p.face;
    const cx = (fx + fw / 2) * w, cy = (fy + fh / 2) * h, r = (fw * w) / 2;
    ctx.fillStyle = "#e8c39e";
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#202124";
    for (const s of [-0.35, 0.35]) {
      ctx.beginPath(); ctx.arc(cx + s * r, cy - 0.2 * r, r * 0.09, 0, Math.PI * 2); ctx.fill();
    }
  }

  function addTile(p) {
    const tile = document.createElement("div");
    tile.className = "t";
    tile.setAttribute("data-participant-id", p.tile_id);
    tile.setAttribute("data-requested-participant-id", p.tile_id);
    if (p.media_id) tile.setAttribute("data-tile-media-id", p.media_id);
    const canvas = document.createElement("canvas");
    canvas.className = "tile";
    canvas.width = 640; canvas.height = 360; // mismatched aspect vs 400x225 tile: cover crops
    paint(canvas.getContext("2d"), p, 640, 360);
    if (mode !== "canvas-only") {
      const video = document.createElement("video");
      video.autoplay = true; video.muted = true;
      video.srcObject = canvas.captureStream(30);
      tile.appendChild(video);
    } else {
      tile.appendChild(canvas);
    }
    const name = document.createElement("span");
    name.className = "notranslate";
    name.textContent = p.name;
    tile.appendChild(name);
    if (p.is_self) {
      // Probe: only your own tile has the Backgrounds-and-effects button,
      // whose icon ligature is not localized.
      const fx = document.createElement("button");
      fx.setAttribute("aria-label", "Backgrounds and effects");
      const glyph = document.createElement("i");
      glyph.textContent = "visual_effects";
      fx.appendChild(glyph);
      tile.appendChild(fx);
    } else {
      const pin = document.createElement("button");
      pin.setAttribute("aria-label", `Pin ${p.name} to your main screen`);
      const glyph = document.createElement("span");
      glyph.className = "notranslate";
      glyph.textContent = "keep_outline";
      pin.appendChild(glyph);
      tile.appendChild(pin);
    }
    // Probe: speaking is class sxlEM on the [jsname="QgSmzd"] descendant.
    const signal = document.createElement("div");
    signal.setAttribute("jsname", "QgSmzd");
    tile.appendChild(signal);
    grid.appendChild(tile);
    truth.tiles.push({ tile_id: p.tile_id, name: p.name, is_self: !!p.is_self });
    if (p.face) truth.faces.push({ tile_id: p.tile_id, box: p.face });
    return tile;
  }

  const tiles = new Map(fixture.participants.map((p) => [p.tile_id, addTile(p)]));

  window.__halo_set_speaking = (tileId, speaking) => {
    const tile = tiles.get(tileId);
    if (!tile) return;
    const signal = tile.querySelector('[jsname="QgSmzd"]');
    if (signal) signal.classList.toggle("sxlEM", !!speaking);
    tile.classList.toggle("speaking", !!speaking); // visual outline only
  };
  window.__halo_join = (p) => { tiles.set(p.tile_id, addTile(p)); };
  window.__halo_leave = (tileId) => {
    const tile = tiles.get(tileId);
    if (tile) { tile.remove(); tiles.delete(tileId); }
    truth.tiles = truth.tiles.filter((t) => t.tile_id !== tileId);
    truth.faces = truth.faces.filter((f) => f.tile_id !== tileId);
  };
  window.__halo_share = () => window.__halo_join(
    { tile_id: "spaces/x/devices/share", media_id: "share", name: "Screen share", is_self: false, face: null });

  for (const [after, tileId, speaking] of fixture.speaking) {
    setTimeout(() => window.__halo_set_speaking(tileId, speaking), after);
  }

  // Probe: full-width captions band at the bottom; the aria-label is the
  // adapter's anchor. Scriptable via __halo_captions for L3 asserts.
  let band = null;
  if (captionsOn) {
    band = document.createElement("div");
    band.id = "captions";
    band.setAttribute("role", "region");
    band.setAttribute("aria-label", "Captions");
    document.body.appendChild(band);
  }
  window.__halo_captions = (text) => {
    if (!band) return;
    band.textContent = "";
    for (const line of String(text).split("\n")) {
      const row = document.createElement("div");
      row.textContent = line;
      band.appendChild(row);
    }
  };
  window.__halo_captions((fixture.captions || []).join("\n"));
})();
