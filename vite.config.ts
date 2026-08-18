import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Trailing slash matters: "/api" prefix-matches "/api.ts" too and
      // would intercept client modules served by Vite.
      "/api/": "http://localhost:4242",
    },
    watch: {
      // Test files belong to bun:test, not the SPA. Without this, Vite
      // sees a test-file change, treats it as an out-of-graph module,
      // triggers a page reload + dep rescan, and esbuild blows up trying
      // to follow the test setup's transitive imports into Playwright.
      ignored: ["**/*.test.{ts,tsx}"],
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    // Every stylesheet in the app is folded into the single entry CSS, app.css,
    // which each shell loads itself. Without this, Vite's per-chunk CSS
    // tracking lists app.css as a preload dep of lazy chunks (mermaid, charts)
    // that share modules with the entry, and its preload helper only recognises
    // it as loaded by matching `link[href="/app.css"]` — which the hosted shell
    // at local.kiri.build fails, since it links the stylesheet by the local
    // instance's absolute URL. The helper then injects `/app.css` on the shell's
    // own origin, 404s, and the first diagram render fails with "Unable to
    // preload CSS". Emitting one un-split stylesheet leaves no CSS dep to preload.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        // Stable, root-served paths for the entry chunk and entry CSS so
        // the hosted shell at https://local.kiri.build can load them from
        // the local kiri instance without chasing content hashes. Other
        // chunks and assets stay hashed for cache-busting.
        entryFileNames: "app.js",
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".css")) ? "app.css" : "assets/[name]-[hash][extname]",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
});
