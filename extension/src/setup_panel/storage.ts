import type { MeetingContext } from "../../../contracts/ext/gen/types";

/** Bubble urgency-mark style (viewer setting, shared with the overlay lane). */
export type UrgencyStyle = "words" | "symbols";

/** Storage key the overlay reads on boot and watches live. */
export const URGENCY_STYLE_KEY = "halo.urgencyStyle";

/** Everything the popup persists across opens. */
export interface SavedSetup {
  token?: string;
  context?: MeetingContext;
  urgencyStyle?: UrgencyStyle;
}

/** Token + context + viewer-preference persistence. Production use is `chrome.storage.local`. */
export interface SetupStorage {
  load(): Promise<SavedSetup>;
  saveToken(token: string): Promise<void>;
  saveContext(context: MeetingContext): Promise<void>;
  saveUrgencyStyle(style: UrgencyStyle): Promise<void>;
}

const TOKEN_KEY = "halo.token";
const CONTEXT_KEY = "halo.context";

/** Minimal `chrome.storage.local` surface this module needs. */
export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Production storage backed by `chrome.storage.local`. */
export function chromeSetupStorage(area: StorageArea): SetupStorage {
  return {
    async load(): Promise<SavedSetup> {
      const items = await area.get([TOKEN_KEY, CONTEXT_KEY, URGENCY_STYLE_KEY]);
      const saved: SavedSetup = {};
      if (typeof items[TOKEN_KEY] === "string") {
        saved.token = items[TOKEN_KEY] as string;
      }
      if (typeof items[CONTEXT_KEY] === "object" && items[CONTEXT_KEY] !== null) {
        saved.context = items[CONTEXT_KEY] as MeetingContext;
      }
      const style = items[URGENCY_STYLE_KEY];
      if (style === "words" || style === "symbols") {
        saved.urgencyStyle = style;
      }
      return saved;
    },
    async saveToken(token: string): Promise<void> {
      await area.set({ [TOKEN_KEY]: token });
    },
    async saveContext(context: MeetingContext): Promise<void> {
      await area.set({ [CONTEXT_KEY]: context });
    },
    async saveUrgencyStyle(style: UrgencyStyle): Promise<void> {
      await area.set({ [URGENCY_STYLE_KEY]: style });
    },
  };
}

/** In-memory storage for tests. */
export function memorySetupStorage(seed: SavedSetup = {}): SetupStorage {
  let saved: SavedSetup = { ...seed };
  return {
    async load(): Promise<SavedSetup> {
      return { ...saved };
    },
    async saveToken(token: string): Promise<void> {
      saved = { ...saved, token };
    },
    async saveContext(context: MeetingContext): Promise<void> {
      saved = { ...saved, context };
    },
    async saveUrgencyStyle(style: UrgencyStyle): Promise<void> {
      saved = { ...saved, urgencyStyle: style };
    },
  };
}
