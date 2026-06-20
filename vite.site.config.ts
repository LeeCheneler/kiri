import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Build for the marketing + docs site (kiri.build). A second Vite app in this
// repo, rooted at src/site, that reuses the main app's design system for brand
// alignment. Kept as its own config rather than a mode flag on vite.config.ts:
// the app build has shell-specific concerns (stable app.js/app.css names, the
// /api dev proxy) the site doesn't share, so two flat configs read clearer
// than one branching one.
export default defineConfig({
  root: "src/site",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
  },
});
