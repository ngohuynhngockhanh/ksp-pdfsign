import { defineConfig, devices } from "@playwright/test";

const previewPort = process.env.PLAYWRIGHT_PORT || "4173";
const fullstackUrl = process.env.FULLSTACK_BASE_URL || "";
const previewUrl = fullstackUrl || process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: previewUrl, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop-1280",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: "mobile-360",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: "mobile-390-ios",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
    },
    {
      name: "mobile-412-android",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 412, height: 915 },
      },
    },
    {
      name: "tablet-768",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  ...(fullstackUrl
    ? {}
    : {
        webServer: {
          command: `npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
          url: previewUrl,
          reuseExistingServer: false,
        },
      }),
});
