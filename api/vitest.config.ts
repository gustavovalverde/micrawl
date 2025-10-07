import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
    environment: "node",
    deps: {
      inline: ["@micrawl/core", "playwright-core", "@sparticuz/chromium"],
    },
  },
});
