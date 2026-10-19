import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "navigation.spec.ts",
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    command: "NITRO_PRESET=node-server npm run build && HOST=127.0.0.1 PORT=4173 node .output/server/index.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
