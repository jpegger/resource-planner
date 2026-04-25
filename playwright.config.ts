import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/layer3-ui",
  use: {
    baseURL: process.env.TEST_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  webServer: undefined,
});

