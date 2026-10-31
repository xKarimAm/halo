// One-time microphone grant page (setup_panel lane): offscreen documents
// cannot show a permission prompt, so this extension tab calls getUserMedia
// once. The grant lives on the extension origin, after which the offscreen
// hub can open the mic without prompting. Records the outcome in
// `halo.micState` for the popup to show.
declare const chrome: any;

export {}; // module scope: entrypoints share one compilation

const MIC_STATE_KEY = "halo.micState";

async function requestMic(): Promise<void> {
  const state = document.getElementById("mic-permission-state");
  const say = (text: string): void => {
    if (state) state.textContent = text;
  };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop()); // keep the grant, release the device
    await chrome.storage.local.set({ [MIC_STATE_KEY]: "granted" });
    say("Microphone ready. You can close this tab and return to the Meet call.");
  } catch {
    await chrome.storage.local.set({ [MIC_STATE_KEY]: "denied" });
    say("Microphone was blocked. Halo will run tab-audio only; allow the microphone in the browser site settings and try again.");
  }
}

document.getElementById("allow-mic")?.addEventListener("click", () => {
  void requestMic();
});
