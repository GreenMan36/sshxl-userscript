import monkey from "vite-plugin-monkey";
import type { MonkeyOption, MonkeyUserScript } from "vite-plugin-monkey";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import metadata from "./userscript.meta.json" with { type: "json" };

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: false, // keep the .user.js readable; it is small anyway
  },
  plugins: [
    preact(),
    monkey({
      entry: "src/main.tsx",
      userscript: metadata as MonkeyUserScript,
      server: {
        // Auto-open the Violentmonkey install page when the dev server starts.
        open: true,
      },
    } satisfies MonkeyOption),
  ],
});
