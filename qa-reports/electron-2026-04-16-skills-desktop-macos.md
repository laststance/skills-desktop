# QA Report — Skills Desktop (preview pane)

**App:** Skills Desktop v0.10.0 (dev build via `pnpm dev`)
**Host:** macOS (Darwin 25.4.0, arm64)
**Runtime:** Electron 41.1.0, Node 22.19.0 (via preamble)
**Date:** 2026-04-16
**Scope:** Recent preview work (commit `adc323c` — `useCodePreview` race guard + FileTabs + FileContent)
**Method:** CDP @ port 9222 via `agent-browser`, DOM probes via `eval`

Evidence lives alongside this file at
`qa-reports/electron-2026-04-16-skills-desktop-macos/`.

---

## Health Scores

| Category         | Score | Notes                                                                 |
| ---------------- | ----- | --------------------------------------------------------------------- |
| Functional       | 6/10  | Race bug: ARIA selection and content diverge on rapid tab clicks      |
| Visual           | 9/10  | Tabs, active state, code rendering all look clean                     |
| Accessibility    | 5/10  | Files/Info toggle lacks ARIA state; file tabs lack arrow-key nav      |
| State            | 6/10  | Info→Files toggle unmounts `CodePreview`, losing active-file + scroll |
| Security         | 9/10  | `nodeIntegration` off, contextBridge in use, no in-renderer CSP meta  |
| Platform (macOS) | n/a   | Native menu/tray/notification surfaces out of scope this run          |

## Top 3 Things to Fix

1. **[HIGH] Race condition in `setActiveFile`** — content can display the wrong file after rapid tab clicks (#1)
2. **[MED] State loss on Files/Info toggle** — `CodePreview` unmounts, refetches from IPC, reverts to SKILL.md (#4)
3. **[MED] File tabs not keyboard-navigable via arrow keys** — fails WAI-ARIA tabs pattern (#3)

---

## Issues

### #1 — Race condition: rapid tab clicks leave ARIA selection and content out of sync — HIGH

- **Category:** functional / race-condition
- **Scope:** renderer — `src/renderer/src/hooks/useCodePreview.ts`
- **Surface:** SkillDetail → Files → FileTabs
- **Evidence:**
  - `qa-reports/.../06-race-bug-evidence.png`
  - DOM probe (after 4 synchronous clicks `color → interaction → motion → responsive`):

    ```json
    {
      "active": ["Installed", "reference/responsive-design.md"],
      "firstRows": ["1", "# Motion Design", "2", " "]
    }
    ```

- **Repro (100%):** Open `frontend-design` skill → run in DevTools:

  ```js
  Array.from(document.querySelectorAll('[role="tab"]'))
    .filter((t) => t.textContent.includes('reference/'))
    .slice(0, 4)
    .forEach((t) => t.click())
  ```

  Expected: content for `reference/responsive-design.md` (4th click wins).
  Actual: `aria-selected` is on `responsive-design.md`, but the rendered preview
  shows `# Motion Design` content.

- **Root cause:** `setActiveFile` in `useCodePreview.ts:86-101` awaits
  `loadContentForFile(file)` then unconditionally calls `setContent(next)`.
  The existing `userSelectedFileRef` guard only covers the _initial-load
  effect_ (lines 76-78) — not subsequent user-initiated fetches. When the
  user clicks faster than IPC can resolve, intermediate fetches land
  after the final click and clobber the active file's content.
- **User impact:** A user browsing a multi-file skill (scrubbing through
  tabs to find something) can land on a tab whose content belongs to a
  sibling file. The ARIA state lies about what they're reading.
- **Fix sketch:** Capture `path` at call-time; after `await`, check
  `userSelectedFileRef.current === path` (and that the skillPath hasn't
  changed). If not, discard the stale result. Extend the race-guard unit
  test (`useCodePreview.test.tsx`) with a test that simulates two rapid
  `setActiveFile` calls where the first read resolves last.

### #2 — Files/Info toggle lacks `aria-pressed` / `aria-selected` — MED

- **Category:** accessibility
- **Scope:** renderer — `src/renderer/src/components/skills/SkillDetail.tsx:53-75`
- **Evidence:** DOM probe returned
  `{ files: { ariaPressed: null, ariaSelected: null }, info: { ariaPressed: null, ariaSelected: null } }`.
  Active state is conveyed only by Tailwind class name (`text-primary` vs
  `text-muted-foreground`).
- **User impact:** Screen reader users cannot tell which view (Files or
  Info) is currently active. Color-only signaling also fails in forced-
  colors / high-contrast mode.
- **Fix sketch:** Either (a) add `aria-pressed={activeTab === 'code'}` to
  the Files button and `aria-pressed={activeTab === 'info'}` to Info, or
  (b) promote the pair to a proper `role="tablist"` with `role="tab"` +
  `aria-selected` + `aria-controls` on each, and a `role="tabpanel"`
  wrapper below.

### #3 — File tabs are not arrow-key navigable (WAI-ARIA tabs pattern) — MED

- **Category:** accessibility / keyboard
- **Scope:** renderer — `src/renderer/src/components/skills/FileTabs.tsx:28-42`
- **Evidence:**
  - Focused SKILL.md tab, pressed ArrowRight → focus stayed on SKILL.md.
  - All 8 file tabs are `<button>` elements with no explicit `tabindex`.
- **User impact:** Keyboard users must Tab through every file tab
  individually — a 10-file skill requires 10 Tab presses before reaching
  the preview. Standard ARIA tabs pattern lets them hop across with one
  ArrowRight + ArrowLeft.
- **Fix sketch:** Adopt the roving tabindex pattern — `tabindex={0}` on
  the active tab, `tabindex={-1}` on the rest, plus an `onKeyDown` that
  handles `ArrowLeft`/`ArrowRight`/`Home`/`End` to move focus and call
  `onSelectAction`. Radix Tabs ships this; swapping the inner tab
  `<button>` list for Radix `<Tabs.List>` + `<Tabs.Trigger>` is the
  lowest-risk route since Radix is already a dep.

### #4 — Info→Files toggle unmounts CodePreview, losing state — MED

- **Category:** state
- **Scope:** renderer — `src/renderer/src/components/skills/SkillDetail.tsx:80-82`
- **Evidence:** After clicking `reference/responsive-design.md`, clicking
  Info, then clicking Files, the active tab reverts to SKILL.md and the
  IPC re-fetches the file list.
- **Pattern:** `{activeTab === 'code' ? <CodePreview /> : <Info />}` is
  the conditional-render anti-pattern called out in `~/.claude/rules/react-rules.md`
  — state is lost on every toggle.
- **User impact:** User opens `SKILL.md`, scrolls to line 200, clicks Info
  to check the source URL, clicks Files — they're back at line 1 of
  `SKILL.md` with no memory of having been on line 200 of
  `reference/typography.md`. Also: every toggle re-issues
  `window.electron.files.list(skillPath)` + `read(SKILL.md)` — minor CPU
  / IPC churn.
- **Fix sketch:** Wrap both branches in `<Activity mode={...}>` so the
  hidden branch retains its state. Or keep both mounted with CSS
  `display`. The Activity API is React 19+, already in use on this
  project per the rules doc.

### #5 — No `<meta http-equiv="Content-Security-Policy">` on renderer — INFO

- **Category:** security
- **Scope:** renderer — `index.html`
- **Evidence:** `document.querySelector('meta[http-equiv="Content-Security-Policy"]')` → `null`.
- **Note:** Not necessarily a defect — many Electron apps set CSP via the
  main process `session.defaultSession.webRequest.onHeadersReceived`
  instead, which does not show up as a meta tag. Spot-check only;
  verifying the main-process CSP is out of scope for this run.
- **Positive signals from the spot-check:**
  - `typeof require` in renderer → `"undefined"` (nodeIntegration off ✅)
  - `window.electron` is an `object` (contextBridge working ✅)

---

## Phases Completed

- [x] Phase 0 — Launch + CDP + baseline snapshot
- [x] Phase 1 — Surface mapping (scoped to preview pane)
- [x] Phase 2 — Per-surface exploration (FileTabs, FileContent, Files/Info)
- [x] Phase 3 — Multi-window coverage (N/A — preview is single window)
- [ ] Phase 4 — Native OS integration (skipped per scope)
- [ ] Phase 5 — OS states (theme/offline/resize) (skipped per scope)
- [x] Phase 6 — Accessibility (tablist, Files/Info, keyboard nav)
- [x] Phase 7 — Security spot-check (nodeIntegration, contextBridge, CSP)
- [x] Phase 8 — Triage
- [x] Phase 9 — Report

## Phases NOT completed (per scope)

- Native OS surface (menu bar, tray, notifications, drag-and-drop)
- OS theme / offline / resize states
- Multi-monitor / fullscreen behavior
- VoiceOver screen-reader smoke test (heuristic ARIA-only here)

## Evidence index

| File                                        | Purpose                                                 |
| ------------------------------------------- | ------------------------------------------------------- |
| `00-baseline-snapshot.txt`                  | Cold-start main window, Installed tab, 63 skills        |
| `01-skill-adapt-opened.png`/`-snapshot.txt` | Single-file skill preview (SKILL.md only)               |
| `02-analyze-app.png`/`-snapshot.txt`        | Same — analyze-app also single-file                     |
| `03-brainstorming.png`/`-snapshot.txt`      | Multi-file skill showing all 8 file tabs                |
| `04-helper-js-tab.png`/`-snapshot.txt`      | `.js` file rendering via FileContent                    |
| `05-skillpath-reset.png`                    | `frontend-design` after skill switch — correct reset    |
| `06-race-bug-evidence.png`                  | **#1 race bug** — ARIA on responsive, content on motion |
| `07-info-panel.png`                         | Info view (SYMLINK STATUS, LOCATION)                    |
