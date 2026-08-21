import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDom: {
        settings: {
          // Hermetic: never fetch/execute the site's own resources in tests.
          disableJavaScriptEvaluation: true,
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
        },
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
