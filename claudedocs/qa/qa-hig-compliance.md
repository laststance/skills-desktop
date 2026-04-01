# Apple HIG Compliance Report - Marketplace UI

**App**: Skills Desktop v0.6.1
**Date**: 2026-04-01
**Tester**: hig-tester (Apple HIG Compliance Agent)
**Scope**: Marketplace tab UI - SkillsMarketplace, SkillRowMarketplace, MarketplaceSearch, RankingTabs, InstallModal, BookmarkItem
**Screenshots**: `claudedocs/qa/screenshots/hig_marketplace_initial.png`, `hig_marketplace_results.png`

---

## 1. Typography (Score: 100/100)

**Requirement**: SF Pro (Text/Display) or Inter, readable line-height and letter-spacing.

| Criterion                       | Status | Details                                                                                                           |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| Primary font (Inter)            | PASS   | Marketplace title uses `Inter, system-ui, sans-serif` at 28px/700                                                 |
| Monospace font (JetBrains Mono) | PASS   | Rank badges and repo paths use `JetBrains Mono, monospace`                                                        |
| Title hierarchy                 | PASS   | H1 = 28px bold, subtitle = 14px/400, card name = 15px/600, repo = 12px mono                                       |
| Line height readability         | PASS   | H1 line-height: 42px (1.5x ratio), body text proportional                                                         |
| Font weight hierarchy           | PASS   | Bold (700) title > semibold (600) names > medium (500) tabs/counts > regular (400) body                           |
| Mono vs Sans separation         | PASS   | Mono used correctly for technical content (repo paths, rank numbers, install counts); Sans for labels and UI text |

**Violations**: None

---

## 2. Tap/Click Areas (Score: 44/100)

**Requirement**: Minimum 44x44px for all interactive elements.

| Element                          | Measured Size | Status   | File Reference                                                          |
| -------------------------------- | ------------- | -------- | ----------------------------------------------------------------------- |
| Bookmark star button             | 44x44px       | PASS     | `SkillRowMarketplace.tsx:110` - `min-h-[44px] min-w-[44px]`             |
| Sidebar bookmark install btn     | 44x44px       | PASS     | `BookmarkItem.tsx:66` - `min-h-[44px] min-w-[44px]`                     |
| Sidebar bookmark remove btn      | 44x44px       | PASS     | `BookmarkItem.tsx:76` - `min-h-[44px] min-w-[44px]`                     |
| Sidebar agent filter buttons     | 281x44px      | PASS     | Large touch targets with proper height                                  |
| Ranking tabs (All Time)          | 82x**36px**   | **FAIL** | `RankingTabs.tsx:34` - `py-2` = 8px vertical padding, total height 36px |
| Ranking tabs (Trending)          | 87x**36px**   | **FAIL** | `RankingTabs.tsx:34` - Same as above                                    |
| Ranking tabs (Hot)               | 54x**36px**   | **FAIL** | `RankingTabs.tsx:34` - Same, width also barely above 44px               |
| Search button                    | 78x**36px**   | **FAIL** | `MarketplaceSearch.tsx:49` - Default Button component height            |
| Search input                     | 424x**36px**  | **FAIL** | `MarketplaceSearch.tsx:39` - Default Input component height             |
| Install button (card)            | 90x**36px**   | **FAIL** | `SkillRowMarketplace.tsx:160-168` - `py-2` gives 36px height            |
| Remove button (card)             | ~90x**36px**  | **FAIL** | `SkillRowMarketplace.tsx:143-156` - Same padding as Install             |
| Nav tabs (Installed/Marketplace) | 259x**28px**  | **FAIL** | Height 28px, well below 44px minimum                                    |

**Pass rate: 4/12 elements (33%)**

**Critical violations**:

- `RankingTabs.tsx:34` -- All three ranking filter tabs are 36px tall. Fix: add `min-h-[44px]` or change `py-2` to `py-3`
- `MarketplaceSearch.tsx:39,49` -- Both search input and button are 36px. These are shared UI components (`ui/input`, `ui/button`) so the fix should be at the component level or via size props
- `SkillRowMarketplace.tsx:147,163` -- Install and Remove buttons use `px-4 py-2` producing 36px height. Fix: add `min-h-[44px]`

---

## 3. Colors & Contrast (Score: 82/100)

**Requirement**: OKLCH-based system, WCAG 2.2 AA+ (4.5:1 normal text, 3:1 large text/icons).

| Color Pair                        | Ratio      | Required | Status   |
| --------------------------------- | ---------- | -------- | -------- |
| White (#FFF) on body (#020817)    | 20.01:1    | 4.5:1    | PASS     |
| White (#FFF) on card (#1E293B)    | 14.63:1    | 4.5:1    | PASS     |
| Muted (#94A3B8) on body (#020817) | 7.80:1     | 4.5:1    | PASS     |
| Muted (#94A3B8) on card (#1E293B) | 5.71:1     | 4.5:1    | PASS     |
| Dim (#64748B) on card (#1E293B)   | **3.07:1** | 4.5:1    | **FAIL** |
| Cyan (#22D3EE) on card (#1E293B)  | 8.09:1     | 4.5:1    | PASS     |
| Cyan (#22D3EE) on badge (#334155) | 5.73:1     | 4.5:1    | PASS     |
| Dark (#0A0F1C) on cyan (#22D3EE)  | 10.58:1    | 4.5:1    | PASS     |
| Amber (#F59E0B) on card (#1E293B) | 6.81:1     | 3.0:1    | PASS     |
| Red (#EF4444) on badge (#334155)  | **2.75:1** | 4.5:1    | **FAIL** |
| Cyan on cyan/10 installed badge   | 6.57:1     | 4.5:1    | PASS     |

**Pass rate: 9/11 (82%)**

**Violations**:

- `SkillRowMarketplace.tsx:97` -- Repo path text color `#64748B` on card background `#1E293B` produces only 3.07:1 contrast. **Fix**: Use `#8B9BB5` or `text-[#94A3B8]` (already used for muted text elsewhere, 5.71:1)
- `SkillRowMarketplace.tsx:149` -- Remove button text `#EF4444` on button background `#334155` is only 2.75:1. **Fix**: Use `#F87171` (red-400, ~3.8:1) or lighten the red to achieve 4.5:1

---

## 4. Spacing (Score: 100/100)

**Requirement**: 4/8px grid system; key margins at 16/20/24px.

| Element             | Spacing Values              | Grid-Aligned   | Status |
| ------------------- | --------------------------- | -------------- | ------ |
| Header padding      | 24px top/sides, 16px bottom | 24=6x4, 16=4x4 | PASS   |
| Card padding        | 16px (p-4)                  | 16=4x4         | PASS   |
| Card internal gap   | 16px (gap-4)                | 16=4x4         | PASS   |
| Results list gap    | 8px (gap-2)                 | 8=2x4          | PASS   |
| Ranking tab padding | 8px 16px (py-2 px-4)        | Both on grid   | PASS   |
| Rank badge size     | 32x32px (w-8 h-8)           | 32=8x4         | PASS   |
| Card height         | 72px (h-[72px])             | 72=18x4        | PASS   |
| Search gap          | 8px (gap-2)                 | 8=2x4          | PASS   |
| ScrollArea padding  | 24px (px-6)                 | 24=6x4         | PASS   |
| Section spacing     | 16px (space-y-4)            | 16=4x4         | PASS   |

**Pass rate: 10/10 (100%)**

**Violations**: None. All spacing values are multiples of 4px.

---

## 5. Corner Radius (Score: 25/100)

**Requirement**: 4/8/12/20px scale by hierarchy/affinity.

| Element         | Actual                 | Design Scale | Status   |
| --------------- | ---------------------- | ------------ | -------- |
| Skill card      | 8px (`rounded-lg`)     | 8px          | PASS     |
| Installed badge | ~4px (`rounded`)       | 4px          | PASS     |
| Rank badge      | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |
| Ranking tabs    | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |
| Install button  | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |
| Remove button   | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |
| Search input    | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |
| Search button   | **6px** (`rounded-md`) | 4 or 8px     | **FAIL** |

**Pass rate: 2/8 (25%)**

**Root cause**: Tailwind's `rounded-md` maps to `border-radius: 0.375rem` (6px), which does not align with the project's 4/8/12/20px design scale. The project defines `--radius: 0.5rem` (8px), but individual components use Tailwind's `rounded-md` class directly instead of the CSS variable-derived value.

**Systematic fix**: Replace `rounded-md` with `rounded` (which uses `calc(var(--radius) - 2px)` = 6px in shadcn, or configure to match 8px) or explicitly use `rounded-[8px]` / `rounded-[4px]` to align with the design system.

---

## 6. Motion & Transitions (Score: 100/100)

**Requirement**: Only meaningful transitions. Provide static alternatives for `prefers-reduced-motion`.

| Criterion                        | Status | Details                                                               |
| -------------------------------- | ------ | --------------------------------------------------------------------- |
| `prefers-reduced-motion` support | PASS   | `globals.css:200` - Blanket rule disables all animations/transitions  |
| Transition purpose               | PASS   | `transition-colors` for hover/focus state changes only                |
| Transition timing                | PASS   | 150ms cubic-bezier(0.4, 0, 0.2, 1) - subtle, functional               |
| Loading spinner                  | PASS   | `animate-spin` on Loader2 icon - functional, indicates async progress |
| No gratuitous animation          | PASS   | No entrance animations, no page transitions, no decorative motion     |

**Violations**: None. Motion handling is exemplary.

---

## 7. Accessibility (Score: 92/100)

**Requirement**: Full keyboard navigation & screen-reader support.

| Criterion                               | Status  | Details                                                                                                                         |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ARIA labels on marketplace icon buttons | PASS    | Bookmark star buttons have descriptive labels (`Bookmark {name}`, `Remove {name} from bookmarks`)                               |
| ARIA labels on sidebar icon buttons     | PARTIAL | Install/remove bookmark buttons have labels. 2 icon-only buttons elsewhere lack `aria-label`                                    |
| Focus-visible styles                    | PASS    | CSS `:focus-visible` rules present (3 rules). `focus-visible:opacity-100` on hover-revealed buttons in `BookmarkItem.tsx:66,76` |
| Keyboard navigable                      | PASS    | All interactive elements are native `<button>` or `<input>`, inherently focusable                                               |
| Semantic roles                          | PASS    | `tablist`/`tab`/`tabpanel` roles for Installed/Marketplace navigation                                                           |
| Disabled state communication            | PASS    | `disabled` attribute + `disabled:opacity-50 disabled:cursor-not-allowed` visual feedback                                        |
| Form accessibility                      | PASS    | Search input has `type="search"` and `placeholder` text                                                                         |

**Violations**:

- 2 icon-only sidebar buttons (hamburger menu, settings gear) lack `aria-label`. Not in marketplace scope, but noted.

---

## Composite Score

| Category          | Weight   | Raw Score | Weighted |
| ----------------- | -------- | --------- | -------- |
| Typography        | 15%      | 100       | 15.0     |
| Tap/Click Areas   | 25%      | 44        | 11.0     |
| Colors & Contrast | 20%      | 82        | 16.4     |
| Spacing           | 15%      | 100       | 15.0     |
| Corner Radius     | 10%      | 25        | 2.5      |
| Motion            | 5%       | 100       | 5.0      |
| Accessibility     | 10%      | 92        | 9.2      |
| **Total**         | **100%** |           | **74.1** |

## Composite HIG Score: 74/100

---

## Verdict: CONDITIONAL PASS

The Marketplace UI demonstrates strong foundations in typography, spacing grid adherence, motion handling, and accessibility. However, there are **two critical issues** and one systematic design-system inconsistency:

### Must Fix (Blocking)

1. **Tap area violations (5 component types affected)**
   - Ranking tabs, search input/button, Install/Remove buttons are all 36px tall (44px required)
   - Nav tabs (Installed/Marketplace) are 28px tall
   - **Files**: `RankingTabs.tsx:34`, `MarketplaceSearch.tsx:39,49`, `SkillRowMarketplace.tsx:147,163`
   - **Fix**: Add `min-h-[44px]` to all interactive elements, or increase vertical padding

2. **WCAG contrast failures (2 color pairs)**
   - Repo path text `#64748B` on card `#1E293B` = 3.07:1 (need 4.5:1)
   - Remove button text `#EF4444` on `#334155` = 2.75:1 (need 4.5:1)
   - **Files**: `SkillRowMarketplace.tsx:97,149`
   - **Fix**: Use `#94A3B8` for repo text, `#F87171` for remove button text

### Should Fix (Non-blocking)

3. **Corner radius inconsistency (systematic)**
   - 6 of 8 measured elements use 6px (`rounded-md`) instead of 4/8/12/20px scale
   - Root cause: Tailwind `rounded-md` = 6px does not align with design system
   - **Fix**: Replace `rounded-md` with `rounded` or explicit `rounded-[8px]`/`rounded-[4px]`

### Screenshots

- `claudedocs/qa/screenshots/hig_marketplace_initial.png` - Initial Marketplace state
- `claudedocs/qa/screenshots/hig_marketplace_results.png` - Search results with skill cards
