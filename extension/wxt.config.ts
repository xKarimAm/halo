import { defineConfig } from "wxt";

// Extension composition root (hub_capture owns this file, the manifest and
// the entrypoint wrappers). The manifest key is pinned so the extension id
// checked by the Gateway never changes.
export default defineConfig({
  srcDir: "src",
  manifest: {
    name: "Halo",
    description: "Bilingual Arabic/English Google Meet copilot",
    // Pinned public key (generated once for Halo; the id is derived from it).
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq3WPCA1BapMQiOFT2AcM0mV7PwSRfYSy36OLjTepUWYjcxVxK9lh7nTR94cTq5PPuKDscXD7B6F++30KcuwGZ3RjYY5ysi9NbIJE5WvUiEclsNpwgB6mBB+bwTdRifI6rYrb/0jT5IzDP2da35vlyy+78oDrBJ0eUAipyxu13sPHCvzKnCNaa4iV41jhk5yhOygSSSbQ4V00Wr5H1lUuLn6mNvD1NS3NmXLonvC7VJcO09PDLb+U/Nl4JGKGjx14BZwZNXxmcYOsClDqKIjW7bo/zw1VaXdouEPRjhDQX4nwSVnb5/8bxYBeEZ1nnyOZ8deFRZ79GPU4DMvboydYFQIDAQAB",
    // activeTab: the popup reads the active tab's URL to refuse Start
    // outside a Meet call (granted by the popup click itself, no warning).
    permissions: ["tabCapture", "offscreen", "storage", "alarms", "activeTab"],
    host_permissions: ["http://127.0.0.1:8765/*", "ws://127.0.0.1:8765/*", "https://meet.google.com/*"],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
