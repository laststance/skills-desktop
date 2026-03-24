# Apple HIG Compliance Report

**App**: Skills Desktop v0.6.0
**Date**: 2026-03-25
**Tester**: HIG Tester Agent

---

## 1. Typography (Score: 85/100)

**Requirement**: SF Pro (Text/Display), readable line-height and letter-spacing.

| Criterion          | Status | Details                                                                                                                    |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Font family (sans) | PASS   | Inter + system-ui fallback (Inter is an acceptable substitute for SF Pro in Electron apps, closely matches SF Pro metrics) |
| Font family (mono) | PASS   | JetBrains Mono for code/paths/technical content                                                                            |
| Antialiasing       | PASS   | `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale` applied to body                             |
| Text sizes         | PASS   | Uses `text-sm` (14px), `text-xs` (12px) appropriately for information density                                              |
| Font smoothing     | PASS   | Subpixel rendering disabled for crisp text on Retina                                                                       |

**Violations**:

- None critical. Inter is not SF Pro but is the standard choice for cross-platform Electron apps and has near-identical metrics.

---

## 2. Tap/Click Areas (Score: 65/100)

**Requirement**: Minimum 44x44px for interactive elements. Full keyboard navigation & screen-reader support.

| Criterion             | Status  | Details                                                                                                 |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| Button default size   | WARN    | `h-9` (36px) - below 44px minimum                                                                       |
| Button sm size        | FAIL    | `h-8` (32px) - significantly below 44px                                                                 |
| Button lg size        | WARN    | `h-10` (40px) - just below 44px                                                                         |
| Button icon size      | WARN    | `h-9 w-9` (36x36px) - below 44px                                                                        |
| Theme color swatches  | FAIL    | `h-6 w-6` (24x24px) - severely below 44px minimum                                                       |
| Checkbox              | FAIL    | `h-4 w-4` (16x16px) - severely below 44px (relies on label for hit area)                                |
| Dropdown menu items   | PASS    | `py-1.5` with text gives adequate vertical height                                                       |
| Keyboard navigation   | PASS    | `focus-visible` ring states on buttons, inputs, checkboxes, tabs                                        |
| Screen reader support | PARTIAL | Some `aria-label` usage (DetailPanel close, StatusBadge icons, SkillItem indicators) but not systematic |

**Violations**:

- Theme selector color swatches at 24x24px are a clear HIG violation
- Checkbox at 16x16px without sufficient padding is too small
- Most button sizes fall below the 44px minimum, though this is a desktop app where pointer precision is higher

---

## 3. Colors (Score: 90/100)

**Requirement**: Role-based (Accent/Label/Background/Fill). Light/Dark supported. WCAG 2.2 AA+ contrast.

| Criterion             | Status | Details                                                                                                                                |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Role-based colors     | PASS   | Full semantic token system: background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring |
| Status colors         | PASS   | Cyan (#22D3EE) = valid, Amber (#F59E0B) = broken, Slate (#475569) = missing                                                            |
| Dark mode             | PASS   | Both neutral (HSL, shadcn defaults) and color (OKLCH hue-tinted) dark themes                                                           |
| Light mode            | PASS   | Both neutral and OKLCH-based light themes available                                                                                    |
| OKLCH color system    | PASS   | Dynamic `--theme-hue` variable drives 12 color themes with consistent chroma/lightness                                                 |
| Contrast (dark mode)  | PASS   | Background oklch(0.12) vs foreground oklch(0.98) provides excellent contrast ratio (~15:1)                                             |
| Contrast (light mode) | PASS   | Background oklch(0.99) vs foreground oklch(0.15) provides excellent contrast ratio (~15:1)                                             |
| Theme variety         | PASS   | 12 OKLCH color themes + 2 neutral (shadcn) themes                                                                                      |

**Violations**:

- No explicit support for macOS "Increase Contrast" accessibility setting
- No explicit support for "Reduce Transparency" accessibility setting

---

## 4. Spacing (Score: 88/100)

**Requirement**: 4/8px grid; key margins at 16/20/24px to emphasize hierarchy.

| Criterion              | Status | Details                                                     |
| ---------------------- | ------ | ----------------------------------------------------------- |
| 4px grid base          | PASS   | Tailwind default 4px spacing scale used throughout          |
| Sidebar padding        | PASS   | `p-4` (16px) padding in SidebarHeader                       |
| Traffic light offset   | PASS   | `pt-8` (32px) top padding accommodates macOS traffic lights |
| Traffic light position | PASS   | `{ x: 16, y: 16 }` - proper 16px inset                      |
| Gap spacing            | PASS   | Consistent use of `gap-1` (4px), `gap-2` (8px)              |
| Card/panel margins     | PASS   | Uses standard Tailwind spacing values on 4px grid           |
| Scrollbar width        | PASS   | 8px width, 4px border-radius - appropriate for macOS        |

**Violations**:

- No use of 20px spacing (not a standard Tailwind value, would need custom config)

---

## 5. Motion (Score: 55/100)

**Requirement**: Only meaningful transitions. Provide static alternatives when `prefers-reduced-motion` is enabled.

| Criterion                | Status | Details                                                                    |
| ------------------------ | ------ | -------------------------------------------------------------------------- |
| Meaningful transitions   | PASS   | `transition-colors` on interactive elements (hover/focus state changes)    |
| Tooltip animations       | PASS   | `animate-in`, `fade-in-0`, `zoom-in-95` for tooltip appearance             |
| Dialog animations        | PASS   | Fade in/out animations for dialog overlay and content                      |
| Loading spinners         | PASS   | `animate-spin` on Loader2 icons during async operations                    |
| Theme swatch hover       | PASS   | `hover:scale-110` provides feedback on theme selection                     |
| `prefers-reduced-motion` | FAIL   | **No `prefers-reduced-motion` media query found anywhere in the codebase** |

**Violations**:

- **Critical**: Zero `prefers-reduced-motion` support. All animations (spin, scale, fade, zoom) play regardless of user accessibility settings. This is a significant HIG violation for users with vestibular disorders or motion sensitivity.

---

## 6. Corner Radius (Score: 82/100)

**Requirement**: 4/8/12/20px hierarchy by hierarchy/affinity.

| Criterion       | Status | Details                                                   |
| --------------- | ------ | --------------------------------------------------------- |
| Base radius     | PASS   | `--radius: 0.5rem` (8px) as the base                      |
| Radius scale    | PASS   | `lg` = 8px, `md` = 6px, `sm` = 4px via calc               |
| Buttons         | PASS   | `rounded-md` (6px) - appropriate for interactive elements |
| Cards/panels    | PASS   | `rounded-md` / `rounded-lg` used for containers           |
| Badges          | PASS   | `rounded-md` for tag-like elements                        |
| Theme swatches  | PASS   | `rounded-full` for circular color pickers                 |
| Scrollbar thumb | PASS   | 4px radius for subtle scrollbar styling                   |

**Violations**:

- No use of 12px or 20px radius values (only 4/6/8px and full). The design spec calls for 4/8/12/20px but the implementation only uses 4/6/8/full.

---

## 7. macOS-Specific (Score: 92/100)

**Requirement**: Window controls, drag regions, native feel.

| Criterion              | Status | Details                                                                          |
| ---------------------- | ------ | -------------------------------------------------------------------------------- |
| Title bar style        | PASS   | `titleBarStyle: 'hiddenInset'` - native macOS chrome with content under titlebar |
| Traffic light position | PASS   | `trafficLightPosition: { x: 16, y: 16 }` - proper positioning                    |
| Drag regions           | PASS   | `.drag-region` / `.no-drag` classes with `-webkit-app-region`                    |
| Window glow            | PASS   | Custom `.window-glow` effect with subtle inner shadow for depth                  |
| Custom scrollbar       | PASS   | Styled scrollbar matching macOS aesthetic                                        |
| Minimum window size    | PASS   | `minWidth: 800`, `minHeight: 600` - reasonable minimums                          |
| Default window size    | PASS   | 1200x800 - good default for a 3-panel layout                                     |
| Font smoothing         | PASS   | macOS-appropriate antialiasing settings                                          |

**Violations**:

- No `vibrancy` effect (optional, would add native translucency)

---

## Composite Score

| Category        | Weight   | Score | Weighted  |
| --------------- | -------- | ----- | --------- |
| Typography      | 15%      | 85    | 12.75     |
| Tap/Click Areas | 15%      | 65    | 9.75      |
| Colors          | 20%      | 90    | 18.00     |
| Spacing         | 10%      | 88    | 8.80      |
| Motion          | 15%      | 55    | 8.25      |
| Corner Radius   | 10%      | 82    | 8.20      |
| macOS-Specific  | 15%      | 92    | 13.80     |
| **Total**       | **100%** |       | **79.55** |

## Composite HIG Score: 80/100

## Verdict: PASS (with notable issues)

The app demonstrates strong HIG compliance in its color system (OKLCH-based themes with proper semantic tokens), macOS integration (hidden titlebar, traffic lights, drag regions), and typography choices. The primary areas needing attention are:

1. **Critical**: No `prefers-reduced-motion` support - all animations play regardless of accessibility settings
2. **Important**: Several interactive elements fall below the 44px minimum tap target size, particularly theme color swatches (24px) and checkboxes (16px)
3. **Minor**: Missing 12px and 20px corner radius tiers from the design spec
4. **Minor**: No support for macOS "Increase Contrast" or "Reduce Transparency" accessibility preferences

### Screenshots

- `claudedocs/qa/screenshots/hig_main_view.png` - Main application view showing 3-panel layout
