# Background gallery — implementation plan

Reviewed: 2026-09-08 JST. Branch: `codex/background-image-trials`. Code baseline: `23f68f2`.
Status: engineering review, design review and focused engineering follow-up completed. Feature implementation, quality gates, packaging and native QA have not run.

## Product contract

- Keep the complete gallery: four bundled Unsplash photos, live Unsplash search with infinite scrolling, local uploads and cropping for every source.
- Settings → Appearance: current background, Choose background, Crop, Clear, Fill / Fit / Tile and nearby opacity controls. Choose background opens the approved A dialog with Built-in / Unsplash / Your images tabs and a bounded 2–3-column gallery.
- Keep Fill / Fit / Tile, default Fill. Crop aspects: Original / 16:9 / 16:10; default full image. Drag, zoom, keyboard, Reset and Cancel supported.
- Source and accepted crop: long edge ≥1920 px AND short edge ≥1080 px, after orientation. No upscaling to pass validation. Uploads: static JPEG / PNG / WebP, ≤20 MiB and ≤80,000,000 pixels.
- Start with no background. Preserve existing opacity range 0–100%, default/reset 100%. On the first successful image application only, change the active mode to 60% if all its current values are 100%; preserve hidden-mode values. Commit this flag, opacity and selection together.
- Changing or clearing an image later preserves opacity. Clear preserves the upload library and layout. Cancel before Apply preserves the current selection.
- Apply accepted by Main continues after Settings closes. A newer accepted selection, explicit Clear or removal of that pending source supersedes it; unrelated removal does not. Closing a window differs from quitting the application: unfinished work is not resumed automatically after process exit.
- Retain app-owned upload originals for recropping; moving the user's original must not break the background. Removal affects app-owned files only. Active-image removal clears the selection in the same transaction.

## Approved engineering changes

| Finding        | Evidence                                                                                                                                                                           | Decision                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A1 · P1 · 9/10 | `src/main/services/settingsWindow.ts:65` destroys Settings; `src/preload/index.ts:159` assigns request IDs only at settings IPC dispatch                                           | Main owns accepted Apply, notification, preparation, latest-intent checks and final result; window closure does not cancel it. |
| A2 · P1 · 9/10 | `src/main/services/fileReader.ts:217` checks a 5 MiB limit and extension-based MIME; At review time Sharp was a dev dependency; see the current `package.json` dependency sections | Promote installed Sharp to a production dependency for background ingestion. Keep the skill-image reader's existing boundary.  |
| Q1 · P1 · 9/10 | `src/main/services/settings.ts:248` shallow-merges snapshots; `:204` compares other fields by reference/value                                                                      | Main applies add/remove/apply intents to the latest queued snapshot. Extend structural equality for nested background values.  |
| P1 · P2 · 8/10 | TanStack Query refetches cached infinite-query pages when stale; disabling focus refetch does not disable mount/reconnect refetch                                                  | Fetch on search, pagination or explicit Refresh. Preserve loaded pages on remount/reconnect; Refresh starts at page one.       |

These are gaps in the proposed integration, not claims that the unimplemented gallery already has runtime bugs.
Scope choice retained full coverage; the other choices differ in implementation or behavior, not feature coverage.

## Sources and bundled photos

Download the four free photos manually under the Unsplash License, separately from API integration. Package a WebP with long edge 3840 px, a small thumbnail and attribution metadata for each; never upscale. Store in `resources/backgrounds/`, covered by the existing resource packaging rule.

| Photo                                                                                                            | Photographer     | Original dimensions |
| ---------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------- |
| [Alpine lake](https://unsplash.com/photos/lake-forest-and-mountains-during-day-5oRIcisKaxU)                      | Mike Petrucci    | 4608×3072           |
| [Misty forest](https://unsplash.com/photos/misty-pine-forest-with-dense-undergrowth-c7f6RvusKDA)                 | T / @tanyabarrow | 6000×4000           |
| [Pacific coast](https://unsplash.com/photos/coastal-landscape-with-ocean-and-rocky-cliffs-5XWwlkEnscA)           | Kellen Riggin    | 7728×5152           |
| [Quiet dunes](https://unsplash.com/photos/desert-landscape-with-rolling-sand-dunes-under-a-pale-sky-v--MQrXgC90) | Marc Wieland     | 3990×2244           |

Online Unsplash images remain hotlinked, including the active background. Preserve `ixid`; show linked photographer and Unsplash credits with the required referral parameters in the gallery and main window. Notify the provider when a new Unsplash image is applied, not for browsing, crop movements or restoring a saved selection. Keep notification and image-response caches separate. Sources: [API guidelines](https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines), [hotlinking](https://help.unsplash.com/en/articles/2511271-guideline-hotlinking-images), [documentation](https://unsplash.com/documentation), [license](https://unsplash.com/license).

## Contracts and boundaries

- Use stable oRPC 1.15.0 packages together, `@orpc/tanstack-query` and TanStack Query v5. Keep Redux for existing local settings and TanStack Query for remote gallery data.
- One server-free Zod/oRPC contract at `website/src/lib/unsplash-contract.ts`; Website and Electron import it. Keep it under the existing Website build root; no server implementation, environment access or credentials in this module. Both lockfiles resolve compatible contract dependencies.
- Two procedures: `unsplash.search({ query, page }) → { items, nextPage }` and `unsplash.trackDownload({ photoId, downloadLocation })`. Bound query/page inputs, validate upstream responses, and expose typed recoverable errors.
- The existing Website becomes the shared Laststance proxy: remove static-export mode; add a Node Route Handler at `/api/rpc/[...rest]`. Preserve the landing page. Keep API keys only in server environment configuration.
- Settings uses oRPC `infiniteOptions` with `useInfiniteQuery`. Main uses the same oRPC client contract for download notifications. Existing typed preload IPC remains the boundary for local settings and files.
- Validate download host, exact photo-download path, photo ID and allowed parameters; forbid redirects and arbitrary proxy URLs. Never forward credentials to another host. Allow only the required Unsplash image host and API origin in CSP.
- Explicitly handle development origins and packaged Electron's origin in CORS; CORS is not authentication. Configure per-IP rate enforcement at the hosting boundary, not a process-local counter that resets per serverless instance. Cache successful searches server-side for 60 seconds; never cache download notifications.
- Before claiming online completion: register the app, configure Laststance's Vercel project, verify rate enforcement and production quota/approval, deploy the API and run a real request/credit/notification smoke test. Credentials are entered through provider configuration, never chat.

## Main-owned image and save flow

```text
Native picker → bounded app-owned staging copy → format/header checks
  → Sharp metadata + orientation/pixel limits → decode + bounded previews
  → validated draft ID → crop editor
                               ↓ Apply accepted by Main
Built-in ID / upload ID / Unsplash metadata → validate crop → prepare image
  → Unsplash notification if required
  → existing settings queue: read latest → reject stale intent
      → apply library/selection + first-use opacity → validate → atomic write → cache
  → existing settings broadcast + operation result → main window / reopened Settings

Failure/cancel/stale → retain committed selection and library
  → discard only this operation's uncommitted files → visible error or superseded status
```

- Add background settings with a discriminated selected-source reference, normalized crop percentages, layout, owned-upload metadata and monotonic first-application flag. Persist no arbitrary user paths or base64 image payloads in settings.
- Missing legacy fields default to no image; preserve unrelated preferences. Strictly validate mutations. An unreadable/corrupt settings file is not evidence that existing image files are unreferenced or safe to delete.
- Extend the existing save service with an internal queued updater; callbacks never cross IPC. Read/merge/validate/write/rename/cache stay one serialized transaction. Keep image processing and HTTP requests outside it.
- Reuse current settings broadcasts, store synchronization and Toaster. Background operations return an acceptance ID and a result; keep the current operation/result in Main so a reopened window can query it. Subscribe before fetching the snapshot and ignore older operation IDs.
- E1: distinguish a transient validated upload draft token from a saved upload ID in the Apply IPC input. Neither grants arbitrary file-path access. Main transfers the draft's owned input into the accepted operation synchronously before the first await and before replying. A delayed acceptance reply or Settings-close cleanup cannot delete accepted inputs. New drafts validate against this operation-owned input; saved uploads validate against the latest library. Persist only the final stable upload ID.
- E2: only Apply owns a long-running acceptance/result record. Clear and Remove use the existing queued mutations. A new Apply, explicit Clear, or removal of the pending source supersedes it; an unrelated removal does not, even when that removal also clears the committed image. Recheck source membership in the queue; stale failures stay quiet. Clear is available while an Apply is pending even if no image has committed yet.
- The final queued intent/source check is the commit boundary: reject superseded work before it; after it passes, finish that atomic transaction and order later intents after it. Do not promise cancellation halfway through file replacement. A Clear before this check preserves the unused first-application flag; one after a successful commit preserves that committed flag/opacity and clears only the selection. Test both orderings.
- Check current intent immediately before remote side effects and again inside the save transaction. Once committed, a later intent may replace it normally. Settings-close continuation requires no durable job framework.
- Validate byte count before decoding; verify magic/actual format, oriented dimensions, pixel count and full decode. Reject animated WebP and APNG explicitly; Sharp's page metadata alone is not an APNG detector. Apply the same crop-boundary validation in Main; never trust renderer coordinates.
- Reuse Sharp's asynchronous processing with one active background processing job; discard superseded queued selections before expensive work. Produce bounded previews for IPC instead of sending an 80 MP original to React. No custom worker pool.
- Keep the verified owned original, editor preview and selected display descriptor distinct. Map percentage crops to the oriented source, not thumbnail dimensions. Verify the prepared display image has enough real pixels for the accepted crop.
- Publish prepared files before committing their settings reference. A failed save retains the old reference; a successful remove commits references before unlinking owned files. Cleanup targets only validated app-owned IDs and known staging files; settings-load failure never triggers library-wide cleanup.
- Bound HTTP duration/response size and preserve the current image on preparation or notification failure. A timeout cannot prove whether Unsplash received a notification: report the uncertainty, do not promise exactly-once delivery or silently auto-retry. Within a live operation, remember acknowledged notification success so a disk-save retry does not notify again.

Sharp behavior: [metadata](https://sharp.pixelplumbing.com/api-input/), [input limits](https://sharp.pixelplumbing.com/api-constructor/). Verify native modules in both packaged architectures; development success alone is insufficient.

## Renderer and gallery flow

- Use one background layer behind all three panes. Foreground/native opacity remains 1; existing background-alpha tokens and text correction remain authoritative.
- Settings, menus, dialogs, notifications, syntax-colored code and external webviews retain opaque surfaces. Background changes never move/remount the preview webview.
- Render the accepted crop in Fill, Fit and Tile using native clipping/scaling/pattern primitives. Fit must not reveal pixels outside the crop in its letterbox area; Tile repeats the cropped region. Unsplash rendering continues to reference the direct CDN URL. Request sufficient source resolution for the crop, not just its preview.
- Reuse the approved A gallery and crop layouts, existing controls and `react-window`; use `react-easy-crop` for editing. Persist percentages for restoration, display real crop dimensions, disable invalid Apply and avoid scale animations on the crop container.
- Search debounce 300 ms, 30 items/page, initial nature/landscape query. Key cached data by normalized query; consume abort signals, deduplicate photo IDs and fetch the next page only when there is a next page and no fetch is active.
- Stale time 5 minutes; explicitly disable focus, mount and reconnect refetch. Disable retry-on-remount for errors; never automatically retry quota errors or download notifications. Explicit Refresh cancels the old request and resets to the first page.
- Retain loaded metadata and scroll position during the current browsing session. Virtualize image rows; release image/blob resources when no longer used. Let inactive query caches expire; do not add a second cache or drop active pages merely to cap the list.
- Provide loading, empty, end, error, quota and offline states. Keep existing results on a failed next-page request. Show a keyboard-accessible Load more/Retry control alongside infinite scrolling; preserve focus through virtualization, tabs and dialog dismissal.
- Bundled/uploaded images work offline. For an unavailable online image, show the theme fallback while retaining the selected source and offering retry; do not silently replace it.

References: [oRPC v1 TanStack integration](https://v1.orpc.dev/docs/integrations/tanstack-query), [Next adapter](https://v1.orpc.dev/docs/adapters/next), [TanStack infinite queries](https://tanstack.com/query/v5/docs/framework/react/guides/infinite-queries), [react-easy-crop](https://github.com/ValentinH/react-easy-crop).

## Approved design direction

Gallery A and Crop A selected on their comparison boards (5/5 each), then jointly confirmed. Preserve the existing Settings navigation and DESIGN.md; generated photo credits, dimensions and extra controls are illustrative, not production data. The gallery A machine check flagged layout deviations; its duplicate opacity control is explicitly excluded by the user's confirmed choice.

```text
Settings → Appearance
  Current background + Crop / Clear
  Choose background
  Fill / Fit / Tile → existing Entire / Section opacity
          ↓
Choose background [opaque dialog]
  Built-in | Unsplash | Your images                  Upload
  Search + Refresh [Unsplash only]
  Photo gallery [one bounded scroll region]
  Preview: selected title + Crop        Cancel | Apply background
          ↓ Crop
Crop background [opaque editor]
  Image + crop guides
  Original | 16:9 | 16:10     Zoom     Selected area
  Reset crop                           Cancel | Apply background
```

Three priorities: find an image, inspect the draft, apply it. Tile activation selects a draft only; it never changes the main background or sends a provider notification. Distinguish keyboard focus, draft selection (border + check + accessible name) and the current image (`Applied` label). Keep image credits on opaque caption surfaces, outside the image-selection button.

Before Apply is dispatched, Cancel/Escape discards that view's changes and restores its opener. During the acceptance handshake, show `Starting…` and Close; after acceptance, show `Applying background…` and Close. Explain once, `You can close Settings. Applying will continue.` Main's ownership state decides cleanup even if its reply has not reached the renderer. Guard duplicate Apply, keep the committed image visible, and replay the latest outcome on reopening. Failure keeps the draft for Retry and the previous background; superseded operations never display stale failure toasts.

E1 confirmed in the engineering follow-up: upload import remains staged until Apply commits the library and selection together. Cancelling a new import removes only its draft files and restores the image/crop selected before that upload (or no draft if none existed). Cancelling an existing image's crop restores its previous crop. Main releases unaccepted drafts on Settings closure; accepted work retains its inputs. Returning from Crop preserves query/scroll plus the appropriate restored draft, never the discarded token; `Apply background` uses the same single application path.

### Visible states and recovery

| Feature              | Loading                                      | Empty                                    | Error                                                                                | Success                                                  | Partial                                                                     |
| -------------------- | -------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Online gallery       | Labelled thumbnail skeletons.                | `No photos found` + change search.       | Retry / Refresh; quota reset time when known.                                        | Photos + linked credits.                                 | Keep loaded photos; footer Retry for next-page failure; explicit end label. |
| Your images / Upload | `Checking image…`; current background stays. | `No uploaded images yet` + Upload image. | Explain format, size, resolution or decode failure; choose another.                  | Valid draft opens Crop.                                  | Missing thumbnail gets a labelled fallback; no automatic library deletion.  |
| Crop                 | Bounded preview + loading status.            | No source: return to selection.          | Actual dimensions + minimum requirement; Apply disabled.                             | Preview + real selected pixel dimensions.                | Invalid draft stays editable; Reset restores Original/full image.           |
| Apply                | `Applying background…` + Close.              | No valid draft: Apply disabled.          | Draft and current background retained + Retry; uncertain provider timeout explained. | `Background applied`; update Applied marker.             | Close/reopen shows latest operation result; newer intent wins.              |
| Active online image  | Theme fallback while fetching.               | No image: existing theme.                | `Background unavailable` + Retry in Appearance; retain reference.                    | Chosen image behind panes.                               | At active-mode 100%: `Hidden at 100% opacity` + Adjust opacity.             |
| Remove upload        | Pending action; prevent duplicate removal.   | No selection: action unavailable.        | Keep library/background + visible error.                                             | Remove owned copy; active background cleared atomically. | A removed draft becomes unavailable, never resurrected by delayed Apply.    |

Use existing status/skeleton/Toaster patterns. Status announcements are polite and occur at stage changes, not every crop frame. No fake percent progress. The first application toast mentions 60% only when that transaction actually changed opacity. `Adjust opacity` focuses the active-mode slider; show the hidden hint only when every active-mode value is 100%. For mixed Section values, retain the visible panes normally.

Remove is a separate, labelled action outside the selection button. Reuse the existing confirmation dialog: identify the app-owned copy, state that the external original is untouched, and disclose clearing the current background when relevant. Clear remains distinct: remove the selection, retain the library and layout. After an external removal, reject Apply only if its source was removed; use the latest library snapshot.

### Journey and input contract

| Step            | User experience                                        | Support                                                                 |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| First 5 seconds | Understand current background and entry point.         | Current preview + one Choose background action; no empty hero.          |
| Browse          | Explore without changing the workspace.                | Draft vs Applied; stable tabs, search, results and scroll.              |
| Crop            | Know what will be kept and whether it is large enough. | Fixed ratio frame; move/zoom image; real source-pixel dimensions.       |
| Apply           | Know whether the change completed.                     | Applying/Close, retained previous image, recoverable Retry.             |
| Later use       | Re-edit safely, including offline local images.        | Owned originals, preserved crop/layout/opacity, explicit removal scope. |

Use a fixed crop frame with guides; remove the mockup's resize handles. Original uses the oriented source ratio; 16:9 and 16:10 constrain it. Drag/arrow keys move the image; the labelled zoom range and +/- buttons resize it. Reset restores the full source, Original and initial zoom. Never infer an unrestricted rectangle editor from the mockup. Reuse `react-easy-crop` keyboard support; no custom crop engine. Source: [cropper props and keyboard behavior](https://github.com/ValentinH/react-easy-crop#props).

### Window size, focus and tokens

- Preserve Settings 800×600 default / 600×400 minimum. Gallery max 720×520; crop max 720×540; both clamp to the available window with 16px outer margins. Keep header/footer fixed and the central area scrollable. No nested gallery/page scroll while the modal is open.
- Gallery uses three columns when its content is at least 520px wide, otherwise two. Thumbnails reserve their aspect ratio; long names/credits truncate with accessible full text. At reduced height or increased zoom, central content may scroll; actions remain reachable without horizontal scrolling.
- Reuse the existing Dialog, Tabs, Button, SegmentedControl, ranges and Toaster. Override the crop dialog's inherited scale/slide animation and footer's mobile stacking locally; do not change every dialog. Keep controls outside the native drag region. Use fade only (150–200ms); reduced motion removes it.
- Source tabs use existing tab keyboard behavior. Use one radio-group selection stop with arrow navigation through photos, independent visible focus, and explicit draft/Applied labels. Render a keyboard destination before focusing it. Cancel pending focus when query, source tab, dialog view or focus owner changes; verify the photo still exists before scrolling and focusing it. If manual scrolling removes a focused row, move focus to the stable gallery container; the next arrow continues among visible rows. Do not inflate the rendered range merely to pin a distant row. Credits and selected-image actions remain separate links/buttons, not nested interactive elements. Provide Load more / Retry for keyboard users.
- Crop has a named, focusable editing surface with instructions; arrows move only while that surface is focused. Zoom has a visible label/value. Invalid Apply is associated with its reason. Escape returns to the opener before acceptance, and behaves as Close after acceptance. Crop-to-gallery restores the source tile; if removed, focus the gallery heading. Dialog dismissal restores Choose background or the originating Crop button.
- Follow DESIGN.md: Inter 12–14px body, 11–12px metadata, 16–20px dialog title, 32px text buttons, 28px icon buttons, ≥24px targets, 4px spacing grid, 6–8px control/tile radii. Use theme tokens and opaque captions; no decorative gradients, extra navigation, heavy card shadows or opacity on text. Verify light/dark themes, visible focus and 4.5:1 text contrast on opaque controls.

## Approved Mockups

| Screen  | Mockup path                                                        | Direction                                                | Constraints                                                                                                 |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Gallery | [Gallery A](docs/design/background-gallery/gallery-A-reviewed.png) | Dedicated gallery dialog; fixed selection/action footer. | Opacity and layout stay in Appearance; preserve existing navigation and verified photo credits.             |
| Crop    | [Crop A](docs/design/background-gallery/crop-A-reviewed.png)       | Image above aspect, zoom, quality and reset controls.    | Use existing desktop tokens; crop behavior must match the chosen cropper, not decorative generated handles. |

## What already exists

| Existing foundation                                               | Reuse                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Shared settings schemas, typed IPC/preload and branded file types | Extend contracts; validate raw inputs at the boundary.                        |
| Serialized settings service and atomic replacement                | Add internal latest-snapshot updates; no second settings store or save queue. |
| Settings synchronization, guarded recovery and shared Toaster     | Reuse for authoritative snapshots and visible operation failures.             |
| Appearance controls, debounce, dialogs and tabs                   | Extend the current UI; preserve slider final-value persistence.               |
| Opacity CSS, opaque boundaries and theme matrix                   | Add the background layer without per-text fixes.                              |
| Sharp, react-window and resource packaging                        | Promote Sharp for runtime use; reuse virtualization and packaging.            |
| Vitest Node/Chromium and isolated Electron E2E                    | Extend existing lanes; add Website and bridge checks to the fast gate.        |

## Test coverage and failure handling

Existing tests are available for settings write/rename failures, concurrent primitive updates, visible recovery toasts, opacity mode/reset, actual CSS colors and Electron window lifecycle. They were inspected, not rerun. Gallery paths are new and currently untested. The groups below are implementation requirements, not a claimed coverage percentage.

```text
CODE PATH / BRANCH                                   USER FLOW / REQUIRED TEST
settings.ts load/save [existing tests]
  ├ missing/new/malformed background → G1            boot / upgrade / restart
  ├ queued add/remove/first-use/no-op → G1 [GAP]       rapid edits [→E2E]
  └ write/rename/recovery failure → G1 [extend]        visible failure, later retry

backgroundImages.ts [new: GAP]
  ├ picker cancel / copy failure → G3                 upload / cancel
  ├ bytes / format / animation / dimensions → G3     clear rejection, current retained
  └ decode / preview / publish / cleanup → G3,G7      original moved / packaged app

backgrounds.ts + IPC [new: GAP]
  ├ source kind / crop validity → G2,G4              apply each source [→E2E]
  ├ newer intent / closed window / quit → G2         close / reopen / retry [→E2E]
  ├ notification success/failure/uncertainty → G6    Unsplash apply [→E2E]
  └ commit/remove/result replay → G1,G2              both windows / restart [→E2E]

gallery query + proxy [new: GAP]
  ├ new query / pagination / duplicate / end → G5    search / long scroll / back
  ├ abort / quota / offline / refresh → G5,G6        recover without losing results
  └ validation / CORS / credentials / limits → G6   packaged and development clients

crop + background rendering [new: GAP]
  ├ orientation / percent↔pixels / minimum → G4     edit / reset / cancel / restore
  ├ Fill / Fit / Tile / resize → G4,G8               crop remains honored [→E2E]
  └ opaque / transparent / unavailable → G8          readable UI / fallback [→native]
```

| Group                    | Required assertions and failure handling                                                                                                                                                                                                                                                                                                                                                                                | Test targets                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| G1 · CRITICAL regression | Keep unrelated old settings; invalid patches do not reset them. First successful apply changes active 100% values to 60% once; failure, non-100%, later apply and inactive mode preserve values. Concurrent add/remove retains both intents. Equal nested values cause no write. Write/rename failure preserves disk/cache and later save recovers. Never infer deletions from corrupt settings.                        | Extend `src/shared/settings.test.ts`, `src/main/services/settings.test.ts`, `src/renderer/src/hooks/useUpdateSettings.browser.test.tsx`. |
| G2 · lifecycle           | Close Settings immediately after acceptance; show the result in Main or reopened Settings. Both windows closed/recreated; newer selection, explicit Clear or removal of the pending source wins over slow preparation; unrelated removal preserves it. Double Apply does not duplicate an accepted operation. App quit/crash before commit retains prior committed data; restart does not replay provider side effects. | New `src/main/services/backgrounds.test.ts`, `e2e/spec/background-gallery.e2e.ts`; extend settings-window tests.                         |
| G3 · ingestion           | 1920×1080 and 1080×1920 accepted; 1919×1080 and 1920×1079 rejected. Test exact 20 MiB / 80,000,000-pixel limits and one-over. EXIF rotations/mirrors, corrupt files, fake extensions, APNG, animated WebP, picker cancel, disk full, failed copy/preview/publish/unlink. Validate actual image fixtures, not only mocked metadata. User original never deleted.                                                         | New `src/main/services/backgroundImages.test.ts`; real-file integration cases.                                                           |
| G4 · crop                | All three sources × Original/16:9/16:10 × Fill/Fit/Tile. Source pixels, fractional-rounding boundaries, out-of-bounds/nonfinite coordinates, preview resize and actual downloaded resolution. Cancel preserves current; reset restores full crop; re-edit/restart restores saved percentages. Pixel fixtures prove excluded regions never reappear.                                                                     | New crop browser tests and background geometry tests; gallery E2E.                                                                       |
| G5 · gallery             | Delayed old search, two next-page triggers, duplicate IDs, null optional metadata, zero/one/last page, failed later page, offline/online, stale remount/reconnect and explicit Refresh. Seed a long list; bounded rendered rows, back-scroll content and focus retained. Keyboard tabs, crop controls, Apply/Cancel and Load more/Retry remain usable.                                                                  | New `src/renderer/settings/backgrounds/BackgroundGallery.browser.test.tsx`; real query client and mocked HTTP boundary.                  |
| G6 · provider/security   | Invalid query/page, upstream malformed data, 401/403/429/5xx/timeouts; URL host/path mismatch and redirects rejected before credentialed fetch. Actual origin/preflight/CSP behavior in packaged Electron. No key in either desktop/renderer bundle. Required credits and `ixid` remain. Track new application only; no notification for browsing, crop movement, restart or acknowledged disk retry.                   | Website contract/handler tests; local HTTP-server integration and a separate live provider smoke test.                                   |
| G7 · distribution        | Exactly four bundled assets with credits/dimensions; originals moved/deleted externally do not affect uploads. Packaged arm64 and x64 load Sharp and process valid/invalid fixtures. Website tests/lint/typecheck/build run from a clean install. Shared contract builds from both package roots; E2E bridge declarations compile.                                                                                      | Extend build/typecheck workflows and root fast gate; `e2e/types.d.ts`, `e2e/tsconfig.json`; packaged smoke checks.                       |
| G8 · CRITICAL regression | All shipped themes/modes and opacity values preserve foreground opacity; retain current AA guarantee at 85–100% rather than inventing an AA guarantee over arbitrary images at 0%. At 100% the image is hidden. Check bright/dark images, mixed Section values, menus/code/webview boundaries and no webview reload. Record crop/opacity/resize motion; inspect intermediate frames and reduced motion.                 | Extend `src/renderer/src/styles/windowSurface.test.ts`, `e2e/spec/window-opacity.e2e.ts`; Playwright CLI visible macOS QA.               |

For each new failure above: add the test with implementation, retain the last committed state, and show a recoverable error; stale/cancelled work exits without a misleading failure toast. No planned silent critical failure remains. Tests for the new paths do not exist yet.

### Focused engineering follow-up: boundary coverage

E1 (P1, confidence 9/10): new-import Cancel and gallery-draft restoration conflicted. Confirmed 1A: discard the new token and restore the prior image/crop. Transfer accepted inputs to Main before await/reply; distinguish transient draft tokens from saved upload IDs.
E2 (P2, confidence 8/10): `removal wins` did not scope supersession. Confirmed 2A: cancel only related Apply work; preserve unrelated application. E3: six boundary scenarios below are mandatory additions to G2–G5; user confirmed no further cases. Performance: no additional finding; installed react-window supports the required scroll/range APIs.

```text
Proposed boundary / branch                 Required observable check
new upload → Cancel                       previous image/crop restored [browser →E2E]
draft → Main accepts → delayed IPC reply   close Settings; accepted inputs survive [files →E2E]
saved upload → remove during Apply        no resurrected reference; stale error quiet [queue →E2E]
unrelated upload → Remove                 pending Apply continues; both changes persist [queue]
no committed image → pending Apply→Clear  prior no-image state retained [queue →E2E]
virtual row focus → search/tab/resize      discard stale target; focus stays intentional [browser]
```

These gallery paths are not implemented or tested yet. Existing settings/window tests cover the foundation only. Use real files/store/IPC at lifecycle boundaries; callback mocks alone cannot prove ownership or persistence. Use stable photo IDs and current row counts/columns before scrolling; query, view, resize or focus-owner changes invalidate obsolete focus work. No new job, queue, cache or virtualizer framework. The combined QA handoff retains G1–G8 plus this addendum: the local project review archive (combined baseline and engineering follow-up QA).

## Implementation Tasks

Effort is approximate and includes matching tests. New paths below are proposed; reuse any equivalent discovered during implementation.

- [ ] **T1 · P1 · human ~2h / AI ~30m — Define shared contracts and settings shape.** From Q1/G1/G6/G7. Extend `src/shared/settings.ts`, `src/shared/constants.ts`, `src/shared/ipc-contract.ts`, `src/shared/ipc-channels.ts`, `src/main/ipc/ipc-schemas.ts`, `src/preload/index.ts`; add the server-free Website contract. Verify schema boundaries, legacy defaults, both builds and bridge typecheck.
- [ ] **T2 · P1 · human ~3h / AI ~45m — Add safe background ingestion and four bundled assets.** From A2/G3/G7. Add `src/main/services/backgroundImages.ts` and `resources/backgrounds/`; update `package.json`, lockfile and packaging only as needed. Verify actual fixtures, cleanup/ownership and both packaged architectures.
- [ ] **T3 · P1 · human ~3h / AI ~45m — Own apply/library transactions and results in Main.** From A1/Q1/G1/G2. Add `src/main/services/backgrounds.ts`, `src/main/ipc/backgrounds.ts`; extend settings service, IPC registration and window synchronization. Verify race, no-op, first-use opacity, save failures and close/reopen with real files/IPC.
- [ ] **T4 · P1 · human ~3h / AI ~45m — Implement the oRPC Unsplash proxy.** From A1/G6/G7. Add Website contract/server/route tests; update `website/next.config.ts`, Website package/lockfile and server configuration. Verify input/URL/security boundaries, rate behavior, build and live API prerequisites.
- [ ] **T5 · P2 · human ~4h / AI ~60m — Integrate gallery and crop controls.** From A1/A2/P1/G4/G5. Extend `src/renderer/settings/sections/Appearance.tsx` and `src/renderer/settings/SettingsApp.tsx`; add gallery/crop components and their focused hooks. Verify all sources, keyboard flow, query races, explicit refresh and operation results.
- [ ] **T6 · P1 · human ~2h / AI ~30m — Render the accepted crop behind all panes.** From G4/G8. Extend `src/renderer/src/App.tsx`, styles and a single background component. Verify Fill/Fit/Tile pixel fixtures, existing text/opaque boundaries, resize and webview lifetime.
- [ ] **T7 · P1 · human ~3h / AI ~45m — Complete gates, native QA and design documentation.** From G1–G8. Extend `.github/workflows/`, fast validation, E2E types/specs and `DESIGN.md`; preserve exact execution evidence. Promote the selected trial only after integration works; update `_trials/.manifest.json` and archive rejected trials at that stage. No deferred P3 tasks.

Add short flow comments at the image publication boundary and queued latest-intent/first-use transaction. Follow existing JSDoc, AAA, observable test names and visible UI assertions.

### Design additions to Implementation Tasks

These extend T3/T5/T7; they do not create another implementation lane. Estimates include matching regression checks.

- [ ] **DT1 · P2 · human ~1h / AI ~15m — Implement A's gallery hierarchy.** From D1. Extend Appearance and gallery components; keep one modal scroll area and opacity/layout in Appearance. Verify all source tabs, draft vs Applied and crop return position.
- [ ] **DT2 · P1 · human ~1.5h / AI ~20m — Expose accepted-operation states.** From D2/D6. Extend Main background operations, IPC results and gallery status UI. Verify pre-acceptance cancellation, post-acceptance Close, retained draft/Retry, replay and deletion races with real files/IPC.
- [ ] **DT3 · P1 · human ~1.5h / AI ~20m — Align crop controls with the actual cropper.** From D4. Use a fixed frame, labelled move/zoom, source dimensions and Reset; locally override dialog scale/slide. Verify keyboard, invalid crop, restoration and recorded geometry.
- [ ] **DT4 · P1 · human ~1h / AI ~15m — Preserve compact-window and virtual-list access.** From D5. Extend gallery/editor layouts and focus handling. Verify 600×400 / 800×600, long content, supported zoom, visible actions, credit links, virtual focus and reduced motion.
- [ ] **DT5 · P2 · human ~30m / AI ~10m — Explain applied-but-hidden backgrounds.** From D3. Extend Appearance and success status. Verify active-mode 100%, mixed Section values, first-use-only notice and Adjust opacity focus.

No new tasks from the generic-UI-risk pass; existing tokens and the approved functional photo grid cover it. No deferred design TODOs. Detailed planned checks: the local project review archive (design QA).

### Engineering follow-up task extensions

- [ ] **ET1 · P1 · human ~1h / AI ~15m — Make upload draft ownership explicit.** E1; extends T1/T3/DT2. Update Apply IPC input, Main acceptance/cleanup and gallery restore state. Verify cancelled new vs existing crop, invalid tokens and closure before acknowledgement with real files.
- [ ] **ET2 · P2 · human ~30m / AI ~10m — Scope removal supersession to the affected image.** E2; extends T3/DT2. Keep long-running status specific to Apply; merge unrelated library operations through the existing queue. Verify same-source removal, other-source removal and Clear before first commit.
- [ ] **ET3 · P1 · human ~1h / AI ~15m — Pin the six new boundary cases.** E3; extends T7/DT4. Add Node/Chromium/Electron cases above, including query/column/focus changes before a virtual row is ready. Verify actual state/files/focus; keep existing gate order.

## Execution order and completion gates

| Step / lane                            | Modules                                             | Depends on                     |
| -------------------------------------- | --------------------------------------------------- | ------------------------------ |
| Contracts                              | `src/shared`, Website contract, package definitions | —                              |
| A: image ingestion → Main transactions | `src/main`, `src/preload`, resources                | Contracts                      |
| B: shared proxy                        | `website` server/route                              | Contracts                      |
| C: gallery/crop → background rendering | `src/renderer`                                      | Contracts; integrate after A/B |
| Integration                            | E2E, CI, design docs, packaged/native QA            | A/B/C                          |

A and B can run in separate worktrees after contracts are fixed. Keep renderer work sequential in one lane; dependency/lockfile and shared-contract changes belong to the contract step to avoid conflicts. No worktrees or delegated implementation have been started by this review.

1. Fast gate: extend `pnpm validate` to include Website tests/lint/typecheck/build and `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, then pass it.
2. Only after the fast gate passes: `pnpm test:e2e`; verify actual tests executed.
3. Isolate HOME and userData. Preserve live Claude/Cursor skills; unlink copied hardlinked fixture files before replacing them.
4. Verify visible macOS windows, both-window synchronization, restart, live Unsplash integration, offline local images and native packaging. Use Playwright CLI recording and extracted frames for motion.
5. For a signed local production build, use `APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac`. Record architecture-specific evidence. Do not publish a release.

## NOT in scope

- macOS wallpaper catalog: the user replaced it with bundled Unsplash photos.
- Rehosting or permanently caching online Unsplash images: direct hotlinking remains the integration contract; offline availability is for bundled/uploaded images.
- Whole-app IPC migration, separate settings database or durable background-job framework: existing typed IPC and serialized settings persistence cover this feature.
- Version bump, release or distribution upload: owned by a later `/electron-release` request.
- Unrelated dashboard/layout cleanup: preserve this branch's background-gallery focus.
- Freeform resize-handle crop editor, new Settings navigation, mobile layouts, custom worker/cache/focus-retention frameworks and a new upload-trash system: existing cropper, desktop primitives and confirmation cover the approved behavior.

No new deferred TODOs. Provider registration, deployment configuration and verification are explicit implementation gates, not completed work.

## GSTACK REVIEW REPORT

| Review        | Trigger                                               | Why                                       | Runs | Status       | Findings                                                                                                                                                |
| ------------- | ----------------------------------------------------- | ----------------------------------------- | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eng Review    | `/plan-eng-review` + requested design-delta follow-up | Architecture, quality, tests, performance | 2    | CLEAR (PLAN) | Original: four substantive findings + eight test groups. Follow-up: E1 ownership/Cancel, E2 removal scope, E3 six boundary scenarios; all incorporated. |
| Design Review | User-selected follow-up                               | Visual/interaction completeness           | 1    | CLEAR (PLAN) | 7/10 → 9/10; approved Gallery A / Crop A; five selected decisions, with upload timing explicitly confirmed in engineering follow-up.                    |
| CEO Review    | Not requested                                         | Scope/strategy                            | 0    | Not run      | Existing full-gallery scope retained.                                                                                                                   |
| Outside Voice | Skill preflight / optional design step                | Independent challenge                     | 0    | Skipped      | Both engineering runs detected Codex host; design optional question was unanswered. No independent review claimed.                                      |

| Design pass                   | Before                     | After                                                        |
| ----------------------------- | -------------------------- | ------------------------------------------------------------ |
| Information architecture      | 8/10                       | 10/10                                                        |
| Interaction states            | 7/10                       | 10/10                                                        |
| User journey                  | 7/10                       | 10/10                                                        |
| Specificity / generic UI risk | 8/10                       | 9/10                                                         |
| Design system alignment       | 8/10                       | 10/10                                                        |
| Compact-window accessibility  | 6/10                       | 10/10                                                        |
| Decisions                     | Six design items clarified | 0 deferred; former upload default explicitly confirmed as E1 |

Gallery A and Crop A were selected at 5/5 and jointly confirmed. The retained edited references preserve that direction; generated imagery/credits are illustrative. DESIGN.md, visible states, journey, accessibility, five design task extensions and three engineering follow-up extensions are recorded. No new deferred TODOs. Scores grade the written specification, not a running app.

The second engineering run reviews the design additions against the original reviewed baseline: Architecture 1 issue, Code Quality 1 issue, six added test scenarios, Performance 0 new issues. Source ownership, acknowledgement timing, cancel restoration, removal scope, commit ordering and virtual focus are now explicit. Existing Website/contract/packaging requirements remain in G1–G8. No additional design round is needed: the follow-up clarifies these behaviors within the approved layouts and updates DESIGN.md accordingly.

Artifacts:

- Combined QA (baseline + follow-up): the local project review archive (combined baseline and engineering follow-up QA).
- Design QA: the local project review archive (design QA).
- Design tasks: the local project review archive (design task JSONL) (5).
- Engineering follow-up tasks: the local project review archive (engineering follow-up task JSONL) (3).
- Original engineering task artifact remains valid for T1–T7; extensions above refine those tasks rather than creating another implementation lane.

Checks during planning: documentation formatting, diff whitespace, structured task records, retained requirements, source/API feasibility and static reference review. Feature implementation, runtime tests, native motion/compositing, provider deployment and packaging verification remain unperformed. No PR, release or version change.

**VERDICT:** ENG + DESIGN PLAN CLEAR — ready to implement. Run the prescribed fast gates, Electron E2E and visible native QA with implementation.

NO UNRESOLVED DECISIONS
