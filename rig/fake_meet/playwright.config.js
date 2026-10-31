import { defineConfig } from "@playwright/test";

// The joined runner picks a free port (HALO_MEET_PORT); 18778 otherwise.
const port = process.env.HALO_MEET_PORT || "18778";

export default defineConfig({
  testDir: "tests",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
  },
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${port}/index.html`,
    env: { PORT: port },
    reuseExistingServer: true,
    timeout: 15000,
  },
});
