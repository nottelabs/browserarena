import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3030",
    viewport: { width: 1228, height: 950 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3030",
    url: "http://127.0.0.1:3030",
    reuseExistingServer: false,
  },
});
