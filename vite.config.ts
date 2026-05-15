import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base works for GitHub Pages project sites and local file preview.
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
