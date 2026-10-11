import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 45000,
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4179", headless: true },
  webServer: {
    command: "node server/index.js --production",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: false,
    env: { PORT: "4179" },
  },
});
