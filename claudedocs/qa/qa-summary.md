# QA Summary Report - Marketplace CSS Issues

**Date:** 2026-04-01
**App Version:** v0.6.1
**Platform:** Electron desktop app (macOS, ARM64)
**Scope:** Marketplace tab UI (feature flag `ENABLE_MARKETPLACE_UI: true`)
**QA Lead:** qa-lead

---

## Executive Summary

The Marketplace tab had a **critical P0 clipping bug** where Install/Remove buttons, download counts, and Installed badges were completely hidden -- rendering the marketplace non-functional. This bug has been **fixed** by replacing `ScrollArea` with `overflow-y-auto` and adding `min-w-0` constraints. Additional CSS fixes addressed WCAG contrast failures, HIG tap area violations, and missing focus-visible indicators.

**Pre-fix verdict: CONDITIONAL PASS (74.6/100)**
**Post-fix verdict: PASS (92.0/100)**

---

## Report Summaries

### 1. Visual Integrity (Task #2)

| Metric  | Pre-Fix | Post-Fix |
| ------- | ------- | -------- |
| Score   | 35/100  | 92/100   |
| Verdict | FAIL    | PASS     |

**Pre-fix findings:**

- P0: Card content clipped 261px past ScrollArea viewport boundary. Install/Remove buttons, download counts, and Installed badges completely hidden
- Root cause: Radix ScrollArea inserts `display: table; min-width: 100%` wrapper that sizes to content, not container. Card flex layout (771px natural width) exceeded viewport (510px visible)
- P2: Download counts all show em-dash (API/data issue, not rendering)
- P2: Inconsistent card width between installed vs non-installed rows

**Post-fix changes applied:**

- ScrollArea replaced with `overflow-y-auto` div (eliminates Radix table wrapper)
- `min-w-0` added to card root and inner wrapper
- `shrink-0` added to rank badge and install count to prevent flex shrinkage

**Post-fix assessment:** Card clipping resolved. All right-side elements (bookmark, download count, Install/Remove buttons) now visible within viewport.

---

### 2. Functional Correctness (Task #3)

| Metric            | Score        |
| ----------------- | ------------ |
| Core app tests    | 27/27 PASS   |
| Marketplace tests | 8/8 PASS     |
| Total             | 35/35 (100%) |
| Verdict           | PASS         |

**Key findings:**

- Tab switching, search, bookmark toggle, filter tabs, Install modal, Remove dialog all functional
- Install/Remove buttons fully visible, clickable, triggering correct Redux actions
- Original clipping bug not reproduced (tested after fix was applied)
- Search state preservation across tab switches works correctly

---

### 3. Apple HIG Compliance (Task #4)

| Metric  | Pre-Fix          | Post-Fix         |
| ------- | ---------------- | ---------------- |
| Score   | 74/100           | ~82/100          |
| Verdict | CONDITIONAL PASS | CONDITIONAL PASS |

**Category breakdown:**

| Category          | Weight | Pre-Fix | Post-Fix | Notes                                                         |
| ----------------- | ------ | ------- | -------- | ------------------------------------------------------------- |
| Typography        | 15%    | 100     | 100      | Excellent                                                     |
| Tap/Click Areas   | 25%    | 44      | ~75      | Fixed: `min-h-[44px]` on Install, Remove, Bookmark            |
| Colors & Contrast | 20%    | 82      | ~91      | Fixed: repo `#64748B`->`#94A3B8`, remove `#EF4444`->`#F87171` |
| Spacing           | 15%    | 100     | 100      | Perfect 4px grid alignment                                    |
| Corner Radius     | 10%    | 25      | 25       | Unfixed: `rounded-md` (6px) not on 4/8/12/20 scale            |
| Motion            | 5%     | 100     | 100      | Exemplary `prefers-reduced-motion` support                    |
| Accessibility     | 10%    | 92      | ~95      | Fixed: `focus-visible:ring-1` on marketplace buttons          |

**Remaining issues:**

- RankingTabs, Search input/button, Nav tabs still below 44px height
- Corner radius systematic mismatch (6px via `rounded-md` vs design scale)

---

### 4. Edge Cases (Task #5)

| Metric                 | Score      |
| ---------------------- | ---------- |
| Core edge cases        | 15/15 PASS |
| Marketplace edge cases | 8/8 PASS   |
| Total                  | 23/23      |
| Crashes                | 0          |
| Verdict                | PASS       |

**Key findings:**

- Long skill names and repo paths truncate correctly via `truncate` class
- Whitespace-only search prevented by `trim()` guard
- XSS attempts safely escaped by React JSX
- Rapid tab switching causes no state corruption
- Multiple bookmarks render correctly in sidebar
- Scroll bottom items fully accessible (not clipped)

---

### 5. UX Sensibility (Task #6)

| Metric  | Pre-Fix           | Post-Fix |
| ------- | ----------------- | -------- |
| Score   | 65/100            | ~78/100  |
| Verdict | Needs improvement | Adequate |

**PH Visual Axis breakdown:**

| Axis                      | Pre-Fix | Post-Fix | Notes                                             |
| ------------------------- | ------- | -------- | ------------------------------------------------- |
| V1: Dark Mode Readability | 14/20   | 17/20    | Fixed: contrast on repo path and remove button    |
| V2: Visual Consistency    | 11/20   | 11/20    | Unfixed: hardcoded colors, radius/font mismatches |
| V3: Feedback & Affordance | 10/20   | 16/20    | Fixed: focus-visible rings on 4 button types      |
| V4: Information Hierarchy | 16/20   | 17/20    | Improved: repo path now readable                  |
| V5: Interaction Patterns  | 14/20   | 14/20    | Unfixed: no search clear button, layout shift     |

**Remaining P1 issue:**

- CC-1: Hardcoded hex colors bypass theme system (breaks light mode, hue theming)

---

## All Issues - Final Status

### Resolved

| ID        | Severity | Issue                                          | Fix Applied                                          |
| --------- | -------- | ---------------------------------------------- | ---------------------------------------------------- |
| Visual P0 | P0       | Card clipping -- Install/Remove buttons hidden | ScrollArea -> overflow-y-auto + min-w-0              |
| V1-1      | P1       | Repo path WCAG AA failure (3.07:1)             | `#64748B` -> `#94A3B8` (5.71:1)                      |
| V1-2      | P1       | Remove button WCAG AA failure (2.75:1)         | `#EF4444` -> `#F87171` (~3.8:1)                      |
| V3-1      | P1       | Install/Remove/Bookmark missing focus-visible  | Added `focus-visible:ring-1 focus-visible:ring-ring` |
| HIG Tap   | P1       | Install/Remove/Bookmark below 44px             | Added `min-h-[44px]`                                 |

### Open (Non-blocking)

| ID        | Severity | Issue                                  | Recommendation                         |
| --------- | -------- | -------------------------------------- | -------------------------------------- |
| CC-1      | P1       | Hardcoded colors bypass theme system   | Replace hex with CSS custom properties |
| V3-2      | P1       | RankingTabs missing focus-visible      | Add focus ring classes                 |
| HIG Tap-2 | P2       | RankingTabs/Search/Nav tabs below 44px | Add `min-h-[44px]`                     |
| V2-2      | P2       | Border radius mismatch (8px vs 12px)   | Align to Card component (12px)         |
| V5-1      | P2       | No clear button on search input        | Add explicit X button                  |
| Corner    | P2       | `rounded-md` (6px) not on design scale | Use `rounded` or `rounded-[8px]`       |
| V1-3      | P2       | Download icon contrast (3.07:1)        | Use `#94A3B8`                          |
| V2-3      | P3       | Background color mismatch between tabs | Use `--card` token                     |
| V2-4      | P3       | Font size/weight differences           | Align to 16px/500                      |
| V5-2      | P3       | Tab switching causes layout shift      | Harmonize card heights                 |

---

## Composite Score

### Pre-Fix Score

| Component              | Weight   | Score | Weighted  |
| ---------------------- | -------- | ----- | --------- |
| Visual Integrity       | 25%      | 35    | 8.75      |
| Functional Correctness | 30%      | 100   | 30.00     |
| HIG Compliance         | 15%      | 74    | 11.10     |
| Edge Cases             | 15%      | 100   | 15.00     |
| UX Sensibility         | 15%      | 65    | 9.75      |
| **Total**              | **100%** |       | **74.60** |

**Pre-Fix Verdict: CONDITIONAL PASS (74.6/100)**

### Post-Fix Score

| Component              | Weight   | Score | Weighted  |
| ---------------------- | -------- | ----- | --------- |
| Visual Integrity       | 25%      | 92    | 23.00     |
| Functional Correctness | 30%      | 100   | 30.00     |
| HIG Compliance         | 15%      | 82    | 12.30     |
| Edge Cases             | 15%      | 100   | 15.00     |
| UX Sensibility         | 15%      | 78    | 11.70     |
| **Total**              | **100%** |       | **92.00** |

**Post-Fix Verdict: PASS (92.0/100)**

---

## Final Verdict: PASS (with recommendations)

The critical P0 card clipping bug has been resolved. All marketplace functionality works correctly (35/35 tests pass). WCAG contrast, HIG tap areas, and keyboard focus indicators have been improved.

**Before release, strongly recommend:**

1. Replace hardcoded hex colors with CSS custom properties for theme compatibility
2. Add `focus-visible` ring to RankingTabs buttons
3. Increase RankingTabs/Search height to 44px minimum

**Post-release backlog:** 4. Align border radius to design system scale 5. Add search input clear button 6. Harmonize card styles between Installed and Marketplace tabs

---

## Individual Reports

| Report                 | Location                               |
| ---------------------- | -------------------------------------- |
| Test Plan              | `claudedocs/qa/qa-test-plan.md`        |
| Visual Integrity       | `claudedocs/qa/qa-visual-integrity.md` |
| Functional Correctness | `claudedocs/qa/qa-functional.md`       |
| HIG Compliance         | `claudedocs/qa/qa-hig-compliance.md`   |
| Edge Cases             | `claudedocs/qa/qa-edge-cases.md`       |
| UX Sensibility         | `claudedocs/qa/qa-ux-sensibility.md`   |
