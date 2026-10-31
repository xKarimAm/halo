import type { MeetingAdapter } from "../../../contracts/ext/meeting-adapter";
import type { PortCallLeft, PortSpeakerActive, PortTilesSnapshot } from "../../../contracts/ext/port";

/** The hub end of the Port: the hub wraps the payload in an envelope. */
export interface HubPort {
  postMessage(message: PortTilesSnapshot | PortSpeakerActive | PortCallLeft): void;
}

type AdapterPortion = Pick<MeetingAdapter, "tiles" | "onTiles" | "onSpeaking">;

/**
 * How long every tile must stay gone before it counts as "left the call".
 * ponytail: rides out a layout re-render; tune if a live call ever drops
 * all tiles for longer without the user leaving.
 */
export const CALL_LEFT_GRACE_MS = 5000;

/**
 * The Port leg of the adapter's dual delivery: tile/speaker values also go
 * in-tab straight to the Overlay and Frame Source (wired by the content
 * script wrapper, owned by hub_capture). Returns an unsubscribe function.
 *
 * Also posts `call.left` when the call UI goes away with the tab still open:
 * tiles were on screen in this page, then none for `leftGraceMs`. A reload
 * never posts it (the old script dies; the new one has seen no tiles yet).
 */
export function createPortSync(
  port: HubPort,
  adapter: AdapterPortion,
  leftGraceMs = CALL_LEFT_GRACE_MS,
): () => void {
  let seenTiles = adapter.tiles().length > 0;
  let leftTimer: ReturnType<typeof setTimeout> | undefined;
  const offTiles = adapter.onTiles((tiles) => {
    port.postMessage({ type: "tiles.snapshot", data: { tiles } });
    clearTimeout(leftTimer);
    leftTimer = undefined;
    if (tiles.length > 0) seenTiles = true;
    else if (seenTiles) {
      leftTimer = setTimeout(() => {
        seenTiles = false; // once per call; a rejoin re-arms it
        port.postMessage({ type: "call.left" });
      }, leftGraceMs);
    }
  });
  const offSpeaking = adapter.onSpeaking((event) =>
    port.postMessage({ type: "speaker.active", data: event }),
  );
  return () => {
    clearTimeout(leftTimer);
    offTiles();
    offSpeaking();
  };
}
