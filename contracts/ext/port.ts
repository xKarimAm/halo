// Halo Port protocol (contracts-owned, TS only: no JSON Schema, no Port ACK).
//
// Meet-page modules and the Setup Panel talk to the hub (offscreen document,
// extension/src/hub_capture) over a chrome.runtime Port. Socket-bound payloads
// keep their envelope data types from ./gen/types; the hub wraps them in a
// CloudEvents envelope and owns socket ACK + resend. ACKs for backend
// envelopes ride this Port back from the Overlay to the hub (`ack` below).
// There is no ACK on the Port itself.

import type {
  Ack,
  Envelope,
  MeetingContext,
  SpeakerActive,
  TilesSnapshot,
} from "./gen/types";

export type ViewerLang = MeetingContext["viewer_lang"];

/** Overlay -> hub: re-send the hub's latest meeting.context with this language. */
export interface SetViewerLang {
  type: "set_viewer_lang";
  viewer_lang: ViewerLang;
}

/** Setup Panel -> hub: socket-bound, hub wraps it in an envelope. */
export interface PortMeetingContext {
  type: "meeting.context";
  data: MeetingContext;
}

/** Meet Adapter -> hub: socket-bound copy (the in-tab copy goes direct). */
export interface PortTilesSnapshot {
  type: "tiles.snapshot";
  data: TilesSnapshot;
}

/** Meet Adapter -> hub: socket-bound copy (the in-tab copy goes direct). */
export interface PortSpeakerActive {
  type: "speaker.active";
  data: SpeakerActive;
}

/** Meet Adapter -> hub: a participant joined (not a meeting lifecycle event). */
export interface PortParticipantJoined {
  type: "participant.joined";
  tile_id: string;
}

/** Meet Adapter -> hub: a participant left (not a meeting lifecycle event). */
export interface PortParticipantLeft {
  type: "participant.left";
  tile_id: string;
}

/**
 * Meet Adapter -> hub: the user left the call while the tab stays open
 * (every tile gone). The hub sends meeting.ended with reason "left".
 */
export interface PortCallLeft {
  type: "call.left";
}

/** Overlay -> hub: ACK for a backend envelope, forwarded on the socket path. */
export interface PortAck {
  type: "ack";
  ack: Ack;
}

/** Hub -> Meet page: a backend envelope fanned out to the Overlay. */
export interface PortBackendEnvelope {
  type: "backend.envelope";
  envelope: Envelope;
}

/** Hub -> Overlay: extension-local outbox backlog for the status chip. */
export interface PortHubStatus {
  type: "hub.status";
  outbox_backlog: number;
}

/** Messages a Meet-page module or the Setup Panel sends to the hub. */
export type ToHubPortMessage =
  | PortMeetingContext
  | SetViewerLang
  | PortTilesSnapshot
  | PortSpeakerActive
  | PortParticipantJoined
  | PortParticipantLeft
  | PortCallLeft
  | PortAck;

/** Messages the hub sends to Meet-page modules. */
export type ToPagePortMessage = PortBackendEnvelope | PortHubStatus;

/** Every message that may travel on the Port, in either direction. */
export type PortMessage = ToHubPortMessage | ToPagePortMessage;
