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
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
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
