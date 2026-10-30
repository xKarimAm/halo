// Meet content-script wrapper (owned by hub_capture): boots the in-tab
// modules, each tolerating lanes that have not merged yet.
import { defineContentScript } from "wxt/sandbox";

declare const chrome: any;

export async function bootMeetPage(): Promise<void> {
  const port = chrome.runtime.connect({ name: "halo-hub" });
  const context = { port };
  for (const name of ["meet_adapter", "frame_source", "overlay"] as const) {
    try {
      const mod = await import(/* @vite-ignore */ `../${name}/index.ts`);
      (mod as { boot?: (ctx: unknown) => void }).boot?.(context);
    } catch {
      // Lane not merged yet: the hub Port alone is live.
    }
  }
}

export default defineContentScript({
  matches: ["https://meet.google.com/*"],
  main() {
    void bootMeetPage();
  },
});
