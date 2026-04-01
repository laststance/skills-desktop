# QA Report: UX Sensibility Check -- Marketplace Tab

**Tester:** ux-tester (agent)
**Date:** 2026-04-01
**App Version:** v0.6.1
**Scope:** Dark mode contrast, feedback/affordance, visual consistency, information hierarchy, interaction patterns
**Focus:** Marketplace tab (newly enabled) and its consistency with the Installed tab
**Screenshots:** `claudedocs/qa/screenshots/ux_*.png`

---

## Summary

| Category                   | Score      | Grade                                    |
| -------------------------- | ---------- | ---------------------------------------- |
| V1 - Dark Mode Readability | 14/20      | Adequate with notable gaps               |
| V2 - Visual Consistency    | 11/20      | Several inconsistencies                  |
| V3 - Feedback & Affordance | 10/20      | Missing focus indicators on key controls |
| V4 - Information Hierarchy | 16/20      | Generally good                           |
| V5 - Interaction Patterns  | 14/20      | Functional but gaps in polish            |
| **Total**                  | **65/100** | **Needs improvement**                    |

---

## V1 - Dark Mode Readability (14/20)

### Contrast Ratio Analysis (WCAG 2.2 AA requires 4.5:1 for normal text, 3.0:1 for large text)

| Element                       | Colors                 | Ratio      | AA Normal | AA Large |
| ----------------------------- | ---------------------- | ---------- | --------- | -------- |
| Skill name (white) on card bg | `#FFF` on `#1E293B`    | 14.63:1    | PASS      | PASS     |
| Repo path on card bg          | `#64748B` on `#1E293B` | **3.07:1** | **FAIL**  | PASS     |
| Install count on card bg      | `#94A3B8` on `#1E293B` | 5.71:1     | PASS      | PASS     |
| Download icon on card bg      | `#64748B` on `#1E293B` | **3.07:1** | **FAIL**  | PASS     |
| Remove btn text on btn bg     | `#EF4444` on `#334155` | **2.75:1** | **FAIL**  | **FAIL** |
| Install btn text on btn bg    | `#0A0F1C` on `#22D3EE` | 10.58:1    | PASS      | PASS     |
| Installed badge on card bg    | `#22D3EE` on `#1E293B` | 8.09:1     | PASS      | PASS     |
| Rank number on rank bg        | `#22D3EE` on `#334155` | 5.73:1     | PASS      | PASS     |
| Subtitle on page bg           | `#94A3B8` on page bg   | 7.36:1     | PASS      | PASS     |

### Issues

| ID   | Severity | Description                                                                                                                                                                                         |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1-1 | P1       | **Repo path text (`#64748B` on `#1E293B`) fails WCAG AA** at 3.07:1. Needs `#94A3B8` or lighter for 4.5:1. This is the secondary info line on every marketplace card -- high frequency.             |
| V1-2 | P1       | **Remove button text (`#EF4444` on `#334155`) fails both AA and AA-large** at 2.75:1. This is an action button -- critical for usability. Needs lighter red (e.g., `#F87171`) or lighter button bg. |
| V1-3 | P2       | **Download icon (`#64748B`)** same contrast failure as repo path. Decorative, but carries meaning when paired with count.                                                                           |

**Screenshot:** `ux_marketplace_results.png`, `ux_marketplace_full.png`

---

## V2 - Visual Consistency (11/20)

### Installed vs. Marketplace Card Comparison

| Property         | Installed Tab                              | Marketplace Tab                                  | Consistent?                                |
| ---------------- | ------------------------------------------ | ------------------------------------------------ | ------------------------------------------ |
| Background       | `rgb(2,8,23)` (CSS var `--card`)           | `#1E293B` (hardcoded)                            | NO -- different bg colors                  |
| Border radius    | 12px (`rounded-xl` from Card)              | 8px (`rounded-lg`)                               | NO -- 4px difference                       |
| Border color     | `rgb(30,41,59)` (CSS var `--border`)       | `#1E293B` (same as bg, invisible)                | NO -- installed has visible border         |
| Name font size   | 16px                                       | 15px                                             | NO -- 1px difference                       |
| Name font weight | 500 (medium)                               | 600 (semibold)                                   | NO -- different weight                     |
| Name color       | `rgb(248,250,252)` (CSS var)               | `rgb(255,255,255)` (hardcoded white)             | Minor -- nearly identical visually         |
| Secondary text   | Uses `text-muted-foreground` (theme token) | Uses hardcoded `#64748B`, `#94A3B8`              | NO -- doesn't use theme tokens             |
| Card height      | Auto (content-driven)                      | Fixed 72px                                       | Acceptable difference (different use case) |
| Layout           | Vertical (name, description, badges)       | Horizontal (rank, info, bookmark, count, action) | Acceptable (different information density) |

### Issues

| ID   | Severity | Description                                                                                                                                                                                                                                                                                                                                     |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2-1 | P2       | **Marketplace cards use hardcoded colors instead of CSS theme tokens.** Installed tab uses `--card`, `--border`, `--card-foreground`, `text-muted-foreground`. Marketplace cards hardcode `#1E293B`, `#64748B`, `#94A3B8`, `#22D3EE`. This means marketplace cards will NOT respond to theme changes (hue slider, light/dark toggle) correctly. |
| V2-2 | P2       | **Border radius mismatch**: Installed cards use 12px (Card component default), marketplace cards use 8px (`rounded-lg`). Visually jarring when switching tabs.                                                                                                                                                                                  |
| V2-3 | P3       | **Background color mismatch**: Installed cards sit on `--card` bg (very dark), marketplace cards use `#1E293B` (lighter slate). Different visual weight between tabs.                                                                                                                                                                           |
| V2-4 | P3       | **Font size/weight differences**: Name is 16px/500 in Installed vs 15px/600 in Marketplace. Subtle but inconsistent typographic scale.                                                                                                                                                                                                          |

**Screenshots:** `ux_installed_tab_view.png` vs `ux_marketplace_results.png`

---

## V3 - Feedback & Affordance (10/20)

### Focus Indicator Audit

| Element                                 | `focus-visible` | `ring` / `outline`    | Verdict  |
| --------------------------------------- | --------------- | --------------------- | -------- |
| Search button                           | YES             | YES                   | PASS     |
| Installed tab button                    | YES             | YES                   | PASS     |
| Marketplace tab button                  | YES             | YES                   | PASS     |
| **Install button**                      | **NO**          | **NO**                | **FAIL** |
| **Remove button**                       | **NO**          | **NO**                | **FAIL** |
| **Bookmark star button**                | **NO**          | **NO**                | **FAIL** |
| **RankingTabs (All Time/Trending/Hot)** | **NO**          | **NO**                | **FAIL** |
| Sidebar bookmark Install button         | YES             | YES (via group-hover) | PASS     |
| Sidebar bookmark Remove button          | YES             | YES (via group-hover) | PASS     |

### Hover States

| Element                  | Has hover transition?           | Visible change?                       |
| ------------------------ | ------------------------------- | ------------------------------------- |
| Marketplace card row     | YES (`hover:border-primary/50`) | Subtle border change -- adequate      |
| Install button           | YES (`hover:bg-[#06B6D4]`)      | Slight bg darkening -- visible        |
| Remove button            | YES (`hover:bg-[#3E4A5E]`)      | Slight bg lightening -- subtle        |
| Bookmark star            | YES (CSS `:hover` on icon only) | Color shift to amber -- good          |
| RankingTabs              | YES (`hover:text-[#CBD5E1]`)    | Text brightens -- adequate            |
| Sidebar bookmark buttons | YES (opacity transition)        | Appear on group hover -- good pattern |

### Loading States

| State               | Implementation                                    | Quality                                                       |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Search loading      | "Searching..." text + Loader2 spinner on button   | Adequate but text-only in results area -- no skeleton/shimmer |
| Install in progress | `disabled:opacity-50 disabled:cursor-not-allowed` | Functional but no progress indicator                          |

### Issues

| ID   | Severity | Description                                                                                                                                                                     |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V3-1 | P1       | **Install, Remove, and Bookmark buttons have NO `focus-visible` ring/outline.** Keyboard-only users cannot see which button is focused. This is an a11y violation (WCAG 2.4.7). |
| V3-2 | P1       | **RankingTabs (All Time / Trending / Hot) have NO `focus-visible` indicator.** Custom buttons without any focus styling.                                                        |
| V3-3 | P3       | **Loading state uses plain text "Searching..."** instead of skeleton cards or shimmer. Adequate but feels unpolished compared to the rest of the UI.                            |
| V3-4 | P3       | **Remove button hover state is very subtle** -- `#334155` to `#3E4A5E` is only a slight change on a destructive action. Could benefit from stronger visual signal.              |

**Screenshot:** `ux_sidebar_bookmarks.png` (shows loading state)

---

## V4 - Information Hierarchy (16/20)

### Marketplace Card Hierarchy

| Level         | Element               | Font               | Color                  | Prominence                         |
| ------------- | --------------------- | ------------------ | ---------------------- | ---------------------------------- |
| 1 (Primary)   | Skill name            | 15px semibold      | White                  | Highest -- good                    |
| 2 (Secondary) | Repo path             | 12px mono          | `#64748B`              | Low contrast -- too dim (see V1-1) |
| 3 (Metadata)  | Install count         | 13px mono          | `#94A3B8`              | Clear with download icon           |
| 4 (Rank)      | Rank badge            | 14px mono semibold | `#22D3EE` on `#334155` | Distinctive -- good                |
| 5 (Action)    | Install/Remove button | 13px semibold      | High contrast          | Discoverable                       |

### Issues

| ID   | Severity | Description                                                                                                                                                                                               |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V4-1 | P2       | **Repo path is too dim** to function as useful secondary info. At 3.07:1 contrast, users may struggle to read it. The hierarchy is correct (name > repo) but the secondary level undershoots readability. |
| V4-2 | P3       | **Marketplace page title "Skills Marketplace" at 28px** is significantly larger than the Installed tab which has no page title. This creates asymmetric visual weight between tabs.                       |
| V4-3 | P3       | **Install count and bookmark star compete** for the same visual level. Consider whether both need equal prominence.                                                                                       |

---

## V5 - Interaction Patterns (14/20)

### Bookmark Toggle

| Aspect                          | Assessment                                                                |
| ------------------------------- | ------------------------------------------------------------------------- |
| Visual change on toggle         | Star fills with amber (`#F59E0B`) -- clear and satisfying                 |
| Bookmark appears in sidebar     | Yes, with name and repo -- good progressive disclosure                    |
| Sidebar bookmark install action | Hidden until hover (opacity-0 group-hover) -- follows established pattern |
| Removing bookmark               | Star outlines back to `#64748B` -- clear reversal                         |

### Search Flow

| Aspect                 | Assessment                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| Input placeholder      | Helpful examples ("react, vercel, nextjs")                                 |
| Enter to search        | Supported via `handleKeyDown`                                              |
| Empty query protection | Button disabled when empty -- good                                         |
| Results display        | Shows count "Found N skills for ..." -- clear                              |
| Clear/reset            | No clear button on search input; user must manually select and delete text |

### Tab Switching

| Aspect             | Assessment                                                                 |
| ------------------ | -------------------------------------------------------------------------- |
| Visual transition  | Tab indicator updates immediately                                          |
| State preservation | Search query and results preserved when switching back                     |
| Content shift      | Different layout styles between tabs (see V2) -- noticeable but functional |

### Issues

| ID   | Severity | Description                                                                                                                                                                                                             |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V5-1 | P2       | **No clear/reset button on search input.** Type="search" provides a native clear button in some browsers, but Electron's Chromium rendering may not show it consistently. An explicit X button would improve flow.      |
| V5-2 | P3       | **Tab switching causes layout shift** due to different card styles (72px fixed height marketplace rows vs auto-height installed cards). Not jarring but noticeable.                                                     |
| V5-3 | P3       | **Bookmark star click target size is correct (44x44px)** but the icon itself is small (16x16px / `h-4 w-4`). The generous click target is good for touch, but visually the star looks small relative to other controls. |

---

## Cross-Cutting Issues

| ID   | Severity | Description                                                                                                                                                                                                                                                                                                                                             |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-1 | P1       | **Hardcoded colors bypass theme system.** Marketplace cards use `#1E293B`, `#334155`, `#22D3EE`, `#64748B`, `#94A3B8` etc. instead of CSS custom properties (`--card`, `--border`, `--primary`, `--muted-foreground`). This breaks: (1) light mode, (2) OKLCH hue-based theming, (3) high-contrast mode. The Installed tab correctly uses theme tokens. |
| CC-2 | P1       | **4 buttons in marketplace lack focus-visible indicators** (Install, Remove, Bookmark, RankingTabs). WCAG 2.4.7 failure.                                                                                                                                                                                                                                |
| CC-3 | P1       | **2 color pairs fail WCAG AA contrast** (repo path, remove button).                                                                                                                                                                                                                                                                                     |

---

## All Issues Summary

| ID   | Severity | Category     | Description                                                |
| ---- | -------- | ------------ | ---------------------------------------------------------- |
| V1-1 | P1       | Contrast     | Repo path text fails WCAG AA (3.07:1)                      |
| V1-2 | P1       | Contrast     | Remove button text fails WCAG AA and AA-large (2.75:1)     |
| V1-3 | P2       | Contrast     | Download icon fails WCAG AA (3.07:1)                       |
| V2-1 | P2       | Consistency  | Hardcoded hex colors instead of theme tokens               |
| V2-2 | P2       | Consistency  | Border radius mismatch (8px vs 12px)                       |
| V2-3 | P3       | Consistency  | Background color mismatch between tabs                     |
| V2-4 | P3       | Consistency  | Font size/weight differences between tabs                  |
| V3-1 | P1       | A11y         | Install/Remove/Bookmark buttons missing focus-visible      |
| V3-2 | P1       | A11y         | RankingTabs missing focus-visible                          |
| V3-3 | P3       | Polish       | Search loading state is text-only (no skeleton)            |
| V3-4 | P3       | Polish       | Remove button hover state too subtle                       |
| V4-1 | P2       | Hierarchy    | Repo path too dim to serve as secondary info               |
| V4-2 | P3       | Hierarchy    | Asymmetric title weight between tabs                       |
| V4-3 | P3       | Hierarchy    | Install count and bookmark star compete visually           |
| V5-1 | P2       | Interaction  | No clear/reset button on search input                      |
| V5-2 | P3       | Interaction  | Tab switching causes layout shift                          |
| V5-3 | P3       | Interaction  | Bookmark star icon visually small despite correct tap area |
| CC-1 | P1       | Architecture | Hardcoded colors bypass entire theme system                |
| CC-2 | P1       | A11y         | 4 button types missing focus-visible indicators            |
| CC-3 | P1       | Contrast     | 2 color pairs fail WCAG AA minimums                        |

**P1 count: 6** | **P2 count: 5** | **P3 count: 8**

---

## Screenshots Reference

| File                                | Description                                                |
| ----------------------------------- | ---------------------------------------------------------- |
| `ux_installed_tab.png`              | Initial app state with Marketplace tab showing             |
| `ux_installed_tab_view.png`         | Installed tab card layout for comparison                   |
| `ux_marketplace_full.png`           | Marketplace tab with "No results" state                    |
| `ux_marketplace_results.png`        | Marketplace with search results loaded                     |
| `ux_sidebar_bookmarks.png`          | Sidebar scrolled to show Bookmarks section + loading state |
| `ux_marketplace_with_bookmarks.png` | Marketplace with bookmarks and loading state               |
| `ux_results_loaded.png`             | Marketplace with results and bookmarks visible             |

---

## Verdict

**65/100 -- Needs improvement before release.**

The Marketplace tab is functional but has three P1 categories of issues:

1. **Contrast failures** -- Remove button text and repo path are below WCAG AA minimums
2. **Missing focus indicators** -- Install, Remove, Bookmark, and RankingTabs buttons have no `focus-visible` ring, making keyboard navigation impossible to track
3. **Hardcoded colors** -- The marketplace uses raw hex colors instead of the app's OKLCH theme token system, which will break in light mode and with hue customization

The Installed tab serves as a good reference for how things should work -- it uses theme tokens, has proper `focus-visible` rings on interactive elements, and meets contrast requirements.

### Recommended Fixes (Priority Order)

1. **Add `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to all marketplace buttons** (Install, Remove, Bookmark, RankingTabs)
2. **Increase repo path color** from `#64748B` to at least `#94A3B8` (already used for install count)
3. **Increase Remove button contrast** -- use `#F87171` text or lighten the button background
4. **Replace hardcoded hex colors with CSS custom properties** to match the theme system used by the Installed tab
5. **Align border-radius** to 12px (matching Card component) for visual consistency
