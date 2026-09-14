/// <reference types="vite/client" />

interface Window {
  CESIUM_BASE_URL: string;
}

interface ImportMetaEnv {
  readonly VITE_CESIUM_ION_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
