import type { MeetingAdapter } from "../../../contracts/ext/meeting-adapter";
import type { PortSpeakerActive, PortTilesSnapshot } from "../../../contracts/ext/port";

/** The hub end of the Port: the hub wraps the payload in an envelope. */
export interface HubPort {
  postMessage(message: PortTilesSnapshot | PortSpeakerActive): void;
}

type AdapterPortion = Pick<MeetingAdapter, "onTiles" | "onSpeaking">;

/**
 * The Port leg of the adapter's dual delivery: tile/speaker values also go
 * in-tab straight to the Overlay and Frame Source (wired by the content
 * script wrapper, owned by hub_capture). Returns an unsubscribe function.
 */
export function createPortSync(port: HubPort, adapter: AdapterPortion): () => void {
  const offTiles = adapter.onTiles((tiles) =>
    port.postMessage({ type: "tiles.snapshot", data: { tiles } }),
  );
  const offSpeaking = adapter.onSpeaking((event) =>
    port.postMessage({ type: "speaker.active", data: event }),
  );
  return () => {
    offTiles();
    offSpeaking();
  };
}
