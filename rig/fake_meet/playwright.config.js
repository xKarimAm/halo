import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 30000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18778",
    launchOptions: { args: ["--no-sandbox", "--disable-dev-shm-usage"] },
  },
  webServer: {
    command: "node server.js",
    url: "http://127.0.0.1:18778/index.html",
    reuseExistingServer: true,
    timeout: 15000,
  },
});
