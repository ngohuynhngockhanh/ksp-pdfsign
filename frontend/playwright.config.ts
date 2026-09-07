import { defineConfig, devices } from "@playwright/test";

const previewPort = process.env.PLAYWRIGHT_PORT || "4173";
const previewUrl = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: previewUrl, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
  },
});
