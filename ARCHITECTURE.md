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
  - `services/` scans `~/.agents/skills` and each agent's skills directory, and classifies every symlink as `valid`, `broken`, `inaccessible` or `missing`. It also moves deleted skills to a trash with undo, writes the [activity log](docs/activity-log.md), and persists settings.
  - `ipc/` registers handlers with `typedHandle`. It validates each argument against a Zod schema in `ipc/ipc-schemas.ts`, then checks filesystem paths against the allowed skills locations before doing any work.
  - `updater.ts` checks GitHub releases through electron-updater. Downloads and installation require explicit renderer actions; startup and legacy settings changes keep automatic download and install-on-quit disabled.
- **Preload** (`apps/desktop/src/preload`) exposes a narrow, typed `window.electron` API through `contextBridge`. Windows run sandboxed with context isolation on and Node integration off.
- **Renderer** (`apps/desktop/src/renderer`) has two entries:
  - `index.html` is the main window.
  - `settings/index.html` is the Settings window, which includes the background gallery.

  Both are React apps. State lives in Redux Toolkit slices, and some of it is persisted.
  `@laststance/redux-storage-middleware` owns renderer persistence. Theme,
  bookmarks, protection and dashboard state use `skills-desktop-state`.
  Installed List/Tree mode, Markdown preview mode and the last-seen release version use the dedicated
  `skills-desktop-renderer-preferences` key. Its version 1 envelope is:

  ```json
  {
    "version": 1,
    "state": {
      "rendererPreferences": {
        "skillsViewMode": "list",
        "markdownPreviewMode": "code",
        "lastSeenVersion": null
      }
    }
  }
  ```

  `skillsViewMode` accepts `list` or `tree` and defaults to `list` in older envelopes.
  `markdownPreviewMode` accepts `code` or `reading`; `lastSeenVersion` accepts a
  nonempty string or `null`. The runtime `hydrated` flag is never persisted.
  Legacy keys are `skills-desktop:markdown-preview-mode` and
  `skills-desktop:last-seen-version`; retained values are migration seeds, not
  dual-written copies, so older versions may restore the pre-migration choices.

  | Canonical key                              | Legacy keys          | Startup result                                        |
  | ------------------------------------------ | -------------------- | ----------------------------------------------------- |
  | Valid version 1 envelope                   | Present or absent    | Canonical values win.                                 |
  | Valid envelope with invalid/missing fields | Present or absent    | Keep valid fields; default others to `code` / `null`. |
  | Invalid JSON, shape or version             | Present or absent    | Use defaults; preserve original canonical bytes.      |
  | Absent                                     | Valid values present | Import each valid legacy field; default the others.   |
  | Absent                                     | Absent or invalid    | Use defaults.                                         |

  Components dispatch Redux actions; they do not write storage. Preference saves
  run a read/merge/write transaction under a shared Chromium Web Lock. Explicitly
  edited fields merge with the latest canonical values; queued migration seeds
  yield to canonical values created by another window while the lock was pending.
  Each local edit records that field's durable baseline. A later remote change
  supersedes the pending edit under the lock even before its notification arrives;
  an intentional local edit made after that remote save remains eligible to persist.
  Deleting an existing canonical key cancels older pending writes; a new local
  action after that deletion can persist without reviving pre-deletion choices.
  Storage events synchronize the slice even when no preview is mounted. Changed
  remote fields supersede queued local edits to the same field; independent local
  edits survive, and adopted fields do not trigger an echo write. Stale or malformed
  notifications are ignored. Consumers wait for hydration before displaying the
  Markdown mode or checking release notes; pre-hydration local edits survive.
  If startup history could not be read, a silent release claim stays in memory
  instead of overwriting an unknown prior version. Later writes recover a current
  canonical or legacy baseline so a future update check retains that history.
  Rejected writes or unsupported/rejected Web Locks keep edits in memory and retry
  on later Redux activity, without falling back to unlocked writes. The save warning
  also covers reads rejected during a locked save; an unreadable key is never
  treated as a verified deletion, and queued edits remain retryable. The warning
  latches only once delivered. Rejected `setItem` calls log
  `[redux] persisting app state to localStorage failed`, the affected key and error;
  lock errors reach the middleware's `save` error handler and the same warning.
  For recovery, inspect that operation/key first and restore storage or lock access.
  Retain legacy keys for rollback and corrupt canonical bytes for diagnosis until
  a local preference action saves successfully, including an automatic release
  acknowledgement. Do not clear all localStorage or
  app data: that also erases unrelated preferences and cannot repair denied access.
  Main-owned settings and activity remain in their IPC-backed files.

- **Shared** (`apps/desktop/src/shared`) holds code for all three processes:
  - `ipc-contract.ts` is the channel-to-arguments/result map that keeps main, preload and renderer types in lockstep.
  - `constants.ts` holds `AGENT_DEFINITIONS`, which mirrors the pinned [skills CLI](https://github.com/vercel-labs/skills) agent list.
  - Domain types.

The build uses electron-vite, which writes `out/main`, `out/preload` and `out/renderer`, and electron-builder, which writes a signed, notarized DMG and ZIP to `apps/desktop/dist`. Main and preload explicitly disable `build.externalizeDeps` to preserve bundled CommonJS interop under electron-vite 6; Electron and Sharp remain explicit main-process externals. The main build uses `rolldownOptions` to retain the ESM `out/main/index.mjs` entry and `.mjs` chunks, while preload stays CommonJS. The workspace contract package remains a desktop **devDependency** and is bundled into `out/main`. `pnpm check:bundled-workspace` fails CI if a bundle still imports it by name.

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

Run the isolated migration, retry and cross-window regression suite from the root:

```bash
pnpm --filter skills-desktop test src/renderer/src/redux/rendererPreferencesPersistence.test.ts src/renderer/src/redux/reportingLocalStorage.test.ts
```

## Installed Tree and file discovery

The optional Tree uses `@pierre/trees` 1.0.0-beta.6 public model hooks with app-owned React rows and the existing `react-window` virtualizer. Skill rows are 44px and descendants 36px. Pierre owns hierarchy, expansion and focus; Redux owns inspected skill/file, temporary Inspector tab intent and bulk selection. A file activation never changes the persisted default Inspector tab.

`SkillFilesProvider` lives above both panels and the Tree-only error boundary. Its external store publishes immutable snapshots for React Compiler compatibility. Tree and `useCodePreview` share one listing request per root/generation; only the latter reads contents. Refresh and filesystem mutation starts invalidate the generation. The cache retains up to 64 roots, 20,000 files and 32 MiB, evicting collapsed, inactive roots first. Saturation is explicit and retryable after collapse.

`files:listDetailed`, `files:cancelList` and `files:readDetailed` are typed, schema-validated preload calls. Listing permits two active roots and 64 queued requests process-wide, with sequential IO inside each root (at most two outstanding listing operations). Discovery stops at 10,000 observed directory entries, 2,000 preview files, 4 MiB serialized data or depth four. Up to 100 relative omission markers accompany partial results. Ten-second timeouts settle the UI response; an uncancellable OS operation retains its slot until completion and handle cleanup. Cancellation is scoped to sender/frame, request ID and generation.

Main validates allowed roots, ignores nested symlinks, rechecks root identities and caps text/image reads at 512 KiB / 5 MiB while reading. These checks reduce replacement races; they are not an atomic OS filesystem sandbox. Presentation IDs encode actual relative path segments and map back to discovered files explicitly. They are never decoded into filesystem paths. See [ADR 0002](docs/adr/0002-installed-skill-tree.md).
