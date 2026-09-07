# Background gallery verification

Recorded 2026-09-08 JST. Runtime checkpoint: `6817d28eebb7e9ec27f03d21f0f23b6a5e709a7e` on `codex/background-gallery`; its tracked tree matches reviewed `7ee08a3`. The [plan](../../plan.md) retains the complete acceptance requirements; [DESIGN.md](../../DESIGN.md#background-gallery) records the implemented visual contract.

## Implemented behavior

- Four bundled, credited Unsplash images; live-gallery UI with infinite scrolling; owned local uploads and source-relative cropping. Online provider access remains gated below.
- Original / 16:9 / 16:10 crops and Fill / Fit / Tile rendering behind all three panes. Sources and crops require long edge ≥1920 px and short edge ≥1080 px after orientation; uploads are static JPEG/PNG/WebP, ≤20 MiB and ≤80 megapixels.
- Draft selection does not change the workspace. Main owns accepted Apply through window closure, supersession, atomic settings writes and result replay. Clear, upload removal and first-use opacity preserve the agreed transaction ordering.
- Foreground/native opacity stays 1. The first successful image changes untouched active 100% opacity values to 60% once; later image changes and Clear preserve opacity. Menus, dialogs, code and webviews retain opaque surfaces.
- oRPC 1.15.0 and TanStack Query v5 share a server-free Website contract. Renderer file access remains behind typed preload IPC. Online images stay hotlinked; failures preserve the selected source and offer explicit recovery.

## Recorded results

| Gate                         | Result                                                                                                                                                                                                                                                      | Evidence                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Ordered fast validation      | Pass: 212 root files / 2,924 tests; 2 Website files / 73 tests. Lint, typechecks, Fallow, Storybook and Website build passed.                                                                                                                               | `validate-6817d28.log`                                                                                                   |
| Following Electron E2E       | Pass: 106 actual tests, 13 gallery + 93 existing; zero failures/skips, 1.9 minutes.                                                                                                                                                                         | `e2e-6817d28.log`                                                                                                        |
| Coverage, review lane        | Pass with unchanged floors: 2,924 tests; lines 99.20%, functions 97.10%.                                                                                                                                                                                    | `review-round-2-coverage.log`                                                                                            |
| CodeRabbit review            | Three completed runs: 42 findings, 31 findings, then 0 on fix verification. Earlier findings have explicit fixed/rejected dispositions.                                                                                                                     | `coderabbit-9f9ea12.jsonl`, `coderabbit-6407d38.jsonl`, `coderabbit-6817d28-fix-verification.jsonl`; review-fix handoffs |
| Signed macOS build           | arm64 and x64 applications built, signed and notarized. No version bump or release.                                                                                                                                                                         | `build-mac-6817d28.log`                                                                                                  |
| Hosting boundary             | Production bounded-route smoke passed 8/8; per-IP hosting rule proved 60 allowed / 3 rejected requests in a 60-second window.                                                                                                                               | `proxy-vercel-production-6407d38-smoke.json`, `vercel-rate-limit-smoke.json`                                             |
| Actual signed request        | arm64 Settings sent a canonical search request with `bypassCSP: false` and received readable HTTP 503 plus safe unconfigured-provider guidance.                                                                                                             | `native-qa/packaged-wire-6817d28.json`                                                                                   |
| Full packaged smoke          | Pass in actual signed arm64 and x64 apps: four decoded thumbnails, Alpine lake Apply at 3840×2560, Sharp upload/display pixels at 1920×1080, moved-original ownership, small/corrupt rejection, restart and Main/Settings CSP.                              | `packaged-6817d28-corrected.json` (`complete: true`, both `passed`)                                                      |
| Recorded renderer motion     | Pass: 164 sampled frames, including 47 intermediate alpha frames; all three pane opacities and the article heading remain 1. CLI videos were recorded, extracted and visually inspected. Reduced motion records a 0.00001-second transition without a fade. | `native-qa/motion-6817d28.json`, `native-qa/reduced-motion-6817d28.json`; contact sheets below                           |
| Native window captures       | Inspected ten states: light/dark × 0/45/60/85/100% opacity, plus the 800px gallery and 600px crop layout.                                                                                                                                                   | `native-qa/final-window-matrix-contact.png`; CLI contact sheets below                                                    |
| LaunchServices window smoke  | Pass: actual arm64 and x64 packaged windows classified `REAL_UI`.                                                                                                                                                                                           | `native-window-arm64-6817d28.log`, `native-window-x64-6817d28.log`                                                       |
| Signed restart               | arm64 restart restored Alpine lake at 3840×2560 and settled Section backgrounds at 45/60/85%; native and pane opacity remained 1.                                                                                                                           | `native-qa/after-restart-6817d28.json`                                                                                   |
| Visible desktop compositing  | Not certified. One briefly unlocked desktop capture succeeded; the Mac relocked before the full backdrop flow. The next video contained one black frame (0.067 seconds) and was rejected. The white/black backdrop and theme matrix remains open.           | `native-qa/visible-native-after-restart.png`; complete visible-desktop record pending                                    |
| Remote CI at this checkpoint | Pending: the `f80bc1e` rerun uses serial outer validation after the earlier orchestration timeout. Local passes above do not certify that remote run.                                                                                                       | Parent-owned current CI verification                                                                                     |

Evidence filenames refer to the local implementation archive at `~/.gstack/projects/laststance-skills-desktop/implementation/`; logs and recordings are not committed to this repository. Review dispositions are in its sibling `implementation-review-fixes.md` and `implementation-review-fixes-round-2.md` handoffs.

Inspected recording contact sheets: `native-qa/final-motion-main-contact.png`, `native-qa/final-cli-hero-main-contact.png`, `native-qa/final-cli-hero-settings-contact.png`, and `native-qa/reduced-motion-settings-contact.png`. The corrected packaged harness changes only thumbnail expectations and its asynchronous wait; the tested signed runtime/bundles remain `6817d28`.

## What the automated runs prove

The [gallery Electron suite](../../e2e/spec/background-gallery.e2e.ts) uses isolated HOME/userData and actual files, Sharp decoding, preload IPC and native window closure. It covers accepted inputs surviving a delayed reply and both windows closing; same-source and unrelated-source removal; Clear on either side of the final settings rename check; crop pixels and retained originals; visible save failure/Retry; both renderer CSP probes; keyboard/virtual-focus behavior; and early release of the test reply gate.

Node and Chromium regressions additionally cover schema/defaults, image limits and animation rejection, serialized processing, search cancellation/refresh/pagination, explicit error recovery, and Fill/Fit/Tile pixel boundaries. Controlled HTTP/CDN fixtures verify application behavior; they are not successful live-provider evidence. CSS/pixel assertions and native-window captures do not replace visible compositor/video verification.

The formally ordered commands were:

```sh
VITEST_MAX_WORKERS=4 pnpm validate
pnpm test:e2e
```

The separate signed build used `APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac`. These commands document completed runs; their outputs refer to the exact runtime checkpoint above.

## Remaining acceptance gates

1. Configure the Unsplash access key through Laststance's provider/Vercel configuration and obtain production approval/quota evidence. Then verify actual search, credits/hotlinks and a new-image download notification. Current production and signed UI return a deliberate unconfigured-key 503; no successful provider action is claimed.
2. Complete the unlocked, visible desktop recording with bright/dark backdrops and verify compositing during the required image/opacity/motion flows. Inspect extracted frames; preserve the successful renderer-motion and native-window evidence above without treating it as this missing desktop pass.
3. Finish the current remote CI run after its bounded orchestration correction. Preserve exact checked-commit results separately from the successful local runtime gates above.

These are the original G6–G8 completion gates. The full gallery scope remains implemented; no new deferred feature tasks or release/version changes are introduced by this record.
