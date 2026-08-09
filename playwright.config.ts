import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. This library uses the browser as its layout engine, so these
 * — not the unit tests — are the real safety net.
 *
 * Safari's `getClientRects` behaviour differs subtly from Chromium's, which is
 * why WebKit is a first-class project rather than an afterthought. Locally you
 * may only have Chromium installed; run `--project=chromium` in that case.
 */
/**
 * Escape hatch for environments that ship a preinstalled browser whose build
 * does not match this Playwright version (some CI images and dev containers).
 * Unset everywhere else, so the normal `playwright install` path is used.
 */
const chromiumExecutable = process.env["PW_CHROMIUM_EXECUTABLE"];

export default defineConfig({
  testDir: "tests/browser",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: {
    // Fixed viewport and device scale: visual regression comparisons are
    // meaningless if the rendering surface moves under them.
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutable
          ? { launchOptions: { executablePath: chromiumExecutable } }
          : {}),
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
