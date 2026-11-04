// Meet's own page world, before Meet's scripts run: remember the mic Meet
// opens so Halo captures the same one (see hub_capture/mic_device.ts).
import { defineContentScript } from "wxt/sandbox";
import { rememberMeetMic } from "../hub_capture/mic_device";

export default defineContentScript({
  matches: ["https://meet.google.com/*", "https://*.zoom.us/*", "https://teams.microsoft.com/*", "https://teams.live.com/*", "https://teams.cloud.microsoft/*"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    rememberMeetMic(navigator.mediaDevices, document.documentElement);
  },
});
