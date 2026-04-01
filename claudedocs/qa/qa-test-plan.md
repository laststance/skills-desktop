# QA Test Plan - Skills Desktop Marketplace CSS Issues

## Platform Detection

| Property         | Value                                                       |
| ---------------- | ----------------------------------------------------------- |
| **Platform**     | Electron desktop app (macOS)                                |
| **App Version**  | 0.6.1                                                       |
| **Framework**    | electron-vite + React + Redux Toolkit                       |
| **Feature**      | Marketplace UI (feature flag `ENABLE_MARKETPLACE_UI: true`) |
| **Testing Tool** | `agent-browser` CLI (CDP port 9222)                         |
| **Prerequisite** | `pnpm dev` running                                          |

---

## Primary Issue

**Marketplace skill cards are cut off on the right side** -- bookmark star, download count, and install button are hidden/clipped.

### Root Cause Hypothesis

The `SkillRowMarketplace` component uses `flex items-center gap-4` in a container that may not have `overflow: hidden` + `min-w-0` properly set on the flex parent chain. The `ScrollArea` in `SkillsMarketplace` uses `px-6` padding, but the inner card row has no `min-w-0` on the flex container, potentially allowing children to overflow.

### Layout Chain (outer to inner)

```
App (h-screen, flex)
  -> Sidebar (w-[240px])
  -> Panel Group (flex-1, horizontal)
    -> Panel (50%, min 20%) = MainContent
      -> Tabs -> TabsContent (marketplace)
        -> SkillsMarketplace (h-full, flex-col)
          -> ScrollArea (flex-1, px-6)
            -> flex-col gap-2 (results list)
              -> SkillRowMarketplace (flex, items-center, gap-4, h-[72px])
                -> Rank badge (w-8, h-8)
                -> Skill info (flex-1, min-w-0)
                -> Bookmark button (min-w-[44px], min-h-[44px])
                -> Download count (flex, items-center)
                -> Install/Remove button (px-4, py-2)
```

---

## Test Areas

### 1. Visual Integrity (Task #2)

Focus: Marketplace card rendering and right-side cutoff

| ID   | Test                       | Expected                                                                            | Priority |
| ---- | -------------------------- | ----------------------------------------------------------------------------------- | -------- |
| MV1  | Card right-side visibility | Bookmark star, download count, Install button all visible without horizontal scroll | P0       |
| MV2  | Card width containment     | Cards fill available width within ScrollArea without overflow                       | P0       |
| MV3  | Rank badge rendering       | Rank number visible in 32x32 rounded badge, cyan text                               | P1       |
| MV4  | Skill name truncation      | Long skill names truncate with ellipsis (`truncate` class), no layout break         | P0       |
| MV5  | Repo path truncation       | Long repo paths (e.g. `org-name/very-long-repo-name`) truncate cleanly              | P0       |
| MV6  | Install button styling     | Cyan bg (#22D3EE), dark text, Plus icon visible                                     | P1       |
| MV7  | Installed state styling    | Cyan border, "Installed" badge with Check icon, red "Remove" button                 | P1       |
| MV8  | Bookmark star states       | Unfilled (slate) vs filled (amber #F59E0B) star renders correctly                   | P1       |
| MV9  | Download count display     | Download icon + formatted count (e.g., "72.9K") visible                             | P1       |
| MV10 | Card hover state           | Border transitions to `primary/50` on hover for non-installed cards                 | P2       |
| MV11 | Card spacing               | 8px gap between cards (`gap-2`), 24px horizontal padding (`px-6`)                   | P1       |
| MV12 | Header layout              | Title, subtitle, RankingTabs, search bar render without overlap                     | P1       |
| MV13 | Search bar layout          | Search input + button in flex row, no overflow                                      | P1       |
| MV14 | Ranking tabs               | 3 tabs (All Time, Trending, Hot) visible, active tab highlighted cyan               | P1       |
| MV15 | Empty/loading states       | "Search for Skills" placeholder, "Searching..." state render centered               | P2       |
| MV16 | Panel resize impact        | Marketplace cards remain fully visible when main panel is resized to minimum (20%)  | P0       |

### 2. Functional Correctness (Task #3)

Focus: Marketplace interactions and state management

| ID   | Test                             | Expected                                                             | Priority |
| ---- | -------------------------------- | -------------------------------------------------------------------- | -------- |
| MF1  | Tab switching                    | Click "Marketplace" tab -> SkillsMarketplace renders                 | P0       |
| MF2  | Search execution                 | Type query + Enter or click Search -> results appear                 | P0       |
| MF3  | Search disabled state            | Empty input disables Search button, searching shows spinner          | P1       |
| MF4  | Install button click             | Opens InstallModal with skill details                                | P0       |
| MF5  | Remove button click              | Opens RemoveDialog for installed skills                              | P0       |
| MF6  | Bookmark toggle                  | Star toggles between filled/unfilled, persists in Redux state        | P1       |
| MF7  | Install count format             | 72900 -> "72.9K", 1500000 -> "1.5M", 0/undefined -> em-dash          | P1       |
| MF8  | Installed skill detection        | Skills already installed show cyan border + "Installed" badge        | P1       |
| MF9  | Button disabled during operation | Install/Remove buttons disabled while `installing`/`removing` status | P1       |
| MF10 | Error display                    | API errors show in destructive banner below header                   | P2       |
| MF11 | Result count                     | "Found N skills for 'query'" text displays correctly                 | P2       |
| MF12 | Scroll behavior                  | Results list scrollable when exceeding viewport                      | P1       |

### 3. Apple HIG Compliance (Task #4)

Focus: Marketplace-specific HIG adherence

| ID   | Test                             | Expected                                               | Priority |
| ---- | -------------------------------- | ------------------------------------------------------ | -------- |
| MH1  | Bookmark button tap target       | Min 44x44px (`min-h-[44px] min-w-[44px]`)              | P0       |
| MH2  | Install/Remove button tap target | Sufficient click area (px-4 py-2 + icon)               | P0       |
| MH3  | Ranking tab tap targets          | Each tab has adequate click area                       | P1       |
| MH4  | Search input focus ring          | Visible focus indicator on keyboard focus              | P1       |
| MH5  | Tab keyboard navigation          | Tab key navigates through Installed/Marketplace tabs   | P1       |
| MH6  | Color contrast - card text       | White text on #1E293B bg meets WCAG AA                 | P1       |
| MH7  | Color contrast - muted text      | #94A3B8 on dark bg meets minimum contrast              | P1       |
| MH8  | Spacing consistency              | 4/8px grid alignment in card internal spacing          | P2       |
| MH9  | Corner radius consistency        | 8px on cards (rounded-lg), 6px on buttons (rounded-md) | P2       |
| MH10 | Scroll area behavior             | Native-like scroll with ScrollArea component           | P2       |

### 4. Edge Cases (Task #5)

Focus: Boundary conditions in marketplace

| ID   | Test                            | Expected                                                               | Priority |
| ---- | ------------------------------- | ---------------------------------------------------------------------- | -------- |
| ME1  | Very long skill name            | Name like "super-long-skill-name-that-exceeds-container" truncates     | P0       |
| ME2  | Very long repo path             | Path like "organization-name/extremely-long-repository-name" truncates | P0       |
| ME3  | Many search results             | 20+ results scroll without performance degradation                     | P1       |
| ME4  | Zero results                    | "No skills found" empty state renders centered                         | P1       |
| ME5  | Rapid search submissions        | No duplicate requests or UI glitches                                   | P1       |
| ME6  | Minimum panel width (20%)       | Cards still render usably at minimum width                             | P0       |
| ME7  | Install count edge values       | 0, undefined, 999, 1000, 999999, 1000000 all format correctly          | P2       |
| ME8  | Special characters in name      | Unicode, spaces, dashes in skill names render correctly                | P2       |
| ME9  | Simultaneous bookmark + install | Both actions work without conflict                                     | P2       |
| ME10 | Tab switch during search        | Switching away and back preserves search state                         | P2       |

### 5. UX Sensibility (Task #6)

Focus: Marketplace usability and polish

| ID  | Test                           | Expected                                                          | Priority |
| --- | ------------------------------ | ----------------------------------------------------------------- | -------- |
| MU1 | Information hierarchy          | Skill name most prominent, repo path secondary, actions tertiary  | P1       |
| MU2 | Status at a glance             | Installed vs not-installed distinguishable in peripheral vision   | P1       |
| MU3 | Dark mode contrast             | All text readable on dark backgrounds without eye strain          | P1       |
| MU4 | Action clarity                 | Install (cyan) vs Remove (red) buttons clearly communicate intent | P1       |
| MU5 | Feedback on actions            | Loading states for search, disabled buttons during operations     | P1       |
| MU6 | Cognitive load                 | Card layout simple enough to scan quickly                         | P2       |
| MU7 | Consistency with installed tab | Visual language matches installed skills list                     | P2       |

---

## Scoring Rubric

| Component              | Weight | PASS Threshold               |
| ---------------------- | ------ | ---------------------------- |
| Visual Integrity       | 25%    | 95% tests pass               |
| Functional Correctness | 30%    | 95% pass rate, P0=0 failures |
| Apple HIG Compliance   | 15%    | 80/100 score                 |
| Edge Cases             | 15%    | 0 crashes                    |
| UX Sensibility         | 15%    | Pixel Harmony Visual 75/100  |

**Verdict**: >= 85 PASS | 65-84 CONDITIONAL PASS | < 65 FAIL

## Report Locations

| Report                 | File                                   |
| ---------------------- | -------------------------------------- |
| Visual Integrity       | `claudedocs/qa/qa-visual-integrity.md` |
| Functional Correctness | `claudedocs/qa/qa-functional.md`       |
| HIG Compliance         | `claudedocs/qa/qa-hig-compliance.md`   |
| Edge Cases             | `claudedocs/qa/qa-edge-cases.md`       |
| UX Sensibility         | `claudedocs/qa/qa-ux-sensibility.md`   |
| Summary                | `claudedocs/qa/qa-summary.md`          |
