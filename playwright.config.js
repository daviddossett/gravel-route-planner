// @ts-check
const { defineConfig } = require("@playwright/test");

const PORT = 4190;

module.exports = defineConfig({
  testDir: "tests",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop-light", use: { viewport: { width: 1440, height: 800 }, colorScheme: "light" } },
    {
      name: "mobile-dark",
      use: { viewport: { width: 390, height: 844 }, colorScheme: "dark", isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    },
  ],
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/variants/atlas/index.html`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "ignore",
  },
});
