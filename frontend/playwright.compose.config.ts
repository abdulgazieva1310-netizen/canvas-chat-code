import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../e2e",
  testMatch: "interview-mirror.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.COMPOSE_APP_URL ?? "http://localhost:8100",
    headless: true,
    trace: "retain-on-failure",
  },
});
