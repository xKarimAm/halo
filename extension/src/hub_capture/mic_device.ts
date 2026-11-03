// Which mic Meet opened. Live 2026-11-01: Windows' default mic was a silent
// virtual device (SteelSeries Sonar) while Meet used the headset, so Halo's
// getUserMedia({ audio: true }) sent pure zeros. A MAIN-world script wraps
// Meet's getUserMedia and leaves the device id on <html data-halo-mic-device>,
// which the isolated content script reads at Start (same origin, same ids).

export const MIC_DEVICE_KEY = "haloMicDevice"; // dataset key of data-halo-mic-device

interface DevicesLike {
  getUserMedia(constraints?: unknown): Promise<MediaStream>;
}

export function rememberMeetMic(devices: DevicesLike, el: { dataset: Record<string, string | undefined> }): void {
  const original = devices.getUserMedia.bind(devices);
  devices.getUserMedia = async (constraints?: unknown) => {
    const stream = await original(constraints);
    const id = stream.getAudioTracks()[0]?.getSettings().deviceId;
    if (id) el.dataset[MIC_DEVICE_KEY] = id; // ponytail: last mic Meet opened wins; a mid-call switch is picked up at the next Start
    return stream;
  };
}
