import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// index.html lives in ./root/ (GitHub Pages / hosting expects that layout).
// Source stays in ./src; see root/index.html script entry.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(repoRoot, "root"),
  publicDir: path.join(repoRoot, "public"),
  plugins: [react()],
  // Relative base works for GitHub Pages project sites and local file preview.
  base: "./",
  server: {
    fs: { allow: [repoRoot] },
  },
  build: {
    outDir: path.join(repoRoot, "dist"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
