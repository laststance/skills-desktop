/// <reference types="vite/client" />
/// <reference path="./types/electron.d.ts" />

/** App version injected at build time from package.json */
declare const __APP_VERSION__: string

/** True when the bundle was built with `E2E_BUILD=1`. Lets test-only branches (window.__store, window.__ipcEvents__) tree-shake out of normal builds. */
declare const __E2E_BUILD__: boolean
