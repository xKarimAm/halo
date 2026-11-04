import type { MeetingAdapter, SpeakingEvent, Tile } from "../../../contracts/ext/meeting-adapter";
import { parseMeetTab } from "../setup_panel/start_target";

type Unsubscribe = () => void;

/**
 * Zoom and Teams web clients (DECISIONS 9.2, Karim 2026-11-04). Their DOM is
 * not mapped yet, so this adapter reads no names or speaking highlight. While
 * Halo runs it reports two tiles: "self" (the mic turns land there) and "call"
 * (every tab turn, placed on the page's largest video). Without tiles the
 * Correlator would hold every turn. Before Start it reports none, so the
 * "Halo is off" nudge stays quiet on every Zoom/Teams page.
 * ponytail: one tile for everyone remote; per-person tiles when someone maps the DOM in a live call.
 */
export class CallPageAdapter implements MeetingAdapter {
  private running = false;
  private last = "[]";
  private readonly tileCbs = new Set<(tiles: Tile[]) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly platform: "zoom" | "teams", options: { pollIntervalMs?: number } = {}) {
    const ms = options.pollIntervalMs ?? 1000;
    if (ms > 0) this.timer = setInterval(() => this.emit(), ms); // the video moves with the layout
  }

  matches(url: string): boolean {
    const target = parseMeetTab(url);
    return target.ok && target.platform === this.platform;
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.emit();
  }

  /** The largest visible video on the page: the speaker view or the shared screen. */
  video(id: string): HTMLVideoElement | null {
    if (id !== "call") return null;
    let best: HTMLVideoElement | null = null;
    let area = 0;
    for (const v of Array.from(document.querySelectorAll("video"))) {
      const r = v.getBoundingClientRect();
      if (r.width * r.height > area) {
        area = r.width * r.height;
        best = v;
      }
    }
    return area > 0 ? best : null;
  }

  tiles(): Tile[] {
    if (!this.running) return [];
    const v = this.video("call");
    const r = v?.getBoundingClientRect();
    const rect = r ? [r.x, r.y, r.width, r.height] : [0, 0, window.innerWidth, window.innerHeight];
    const base = { video_w: v?.videoWidth ?? 0, video_h: v?.videoHeight ?? 0, fit: "contain" as const, captions_rect: null };
    return [
      { tile_id: "call", name: this.platform === "zoom" ? "Zoom call" : "Teams call", is_self: false, rect, ...base },
      // The viewer's own points stack on the right 40% of the same view, apart from the call's.
      { tile_id: "self", name: "You", is_self: true, rect: [rect[0] + rect[2] * 0.6, rect[1], rect[2] * 0.4, rect[3]], ...base, video_w: 0, video_h: 0 },
    ];
  }

  onTiles(cb: (tiles: Tile[]) => void): Unsubscribe {
    this.tileCbs.add(cb);
    return () => this.tileCbs.delete(cb);
  }

  onSpeaking(_cb: (event: SpeakingEvent) => void): Unsubscribe {
    return () => {};
  }

  onJoin(_cb: (tile: Tile) => void): Unsubscribe {
    return () => {};
  }

  onLeave(_cb: (tile: Tile) => void): Unsubscribe {
    return () => {};
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.tileCbs.clear();
  }

  private emit(): void {
    const tiles = this.tiles();
    const json = JSON.stringify(tiles);
    if (json === this.last) return;
    this.last = json;
    for (const cb of this.tileCbs) cb(tiles);
  }
}
