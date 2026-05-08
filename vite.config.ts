import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    proxy: {
      // Trailing slash matters: "/api" prefix-matches "/api.ts" too and
      // would intercept client modules served by Vite.
      "/api/": "http://localhost:3000",
    },
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
  },
});
