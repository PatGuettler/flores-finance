/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute URL to a runtime manifest JSON (overrides `public/config/runtime.json`). */
  readonly VITE_RUNTIME_MANIFEST_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
