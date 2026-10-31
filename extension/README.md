# Halo extension

## Extension id (pinned)

`dbngpodihegmipdmikpbkflahdkfpgif`

The manifest `key` is pinned in `wxt.config.ts` (hub_capture lane), so this
id never changes. The Gateway expects WebSocket `Origin:
chrome-extension://dbngpodihegmipdmikpbkflahdkfpgif` (see `HALO_EXTENSION_ID`
in the backend `.env.example`).

Derived as the first 128 bits of the SHA-256 of the manifest public key,
hex `0-9a-f` mapped onto `a-p`. No private key material lives in this repo.
