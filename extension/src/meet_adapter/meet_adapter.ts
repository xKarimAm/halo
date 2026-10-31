import type {
  MeetingAdapter,
  SpeakingEvent,
  Tile,
} from "../../../contracts/ext/meeting-adapter";

export interface MeetAdapterOptions {
  /** Subtree to scan. Defaults to `document` (the Meet tab). Tests pass a fixture. */
  root?: Document | Element;
  /** Safety poll interval in ms. Defaults to 500; 0 disables the poll. */
  pollIntervalMs?: number;
  /** Clock for `speaker.active.ts_ms`. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * DOM anchors this adapter reads, from the day-0 `meet-overlay` probe
 * (issue #47); see conventions.md. Keyed on `data-participant-id` plus the
 * probe's `jsname` hook — never on obfuscated class names (those can change
 * on any Meet release, so both probe strings stay in this table).
 */
export const CONVENTIONS = {
  /** Tile roots carry the stable participant id (`spaces/<id>/devices/<n>`). */
  tileAttr: "data-participant-id",
  /** Non-tile rows (e.g. the participant panel list) are never tiles. */
  excludedRole: "listitem",
  /** Participant display name. */
  nameSelector: "span.notranslate",
  /** Self tile: contains the "Backgrounds and effects" `<i>` (ligature not localized). */
  selfIconText: "visual_effects",
  /** Speaking highlight: this descendant gains `speakingClass` while audio is active. */
  speakingJsname: "QgSmzd",
  speakingClass: "sxlEM",
  /** Hold `speaking: true` this long after the class drops, against flicker. */
  speakingHoldMs: 300,
  /** Captions band; absent (or captions off) means null. The aria-label is
   * localized, so a text-bearing region is the fallback. */
  captionsSelector: '[role="region"][aria-label="Captions"]',
} as const;

type Unsubscribe = () => void;

const TILE_SELECTOR = `[${CONVENTIONS.tileAttr}]`;

/** This module's DOM scope: Google Meet web only (Zoom/Teams are post-MVP). */
export function matchesMeetUrl(url: string): boolean {
  return /^https:\/\/meet\.google\.com([/?#]|$)/.test(url);
}

/**
 * The only module that knows Meet's DOM. Reads tiles, names, the self tile,
 * the speaking highlight, rects, `<video>` refs, object-fit and the captions
 * band. Emits `tiles.snapshot`-shaped values in-tab; the Port leg to the hub
 * is `createPortSync` in port_sync.ts.
 */
export class MeetDomAdapter implements MeetingAdapter {
  readonly platform = "meet";

  private readonly scope: Document | Element;
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly tileCbs = new Set<(tiles: Tile[]) => void>();
  private readonly speakingCbs = new Set<(event: SpeakingEvent) => void>();
  private readonly joinCbs = new Set<(tile: Tile) => void>();
  private readonly leaveCbs = new Set<(tile: Tile) => void>();
  private observer: MutationObserver | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevIds: string[] | null = null;
  private prevById = new Map<string, Tile>();
  private prevSnapshot: string | null = null;
  private speakingState = new Map<string, boolean>();
  private holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private resizeTarget: Window | null = null;
  private readonly onResize = (): void => {
    this.rescan();
  };

  constructor(options: MeetAdapterOptions = {}) {
    this.scope = options.root ?? document;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.now = options.now ?? (() => Date.now());
    const baseline = this.tiles();
    this.prevIds = baseline.map((tile) => tile.tile_id);
    this.prevById = new Map(baseline.map((tile) => [tile.tile_id, tile]));
    this.prevSnapshot = JSON.stringify(baseline);
    const isDocument = typeof Document !== "undefined" && this.scope instanceof Document;
    const view = isDocument
      ? (this.scope as Document).defaultView
      : (this.scope as Element).ownerDocument?.defaultView;
    if (view) {
      this.resizeTarget = view;
      view.addEventListener("resize", this.onResize);
    }
    if (typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver((records) => this.onMutations(records));
      this.observer.observe(this.scope, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    if (this.pollIntervalMs > 0) {
      this.timer = setInterval(() => this.rescan(), this.pollIntervalMs);
    }
  }

  matches(url: string): boolean {
    return matchesMeetUrl(url);
  }

  tiles(): Tile[] {
    const scopeDoc = this.scope;
    const seen = new Map<string, Element[]>();
    const order: string[] = [];
    for (const el of Array.from(scopeDoc.querySelectorAll(TILE_SELECTOR))) {
      if (el.getAttribute("role") === CONVENTIONS.excludedRole) {
        continue;
      }
      const id = el.getAttribute(CONVENTIONS.tileAttr) ?? "";
      if (id.length === 0) {
        continue;
      }
      if (!seen.has(id)) {
        seen.set(id, []);
        order.push(id);
      }
      seen.get(id)?.push(el);
    }
    const tiles: Tile[] = [];
    for (const id of order) {
      const tile = this.readTile(id, seen.get(id) ?? []);
      if (tile) {
        tiles.push(tile);
      }
    }
    return tiles;
  }

  onTiles(cb: (tiles: Tile[]) => void): Unsubscribe {
    this.tileCbs.add(cb);
    return () => {
      this.tileCbs.delete(cb);
    };
  }

  onSpeaking(cb: (event: SpeakingEvent) => void): Unsubscribe {
    this.speakingCbs.add(cb);
    return () => {
      this.speakingCbs.delete(cb);
    };
  }

  onJoin(cb: (tile: Tile) => void): Unsubscribe {
    this.joinCbs.add(cb);
    return () => {
      this.joinCbs.delete(cb);
    };
  }

  onLeave(cb: (tile: Tile) => void): Unsubscribe {
    this.leaveCbs.add(cb);
    return () => {
      this.leaveCbs.delete(cb);
    };
  }

  /** Re-read tiles and fire join/leave/tiles events for what changed. */
  rescan(): void {
    const current = this.tiles();
    const ids = current.map((tile) => tile.tile_id);
    if (this.prevIds === null) {
      this.prevIds = ids;
      this.prevById = new Map(current.map((tile) => [tile.tile_id, tile]));
      return;
    }
    const prev = new Set(this.prevIds);
    const next = new Set(ids);
    for (const tile of current) {
      if (!prev.has(tile.tile_id)) {
        this.joinCbs.forEach((cb) => cb(tile));
      }
    }
    for (const id of this.prevIds) {
      if (!next.has(id)) {
        const gone = this.prevById.get(id);
        if (gone) {
          this.leaveCbs.forEach((cb) => cb(gone));
        }
      }
    }
    // The Overlay positions bubbles from snapshot rects, so any tile field
    // change (rect, name, is_self, fit, video size, captions_rect) re-emits.
    const serialized = JSON.stringify(current);
    if (serialized !== this.prevSnapshot) {
      this.tileCbs.forEach((cb) => cb(current));
    }
    this.prevIds = ids;
    this.prevById = new Map(current.map((tile) => [tile.tile_id, tile]));
    this.prevSnapshot = serialized;
    // Reconcile speaking from the poll too (a node may arrive already lit),
    // but never while a hold is pending: the poll must not re-arm the hold.
    for (const id of ids) {
      if (this.holdTimers.has(id)) {
        continue;
      }
      const root = this.findTileRoot(id);
      if (root) {
        this.reportSpeaking(id, isSpeakingNow(root));
      }
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const timer of this.holdTimers.values()) {
      clearTimeout(timer);
    }
    this.holdTimers.clear();
    this.speakingState.clear();
    this.resizeTarget?.removeEventListener("resize", this.onResize);
    this.resizeTarget = null;
    this.tileCbs.clear();
    this.speakingCbs.clear();
    this.joinCbs.clear();
    this.leaveCbs.clear();
  }

  private onMutations(records: MutationRecord[]): void {
    let structureChanged = false;
    for (const record of records) {
      if (record.type === "attributes") {
        const tileEl = (record.target as Element).closest?.(TILE_SELECTOR) ?? null;
        const id = tileEl?.getAttribute(CONVENTIONS.tileAttr) ?? "";
        if (id.length > 0 && tileEl) {
          this.reportSpeaking(id, isSpeakingNow(tileEl));
        }
      } else {
        structureChanged = true;
      }
    }
    if (structureChanged) {
      this.rescan();
    }
  }

  /**
   * Change-only speaking reporter with a flicker hold: class on → true
   * immediately; class off → false after `speakingHoldMs`, cancelled if the
   * class returns inside the hold. Level-class churn never emits.
   */
  private reportSpeaking(id: string, observed: boolean): void {
    const last = this.speakingState.get(id) ?? false;
    const pending = this.holdTimers.get(id);
    if (observed) {
      if (pending !== undefined) {
        clearTimeout(pending);
        this.holdTimers.delete(id);
      }
      if (!last) {
        this.speakingState.set(id, true);
        this.emitSpeaking({ tile_id: id, speaking: true });
      }
      return;
    }
    if (!last || pending !== undefined) {
      return;
    }
    const timer = setTimeout(() => {
      this.holdTimers.delete(id);
      const root = this.findTileRoot(id);
      if (!root) {
        this.speakingState.delete(id); // tile left; leave already fired
        return;
      }
      if (!isSpeakingNow(root)) {
        this.speakingState.set(id, false);
        this.emitSpeaking({ tile_id: id, speaking: false });
      }
    }, CONVENTIONS.speakingHoldMs);
    this.holdTimers.set(id, timer);
  }

  private emitSpeaking(event: Omit<SpeakingEvent, "ts_ms">): void {
    const full: SpeakingEvent = { ...event, ts_ms: this.now() };
    this.speakingCbs.forEach((cb) => cb(full));
  }

  private findTileRoot(id: string): Element | null {
    for (const el of Array.from(this.scope.querySelectorAll(TILE_SELECTOR))) {
      if (el.getAttribute("role") === CONVENTIONS.excludedRole) {
        continue;
      }
      if ((el.getAttribute(CONVENTIONS.tileAttr) ?? "") === id) {
        return el;
      }
    }
    return null;
  }

  /**
   * One participant id can match several nodes (panel rows, fx decoys):
   * prefer the node holding a `<video>`, else the largest painted area.
   */
  private pickTileRoot(candidates: Element[]): Element | null {
    const withVideo = candidates.filter((el) => el.querySelector("video") !== null);
    const pool = withVideo.length > 0 ? withVideo : candidates;
    let best: Element | null = null;
    let bestArea = -1;
    for (const el of pool) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    return best;
  }

  private readTile(id: string, candidates: Element[]): Tile | null {
    const root = this.pickTileRoot(candidates);
    if (!root) {
      return null;
    }
    const video = root.querySelector("video");
    const rect = root.getBoundingClientRect();
    const captions = findCaptionsBand(this.scope);
    const captionsRect = captions ? rectOf(captions) : null;
    return {
      tile_id: id,
      name: readName(root),
      is_self: isSelfTile(root, video),
      rect: [rect.x, rect.y, rect.width, rect.height],
      video_w: video?.videoWidth ?? 0,
      video_h: video?.videoHeight ?? 0,
      fit: readFit(root, video),
      captions_rect: captionsRect,
    };
  }
}

function rectOf(el: Element): [number, number, number, number] {
  const rect = el.getBoundingClientRect();
  return [rect.x, rect.y, rect.width, rect.height];
}

/**
 * Captions band: the English-labelled region first, then any text-bearing
 * region (the aria-label is localized; the exact Arabic label is still open
 * and lands with the 2-person live test). Absent = null.
 */
function findCaptionsBand(scope: Document | Element): Element | null {
  const primary = scope.querySelector(CONVENTIONS.captionsSelector);
  if (primary) {
    return primary;
  }
  // Live 2026-10-31: with captions off, a top-bar region matched here and
  // floored every bubble into "+N". Captions sit in the bottom half only.
  const viewportH = scope.ownerDocument?.defaultView?.innerHeight
    ?? (scope as Document).defaultView?.innerHeight ?? 0;
  for (const region of Array.from(scope.querySelectorAll('[role="region"]'))) {
    if ((region.textContent?.trim() ?? "").length > 0
        && region.getBoundingClientRect().top >= viewportH / 2) {
      return region;
    }
  }
  return null;
}

/** Speaking predicate: the probe's jsname descendant carries the lit class. */
function isSpeakingNow(tileRoot: Element): boolean {
  const node = tileRoot.querySelector(`[jsname="${CONVENTIONS.speakingJsname}"]`);
  return node?.classList.contains(CONVENTIONS.speakingClass) ?? false;
}

/**
 * Display name: `span.notranslate` first; fallback to the first named span
 * outside buttons (buttons hold icon text like keep_outline).
 */
function readName(tileRoot: Element): string {
  // Live 2026-10-31: the self tile's "Backgrounds and effects" button also
  // holds a span.notranslate (icon text), so skip spans inside buttons here too.
  const direct = Array.from(tileRoot.querySelectorAll(CONVENTIONS.nameSelector))
    .find((span) => span.closest("button") === null);
  const directText = direct?.textContent?.trim() ?? "";
  if (directText.length > 0) {
    return directText;
  }
  for (const span of Array.from(tileRoot.querySelectorAll("span"))) {
    const text = span.textContent?.trim() ?? "";
    if (text.length === 0 || span.closest("button") !== null) {
      continue;
    }
    return text;
  }
  return "";
}

/**
 * Self tile: contains the "Backgrounds and effects" icon (only your tile
 * has it; the ligature is not localized). Mirrored-video check is fallback.
 */
function isSelfTile(tileRoot: Element, video: HTMLVideoElement | null): boolean {
  for (const icon of Array.from(tileRoot.querySelectorAll("i"))) {
    if ((icon.textContent?.trim() ?? "") === CONVENTIONS.selfIconText) {
      return true;
    }
  }
  const transform = video?.style.transform ?? "";
  return transform.includes("scaleX(-1)");
}

function readFit(tileRoot: Element, video: HTMLVideoElement | null): "cover" | "contain" {
  const candidates = [video?.style.objectFit ?? ""];
  const view = tileRoot.ownerDocument?.defaultView;
  if (video && view) {
    try {
      candidates.push(view.getComputedStyle(video).objectFit);
    } catch {
      // No computed style in this environment; inline style already checked.
    }
  }
  for (const value of candidates) {
    if (value === "cover" || value === "contain") {
      return value;
    }
  }
  return "cover";
}
