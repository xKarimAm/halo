import type { MeetingContext } from "../../../contracts/ext/gen/types";

/** Bubble urgency-mark style (viewer setting, shared with the overlay lane). */
export type UrgencyStyle = "words" | "symbols";

/** Microphone grant state (viewer setting, shown in the popup). */
export type MicState = "granted" | "denied";

/** Storage key the offscreen hub writes when the mic opens or is denied. */
export const MIC_STATE_KEY = "halo.micState";
/** The opened mic's device name, written with the state (Karim 2026-11-01). */
export const MIC_LABEL_KEY = "halo.micLabel";

/** Storage key the overlay reads on boot and watches live. */
export const URGENCY_STYLE_KEY = "halo.urgencyStyle";

/** Everything the popup persists across opens. */
export interface SavedSetup {
  token?: string;
  context?: MeetingContext;
  urgencyStyle?: UrgencyStyle;
  micState?: MicState;
  micLabel?: string;
}

/** Token + context + viewer-preference persistence. Production use is `chrome.storage.local`. */
export interface SetupStorage {
  load(): Promise<SavedSetup>;
  saveToken(token: string): Promise<void>;
  saveContext(context: MeetingContext): Promise<void>;
  saveUrgencyStyle(style: UrgencyStyle): Promise<void>;
  saveMicState(state: MicState): Promise<void>;
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
      const items = await area.get([TOKEN_KEY, CONTEXT_KEY, URGENCY_STYLE_KEY, MIC_STATE_KEY]);
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
      const mic = items[MIC_STATE_KEY];
      if (mic === "granted" || mic === "denied") {
        saved.micState = mic;
      }
      if (typeof items[MIC_LABEL_KEY] === "string") saved.micLabel = items[MIC_LABEL_KEY] as string;
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
    async saveMicState(state: MicState): Promise<void> {
      await area.set({ [MIC_STATE_KEY]: state });
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
    async saveMicState(state: MicState): Promise<void> {
      saved = { ...saved, micState: state };
    },
  };
}
