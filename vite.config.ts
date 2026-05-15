import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/** GitHub project Pages lives at /{repo}/ — set VITE_BASE=/my-repo/ in CI so assets load without a trailing slash on the URL. */
function viteBase(): string {
  const raw = process.env.VITE_BASE?.trim();
  if (!raw || raw === "." || raw === "./") return "./";
  let b = raw.startsWith("/") ? raw : `/${raw}`;
  if (!b.endsWith("/")) b = `${b}/`;
  return b;
}

export default defineConfig({
  root: repoRoot,
  publicDir: path.join(repoRoot, "public"),
  plugins: [react()],
  base: viteBase(),
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
