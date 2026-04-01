# QA Report: Visual Integrity - Marketplace Card Layout

**Date:** 2026-04-01
**App Version:** v0.6.1
**Tester:** Visual Integrity Tester
**Platform:** macOS (Electron, debug port 9222)
**Window Size:** 1200x800

---

## Executive Summary

The Marketplace tab has a **critical P0 clipping bug**: card content (download count, Installed badge, Install/Remove buttons) is rendered outside the visible ScrollArea viewport and is completely hidden. Users cannot install or remove skills from the marketplace.

**Verdict: FAIL**

---

## Issues Found

### ISSUE 1 (P0): Card content clipped on right side -- Install/Remove buttons completely hidden

**Description:** The right portion of every marketplace card is clipped and invisible. The Install button, Remove button, Installed badge, and download count are all rendered outside the visible ScrollArea viewport and cannot be seen or interacted with.

**Affected Components:**

- `src/renderer/src/components/marketplace/SkillRowMarketplace.tsx` -- card root div (line 72-79)
- `src/renderer/src/components/marketplace/SkillsMarketplace.tsx` -- ScrollArea wrapper (line 68)
- `src/renderer/src/components/ui/scroll-area.tsx` -- Radix ScrollArea viewport (line 18)

**Measurements (all cards, viewport boundary at x=774):**

| Element                  | Position (left-right px) | Status                            |
| ------------------------ | ------------------------ | --------------------------------- |
| Rank badge               | 281-313                  | VISIBLE                           |
| Skill info (name + repo) | 329-705                  | VISIBLE                           |
| Bookmark star            | 721-765                  | VISIBLE (barely)                  |
| Download count           | 781-809                  | **CLIPPED** (7px past boundary)   |
| Installed badge          | 825-902                  | **CLIPPED** (51px past boundary)  |
| Install/Remove button    | 914-1018                 | **CLIPPED** (140px past boundary) |

- Card actual rendered width: **771px**
- ScrollArea viewport visible width: **510px**
- Content overshoot: **261px** clipped on the right

**Root Cause (full chain):**

```
Level 0: Card DIV ........... width=771, display=flex, minW=auto, maxW=none
Level 1: Results list ....... width=771, display=flex (flex-col gap-2)
Level 2: Inner wrapper ...... width=771, display=block (pb-6)
Level 3: Radix internal ..... width=771, display=table, min-width=100%  <-- EXPANDS TO CONTENT
Level 4: Radix Viewport ..... width=510, overflow-x=hidden            <-- CLIPS HERE
Level 5: ScrollArea Root .... width=558, overflow-x=hidden (flex-1 px-6)
```

1. The Radix ScrollArea Viewport (`scroll-area.tsx:18`) is 510px wide with `overflow-x: hidden`
2. Radix internally inserts a `display: table; min-width: 100%` wrapper -- tables size to content, not container
3. The card flex layout (`flex items-center gap-4 p-4`) has no width constraint (`max-width`, `overflow-hidden`)
4. The card's flex children have a natural total width of ~771px (rank 32px + gaps + info + bookmark 44px + download ~28px + action buttons 90-194px + padding 32px)
5. The `flex-1 min-w-0` on the info section prevents text expansion but does NOT constrain the overall card width
6. Since only a vertical `ScrollBar` is rendered, there is no way to horizontally scroll to the hidden content

**Severity:** P0 -- The primary call-to-action (Install button) is completely invisible and inaccessible. Users cannot install skills from the marketplace.

**Screenshot:** `screenshots/visual_card_clipping.png`

---

### ISSUE 2 (P2): Download counts all show "---" instead of actual numbers

**Description:** All 6 search result cards display "---" (em dash) for download count. The `formatInstallCount` function (`SkillRowMarketplace.tsx:27-36`) returns "---" when count is falsy (undefined/null/0).

**Root Cause:** The `skill.installCount` field is undefined or 0 for all search results. Likely an API/data issue rather than a rendering bug.

**Severity:** P2 -- Informational content missing, but moot until P0 is fixed.

---

### ISSUE 3 (P2): Inconsistent card layout between installed vs non-installed cards

**Description:** Installed cards (5 of 6) have their bookmark button at x=721 (visible), while the one non-installed card (vercel-react-native-skills) has its bookmark button at x=824 (clipped). This is because the action area width differs: Installed badge + Remove button = 194px vs Install button alone = 90px, causing the `flex-1` info section to absorb different amounts of space.

**Root Cause:** `SkillRowMarketplace.tsx:93` -- the `flex-1 min-w-0` info section grows/shrinks based on sibling sizes, creating misaligned columns across rows.

**Severity:** P2 -- Visual inconsistency across rows; moot until P0 is fixed.

---

## Non-Issues (Verified OK)

| Check                                | Status | Notes                                                    |
| ------------------------------------ | ------ | -------------------------------------------------------- |
| Marketplace header/title             | PASS   | "Skills Marketplace" renders correctly at 28px bold      |
| Ranking tabs (All Time/Trending/Hot) | PASS   | All tabs visible, correctly positioned within viewport   |
| Search input + Search button         | PASS   | Input (264-688) and button (696-774) fit within viewport |
| Card rank badges                     | PASS   | Numbered 1-6, cyan text on slate background              |
| Card skill names                     | PASS   | White text, 15px font-semibold, truncated correctly      |
| Card repo paths                      | PASS   | Monospace, xs text, slate color, truncated correctly     |
| Card border colors                   | PASS   | Cyan border for installed cards, neutral for others      |

---

## Screenshots

| File                         | Description                                               |
| ---------------------------- | --------------------------------------------------------- |
| `visual_initial_state.png`   | App initial state showing marketplace with search results |
| `visual_marketplace_tab.png` | Marketplace tab active, cards visible                     |
| `visual_card_clipping.png`   | Final screenshot confirming card clipping issue           |

---

## Score

| Category                           | Score | Notes                                   |
| ---------------------------------- | ----- | --------------------------------------- |
| Layout - Card width constraint     | 0/10  | P0: Cards overflow container by 261px   |
| Layout - Header/Search/Tabs        | 10/10 | All header elements fit correctly       |
| Alignment - Card internal elements | 3/10  | Rank + name visible, rest clipped       |
| Rendering Quality                  | 8/10  | Clean rendering where visible           |
| Typography                         | 9/10  | Correct fonts and sizes                 |
| Colors & Theme                     | 9/10  | Correct OKLCH colors, status indicators |

**Overall Score: 35/100**

---

## Verdict

**FAIL** -- The Marketplace card layout has a critical P0 bug where 261px of card content is clipped by the ScrollArea viewport. The Install/Remove buttons, download counts, and Installed badges are completely hidden. The root cause is a width constraint mismatch between the Radix ScrollArea viewport (510px visible) and the unconstrained card flex layout (771px natural width), exacerbated by Radix's internal `display: table` wrapper that sizes to content rather than container.
