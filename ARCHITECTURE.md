# Architecture

Skills Desktop is a macOS Electron app that shows which skills each AI agent can see and whether each agent's symlinks resolve. A small Next.js website serves the download page and a proxy for the Unsplash background gallery. Both live in one pnpm workspace.

## Workspace map

```
apps/desktop               skills-desktop                     Electron app, Storybook, E2E suite
apps/website               skills-desktop-website             Next.js site + /api/rpc Unsplash proxy (Vercel)
packages/unsplash-contract @skills-desktop/unsplash-contract  oRPC contract, schemas and limits
```

The dependency direction is one-way: both apps import `@skills-desktop/unsplash-contract`, and the contract package imports neither app. Shared third-party versions come from the `catalog:` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml), with sherif checking them in CI.

## Desktop app

The app follows Electron's three-process model. The renderer never touches the filesystem.

```
Renderer (React, Redux Toolkit)  ──window.electron──▶  Preload (contextBridge)  ──ipcRenderer.invoke──▶  Main (Node.js)
   src/renderer                                        src/preload                                     src/main
        ▲                                                                                                  │
        └──────────────────────────────── typed events (typedSend) ◀───────────────────────────────────────┘
```

- **Main process** (`apps/desktop/src/main`):
  - `services/` scans `~/.agents/skills` and each agent's skills directory, and classifies every symlink as `valid`, `broken`, `inaccessible` or `missing`. It also moves deleted skills to a trash with undo, writes the activity log, and persists settings.
  - `ipc/` registers handlers with `typedHandle`. It validates each argument against a Zod schema in `ipc/ipc-schemas.ts`, then checks filesystem paths against the allowed skills locations before doing any work.
  - `updater.ts` checks GitHub releases through electron-updater.
- **Preload** (`apps/desktop/src/preload`) exposes a narrow, typed `window.electron` API through `contextBridge`. Windows run sandboxed with context isolation on and Node integration off.
- **Renderer** (`apps/desktop/src/renderer`) has two entries:
  - `index.html` is the main window.
  - `settings/index.html` is the Settings window, which includes the background gallery.

  Both are React apps. State lives in Redux Toolkit slices, and some of it is persisted.

- **Shared** (`apps/desktop/src/shared`) holds code for all three processes:
  - `ipc-contract.ts` is the channel-to-arguments/result map that keeps main, preload and renderer types in lockstep.
  - `constants.ts` holds `AGENT_DEFINITIONS`, which mirrors the pinned [skills CLI](https://github.com/vercel-labs/skills) agent list.
  - Domain types.

The build uses electron-vite, which writes `out/main`, `out/preload` and `out/renderer`, and electron-builder, which writes a signed, notarized DMG and ZIP to `apps/desktop/dist`. electron-vite externalizes runtime `dependencies`, so the workspace contract package is a desktop **devDependency** and gets bundled into `out/main`. `pnpm check:bundled-workspace` fails CI if a bundle still imports it by name.

## Background gallery flow

```
Settings renderer ──oRPC search──────────▶ https://skills-desktop.vercel.app/api/rpc ──▶ Unsplash API
Main process      ──oRPC trackDownload───▶ (same endpoint)
Main process      ──image bytes (fetch)──▶ Unsplash image CDN (validated, then stored locally)
```

- `apps/website/src/app/api/rpc/[...rest]/route.ts` serves the oRPC router from `apps/website/src/server/unsplash.ts`.
  - The route bounds request size and URL length.
  - It allows the packaged app's opaque `null` origin and loopback development origins.
  - Only the server reads the Unsplash access key.
- `packages/unsplash-contract` defines the procedures, the Zod input and output schemas, and every limit (page size, string lengths, allowed image origin). Both the client and the server validate against the same schemas, so a response the server can produce is always one the app accepts.
- The main process injects the renderer Content-Security-Policy. Its `connect-src` adds only `UNSPLASH_RPC_URL`'s origin, and its `img-src` adds only the Unsplash image origin. Applying a background downloads the image in the main process, checks its size and dimensions against the contract, and then stores it locally.
- Shipped app versions call the production endpoint. The contract is therefore a compatibility surface: changing a schema in a breaking way requires keeping the old shape working until those versions age out.

## Website

`apps/website` is a Next.js App Router site deployed to Vercel with Root Directory `apps/website`. The Vercel install is filtered to `skills-desktop-website...`, so Electron is never downloaded there. The download buttons in `src/components/{Hero,Download}.tsx` and `public/llms.txt` point at the current GitHub release. The release pipeline updates them.

## Quality gates

`pnpm validate` runs every fast gate for all three packages in a single flat `run-p`:

- sherif
- lint, unit and browser tests, and type checks for each package
- the website build
- Fallow dead-code, duplication and health checks over the whole workspace
- the Storybook build

`pnpm test:e2e` then drives the built Electron app with Playwright under an isolated `HOME`. CI runs the same gates as separate required checks, plus CodeQL, Dependency Review, a production dependency audit and Socket.
