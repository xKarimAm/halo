// Overlay core (Frame mode first): store + layout + renderer. Tokens from
// docs/ui/overlay-mix-b.html; geometry/timing from docs/ui/OVERLAY-UX.md.
// DOM is built with textContent only (Meet enforces Trusted Types). One
// chip element per point id; renders only move/update/fold existing chips.
import type {
  FacesUpdate, PointsUpsert, SpeakerActive, TagsSet, TilesSnapshot, TilesSnapshotTiles,
} from "../../../contracts/ext/gen/types";
import { AGEING_FRACTION, KIND_COLORS, POINT_LIFETIME_MS } from "./tokens";

export type PointUpsert = PointsUpsert;

export class FakeClock {
  constructor(public now = 0) {}
}
export class SystemClock {
  get now(): number { return Date.now(); }
}

export interface El {
  textContent: string;
  setAttribute(name: string, value: string): void;
  appendChild(child: El): El;
  remove(): void;
  classList: { add(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean };
  style: { setProperty(name: string, value: string): void };
}
export interface DocLike {
  createElement(tag: string): El;
}

export const CONSENT_NOTICE =
  "Halo is recording and transcribing this meeting on this PC to show live points and notes. " +
  "Recordings and notes stay on this PC until deleted. / " +
  "يقوم Halo بتسجيل هذا الاجتماع ونسخه على هذا الجهاز لعرض النقاط والملاحظات المباشرة. " +
  "تبقى التسجيلات والملاحظات على هذا الجهاز حتى يتم حذفها.";

export async function copyConsentNotice(
  clipboard: { writeText(text: string): unknown },
): Promise<string> {
  await clipboard.writeText(CONSENT_NOTICE); // clipboard only; Meet chat DOM is never touched
  return CONSENT_NOTICE;
}

export function quoteDirection(quote: string): "rtl" | "ltr" {
  const arabic = (quote.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (quote.match(/[A-Za-z]/g) ?? []).length;
  return arabic >= latin && arabic > 0 ? "rtl" : "ltr";
}

export interface TileGeom {
  rect: number[];
  video_w: number;
  video_h: number;
  fit: "cover" | "contain";
  is_self: boolean;
}

/** Project a 0..1 face box from the source frame onto the tile (object-fit). */
export function projectFaceBox(tile: TileGeom, box: number[]): { x: number; y: number; w: number; h: number } {
  const [rx, ry, tw, th] = tile.rect;
  const scale = tile.fit === "cover"
    ? Math.max(tw / tile.video_w, th / tile.video_h)
    : Math.min(tw / tile.video_w, th / tile.video_h);
  const ox = (tw - tile.video_w * scale) / 2;
  const oy = (th - tile.video_h * scale) / 2;
  let x = rx + ox + box[0] * tile.video_w * scale;
  const w = box[2] * tile.video_w * scale;
  if (tile.is_self) x = rx + tw - (x - rx) - w; // mirrored self tile flips x
  return { x, y: ry + oy + box[1] * tile.video_h * scale, w, h: box[3] * tile.video_h * scale };
}

interface StoredPoint extends PointsUpsert {
  arrivedMs: number;
  userTagged: boolean;
  el?: El;
}

export class Overlay {
  points = new Map<string, StoredPoint>();
  hidden = false;
  status: unknown = null;
  notesToast: unknown = null;
  perFace = 3;
  private tiles = new Map<string, TilesSnapshotTiles>();
  private tileOrder: string[] = [];
  private faces = new Map<string, FacesUpdate["face"]>();
  private seenEnvelopes = new Set<string>();
  private thinkingStart = new Map<string, number>();
  private layers = new Map<string, El>();
  private overflowEls = new Map<string, El>();

  constructor(private clock: { now: number }) {}

  applyTiles(snapshot: TilesSnapshot): void {
    this.tiles.clear();
    this.tileOrder = snapshot.tiles.map((t) => t.tile_id);
    for (const t of snapshot.tiles) this.tiles.set(t.tile_id, t);
  }

  applyFaces(update: FacesUpdate): void {
    this.faces.set(update.tile_id, update.face);
  }

  applySpeakerActive(active: SpeakerActive): void {
    if (!active.speaking) this.thinkingStart.set(active.tile_id, this.clock.now);
  }

  applyEnvelope(env: { id: string; type: string; data: Record<string, unknown> }): void {
    if (this.seenEnvelopes.has(env.id)) return; // dedupe by envelope id
    this.seenEnvelopes.add(env.id);
    const data = env.data as never;
    if (env.type === "points.upsert") this.applyPointsUpsert(data, env.id);
    else if (env.type === "tags.set") this.applyTagsSet(data);
    else if (env.type === "speaker.mapped") {
      const mapped = data as { tile_id: string; name: string };
      for (const p of this.points.values()) {
        if (p.tile_id === mapped.tile_id) p.speaker_name = mapped.name;
      }
    } else if (env.type === "system.status") this.status = env.data;
    else if (env.type === "notes.ready") this.notesToast = env.data;
  }

  applyPointsUpsert(point: PointsUpsert, _envelopeId?: string): void {
    if (point.replaces) this.points.delete(point.replaces);
    const existing = this.points.get(point.point_id);
    if (existing) {
      Object.assign(existing, point, { arrivedMs: this.clock.now }); // same element, lifetime restarts
    } else {
      this.points.set(point.point_id, { ...point, arrivedMs: this.clock.now, userTagged: false });
    }
    this.thinkingStart.delete(point.tile_id); // a point landing ends thinking
  }

  applyTagsSet(tag: TagsSet): void {
    if (tag.target !== "point") return;
    const stored = this.points.get(tag.target_id);
    if (!stored) return;
    if (tag.source === "user") {
      stored.userTagged = true;
    } else if (stored.userTagged) {
      return; // a model tag after a user tag is ignored everywhere
    }
    if (tag.kind) stored.kind = tag.kind;
    if (tag.urgency) stored.urgency = tag.urgency;
  }

  private live(tileId: string): StoredPoint[] {
    return [...this.points.values()]
      .filter((p) => p.tile_id === tileId && this.clock.now - p.arrivedMs < POINT_LIFETIME_MS)
      .sort((a, b) => a.rank - b.rank || a.arrivedMs - b.arrivedMs);
  }

  visiblePoints(tileId: string): StoredPoint[] {
    return this.live(tileId).slice(0, Math.min(this.perFace, 3));
  }

  overflowCount(tileId: string): number {
    return Math.max(0, this.live(tileId).length - this.visiblePoints(tileId).length);
  }

  isAged(pointId: string): boolean {
    const p = this.points.get(pointId);
    return !!p && this.clock.now - p.arrivedMs > AGEING_FRACTION * POINT_LIFETIME_MS;
  }

  layout(tileId: string): {
    mode: "face" | "frame";
    namePos: { x: number; y: number };
    stackPos: { x: number; y: number };
    faceBox?: { x: number; y: number; w: number; h: number };
  } {
    const tile = this.tiles.get(tileId);
    const face = this.faces.get(tileId);
    const index = this.tileOrder.indexOf(tileId);
    if (tile && face && index >= 0 && index < 6) {
      const box = projectFaceBox(tile, face.box);
      const roomRight = tile.rect[0] + tile.rect[2] - (box.x + box.w);
      const stackX = roomRight >= box.x - tile.rect[0]
        ? box.x + box.w + Math.max(10, tile.rect[2] * 0.026)
        : Math.max(tile.rect[0] + 10, box.x - 160);
      return {
        mode: "face",
        namePos: { x: box.x + box.w / 2, y: Math.max(tile.rect[1] + 21, box.y - 6) },
        stackPos: { x: stackX, y: box.y },
        faceBox: box,
      };
    }
    // Frame mode (this PR's shipped path): name + stack pinned inside the tile.
    return { mode: "frame", namePos: { x: 10, y: 10 }, stackPos: { x: 10, y: 44 } };
  }

  thinking(tileId: string, reducedMotion: boolean): "sweep" | "dotted" | null {
    const start = this.thinkingStart.get(tileId);
    if (start === undefined || this.clock.now - start >= 5000) return null;
    return reducedMotion ? "dotted" : "sweep";
  }

  handleKey(ev: { altKey: boolean; ctrlKey: boolean; key: string; repeat: boolean }): boolean {
    if (!ev.altKey || ev.key.toLowerCase() !== "h" || ev.ctrlKey) return false; // Ctrl+Alt+H passes to Meet
    if (!ev.repeat) this.hidden = !this.hidden; // bare Alt+H only; key repeat ignored
    return true;
  }

  badgeText(): string {
    return this.hidden ? "Halo · hidden" : "Halo";
  }

  popover(pointId: string): {
    kind: string; speaker: string; text: string; quote: string;
    quoteDir: "rtl" | "ltr"; urgentWord?: string;
  } | null {
    const p = this.points.get(pointId);
    if (!p) return null;
    return {
      kind: p.kind, speaker: p.speaker_name, text: p.text, quote: p.quote,
      quoteDir: quoteDirection(p.quote),
      urgentWord: p.urgency === "urgent" ? "Urgent" : undefined, // plain text only, no bubble mark
    };
  }

  render(doc: DocLike, root: El & { children?: El[] }, _now?: number): void {
    for (const tileId of this.tileOrder) {
      let layer = this.layers.get(tileId);
      if (!layer) {
        layer = doc.createElement("div");
        layer.setAttribute("data-tile-id", tileId);
        this.layers.set(tileId, layer);
        root.appendChild(layer);
      }
      const detach = (el: El & { children?: El[] }) => { el.children = []; };
      detach(layer as El & { children?: El[] });
      const layout = this.layout(tileId);
      const name = doc.createElement("span");
      name.classList.add("halo-name");
      name.textContent = this.tiles.get(tileId)?.name ?? "";
      name.style.setProperty("left", `${layout.namePos.x}px`);
      name.style.setProperty("top", `${layout.namePos.y}px`);
      layer.appendChild(name);
      const stack = doc.createElement("div");
      stack.classList.add("halo-stack");
      stack.style.setProperty("left", `${layout.stackPos.x}px`);
      stack.style.setProperty("top", `${layout.stackPos.y}px`);
      layer.appendChild(stack);
      if (this.hidden) continue;
      for (const stored of this.visiblePoints(tileId)) {
        if (!stored.el) {
          stored.el = doc.createElement("button");
          stored.el.setAttribute("data-point-id", stored.point_id);
        }
        const chip = stored.el;
        chip.setAttribute("lang", stored.lang);
        chip.setAttribute("dir", stored.lang === "ar" ? "rtl" : "ltr");
        chip.classList.add("halo-chip");
        chip.textContent = "";
        const mark = doc.createElement("span");
        mark.classList.add("halo-kind");
        mark.style.setProperty("background", KIND_COLORS[stored.kind]);
        chip.appendChild(mark);
        const label = doc.createElement("span");
        label.textContent = stored.text;
        chip.appendChild(label);
        stack.appendChild(chip);
      }
      const overflow = this.overflowCount(tileId);
      if (overflow > 0) {
        let el = this.overflowEls.get(tileId);
        if (!el) {
          el = doc.createElement("span");
          this.overflowEls.set(tileId, el);
        }
        el.textContent = `+${overflow}`;
        stack.appendChild(el);
      }
    }
  }
}
