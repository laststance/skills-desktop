# Skills Desktop Design System

This file is the visual source of truth for Skills Desktop. It follows the
DESIGN.md convention popularized by Google Stitch and documented by
awesome-design-md: a plain Markdown design system that coding and design agents
can read before changing UI.

Use this document for UI polish, component sizing, color decisions, motion, and
visual QA. Keep `AGENTS.md` focused on build, release, and operational rules.

## Product Context

Skills Desktop is a macOS Electron app for developers who use multiple AI
coding agents. The core job is to visualize skill symlink health, install
marketplace skills, and keep local agent environments in sync.

Users open the app for quick operational glances during active development.
They need confidence, control, and low-friction action. They do not need a
marketing surface, tutorial-heavy language, or decorative chrome.

## Visual Theme and Atmosphere

| Dimension       | Direction                                                         |
| --------------- | ----------------------------------------------------------------- |
| Personality     | Technical, minimal, sharp                                         |
| Primary mood    | Quiet control, terminal clarity, native macOS polish              |
| Density         | High information density, calm spacing                            |
| Default mode    | Dark-first, light-supported                                       |
| References      | Warp terminal, Linear, VS Code Dark+, restrained shadcn/ui        |
| Anti-references | AWS Console, Jira, marketing landing pages, decorative dashboards |

Design principle: every pixel should communicate state, hierarchy, or action.
Prefer precise structure over ornamental surfaces.

## Core Design Principles

1. Information density over decoration.
2. Status at a glance.
3. Native macOS feel.
4. Progressive disclosure through sidebars, tabs, and Inspector panels.
5. Developer respect: no obvious tooltips, no marketing copy, no noisy empty
   states.
6. Polish by subtraction first: tighten spacing, align baselines, simplify
   depth, and improve motion only when it clarifies state.

## Color System

The app uses OKLCH CSS variables, driven by `THEME_PRESETS` in
`src/shared/constants.ts` and consumed through `src/renderer/src/styles/globals.css`.

| Token            | Role                                                                 |
| ---------------- | -------------------------------------------------------------------- |
| `--theme-hue`    | OKLCH hue angle for active color preset                              |
| `--theme-chroma` | `0` for neutral, `0.05` for tinted neutral, `0.16` for color presets |
| `--background`   | App root canvas                                                      |
| `--card`         | Sidebar, Inspector, widgets, repeated item surfaces                  |
| `--popover`      | Floating menus and overlays                                          |
| `--primary`      | Main action and active theme accent                                  |
| `--secondary`    | Low-emphasis control surface                                         |
| `--muted`        | Subtle row, field, and disabled surfaces                             |
| `--border`       | Structural boundaries                                                |
| `--ring`         | Focus ring and active control outline                                |
| `--success`      | Theme-invariant linked/valid status                                  |
| `--destructive`  | Theme-invariant destructive/error status                             |
| `--gstack`       | Theme-axis skill type accent                                         |

Status colors must remain semantically stable:

| Status               | Color                   |
| -------------------- | ----------------------- |
| Valid / linked       | `--success` fixed green |
| Broken               | Amber                   |
| Missing              | `--muted-foreground`    |
| Orphan / destructive | `--destructive`         |
| Local skill type     | Emerald                 |
| G-Stack skill type   | `--gstack`              |

Rules:

- Do not make status colors follow user theme hue.
- Pair color with text, icon, position, or count; do not rely on color alone.
- Keep backgrounds low-chroma and accents high-chroma.
- In neutral themes, linked state must never collapse to gray.
- Avoid single-hue UIs. Theme presets can tint the app, but surfaces should
  still read as neutral operational UI.

## Typography

| Use              | Typeface           | Size guidance | Notes                                      |
| ---------------- | ------------------ | ------------- | ------------------------------------------ |
| App UI           | Inter              | 12-14px       | Default interface text                     |
| Dense labels     | Inter              | 11-12px       | Sidebar meta, counters, compact badges     |
| Section headings | Inter              | 13-16px       | Use weight and spacing, not oversized type |
| Dialog titles    | Inter              | 16-20px       | Keep compact and direct                    |
| Paths and code   | JetBrains Mono     | 11-13px       | Paths, previews, technical identifiers     |
| Numbers          | Inter tabular nums | inherit       | Counts, ratios, status metrics             |

Rules:

- Keep letter spacing at `0` unless matching an existing local pattern.
- Do not use hero-scale type inside the app shell.
- Use mono only for technical values, file paths, code, and exact commands.
- Prefer sentence case for UI labels.

## Spacing and Layout

The base grid is 4px. Keep spacing small but breathable.

| Token | Use                                         |
| ----- | ------------------------------------------- |
| 4px   | Icon/text micro gaps, tight row internals   |
| 8px   | Default control gap, compact card internals |
| 12px  | Dense panel padding, row groups             |
| 16px  | Standard panel padding                      |
| 24px  | Major section separation                    |

Layout structure:

- Sidebar: fixed `w-68` (272px) in the main app.
- Settings sidebar: compact `w-50` (200px).
- Main content: flexible, scan-first list and marketplace areas.
- Detail Inspector: collapsible right panel for selected skill detail,
  marketplace preview, or dashboard widgets.
- Dashboard widgets use stable grid dimensions; widget content must not shift
  layout when loading, hovering, or changing state.

Rules:

- Do not put cards inside cards.
- Do not turn whole page sections into floating cards.
- Keep repeated rows more compact than standalone cards.
- Favor borders, separators, and subtle surface shifts over extra padding.
- Add explicit bottom spacing inside scroll areas when content can be clipped.

## Shape and Radius

Current root radius is `--radius: 0.5rem` (8px).

| Element                          | Radius             |
| -------------------------------- | ------------------ |
| Dense buttons, inputs, rows      | 6px (`rounded-md`) |
| Cards, widgets, panels           | 8px (`rounded-lg`) |
| Dialogs, toasts, larger overlays | 8-12px             |
| Swatches, avatars, dots          | Fully circular     |

Rules:

- Default to 6-8px in the app shell.
- Avoid pill shapes except for filters, status chips, and color swatches.
- Avoid large 16-24px radii inside operational panels.
- Radius should clarify grouping, not soften every surface.

## Depth and Elevation

The app should feel layered, not shadow-heavy. Use Material-inspired elevation
as a mental model: surfaces higher in the interaction stack may receive more
separation, but ordinary panels should stay flat.

| Level     | Use                             | Treatment                                      |
| --------- | ------------------------------- | ---------------------------------------------- |
| Surface 0 | App background                  | Transparent Electron canvas / `--background`   |
| Surface 1 | Sidebar, Inspector, widgets     | `--card`, border, no heavy shadow              |
| Surface 2 | Hovered rows, active selections | Tint or border change                          |
| Surface 3 | Popovers, menus, dropdowns      | `--popover`, border, subtle shadow             |
| Surface 4 | Dialogs, toasts                 | Strongest shadow, backdrop or visual isolation |

Rules:

- Default cards should prefer border + surface color over `shadow`.
- Shadows should be soft and sparse, reserved for floating UI.
- Hovering a row should not "lift" like a marketing card.
- If introducing shadow tokens, keep them app-wide and named by elevation.
- Use inset highlights sparingly for macOS-style window polish.

## Motion

Motion should clarify cause and effect without making the app feel animated.
Borrow Material's timing discipline, but tune for desktop: fast, simple,
interruptible.

| Motion                      | Duration  | Easing                         |
| --------------------------- | --------- | ------------------------------ |
| Hover/focus color           | 100-150ms | linear or standard             |
| Row state, badge, tab color | 120-180ms | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Popover/dialog enter        | 150-200ms | decelerate / ease-out          |
| Popover/dialog exit         | 100-150ms | accelerate / ease-in           |
| Panel resize/collapse       | 180-240ms | standard                       |
| Progress width              | 250-350ms | ease-out                       |

Good motion candidates:

- Tab indicator and selected row color.
- Marketplace install progress.
- Dashboard widget add/remove in edit mode.
- Undo toast entrance and countdown progress.
- Inspector open/close, if the panel transition is stable and does not fight
  `react-resizable-panels`.

Avoid:

- Decorative background movement.
- Hover scale on dense controls.
- Bouncy easing.
- Animations that delay destructive actions or bulk workflows.

Respect `prefers-reduced-motion`; transitions should be removable without
changing layout or meaning.

## Component Styling

### Buttons

| Type               | Visual height  | Hit target                          | Use                        |
| ------------------ | -------------- | ----------------------------------- | -------------------------- |
| Primary action     | 32-36px        | >= 36px, 44px when icon-only        | Install, sync, confirm     |
| Secondary action   | 30-34px        | >= 36px                             | Cancel, alternate actions  |
| Small dense action | 28-32px        | May use expanded invisible hit area | Row tools, filters         |
| Icon-only          | 28-32px visual | 44x44px target when standalone      | Close, settings, row tools |

Rules:

- If a button feels too tall, reduce the visual surface before reducing
  accessible hit area.
- Use `size="icon"` only for standalone icon buttons that need the full 44px
  target.
- Prefer lucide icons for tool buttons.
- Avoid multiple primary buttons in one region.
- Destructive buttons should be visually explicit and never rely on icon alone.

### Inputs and Search

- Height: 32-36px for standard fields.
- Use border + muted background, not heavy inset shadows.
- Placeholder text must stay lower contrast than real values.
- Search should feel command-palette-adjacent: compact, keyboard-first,
  immediately scannable.

### Tabs and Segmented Controls

- Tabs should be compact and stable.
- Use underline, border, or subtle background to communicate selection.
- Do not increase container height on hover or active state.
- Keep Radix roles in mind when testing: some toggle groups expose `radio`.

### Lists and Rows

- Rows are the primary information surface.
- Use 36-44px row heights depending on density and interaction complexity.
- Status should be visible from peripheral vision through color, text, and
  spatial placement.
- Hover should clarify clickability through tint, not depth.
- Selected rows need stronger contrast than hover rows.

### Cards and Widgets

- Use cards for repeated standalone items, dashboard widgets, dialogs, and
  genuinely framed tools.
- Keep cards at 8px radius unless a local component already establishes a
  different standard.
- Avoid marketing-card behavior: no hover scale, no large glow, no decorative
  gradient borders.
- Widget headers should stay compact and stable, typically 32-36px.

### Dialogs, Popovers, and Toasts

- Dialogs should be narrow, task-specific, and action-oriented.
- Popovers should be visually above panels through shadow and border.
- Toasts should stay compact, readable, and not shift as timers update.
- Use motion only for entrance/exit and progress continuity.

### Badges and Status Chips

- Badges are small state summaries, not decoration.
- Keep labels short.
- Do not use badge color without a readable text label.
- Avoid pill overload; repeated badges should feel like metadata.

## Accessibility and Interaction

Baseline:

- All interactive elements need accessible names.
- Keyboard focus must be visible.
- Preserve natural tab order.
- Avoid color-only communication.
- Maintain 4.5:1 contrast for normal text and 3:1 for UI components where
  feasible.
- Icon-only controls need `aria-label`.
- Use native controls before custom roles.
- Do not remove focus outlines without a visible replacement.

Target sizing:

- Standalone icon buttons should keep a 44x44px target.
- Dense row controls may have smaller visible icons if the clickable area is
  padded or the row itself is the primary target.
- Do not shrink destructive or confirmation controls below comfortable pointer
  targets.

## Responsive and Window Behavior

Skills Desktop is desktop-first. Optimize for macOS windows rather than mobile
web breakpoints.

Rules:

- Keep the main three-region model: sidebar, content, Inspector.
- Panels must remain usable at narrow widths through truncation, scrolling, or
  progressive disclosure.
- Text must not overlap icons, counters, badges, or adjacent actions.
- Use stable dimensions for toolbar buttons, counters, tabs, and widgets.
- Avoid viewport-scaled fonts.

## Do and Don't

Do:

- Tighten spacing before adding new visual elements.
- Use one clear primary action per task surface.
- Use borders and tonal surfaces for hierarchy.
- Make hover/focus/selected states consistent across lists.
- Keep animations short and state-driven.
- Use existing shadcn/Radix/lucide patterns unless there is a clear reason.
- Validate UI changes with screenshots or Playwright when the change is visual.

Don't:

- Add decorative gradients, orbs, bokeh, or background effects to the app shell.
- Use marketing hero layouts inside the desktop app.
- Add nested cards.
- Add large shadows to ordinary panels.
- Use hover scale in dense operational UI.
- Change status colors to follow theme hue.
- Introduce a new palette outside the OKLCH token system.
- Make controls taller just to feel "premium"; density is part of the brand.

## Polish Backlog Guidance

When making small visual refinements, prefer this order:

1. Normalize button visual heights and icon-only hit areas.
2. Audit radius usage and bring dense UI back to 6-8px.
3. Replace default card shadows with border plus subtle surface contrast where
   the component is not floating.
4. Add motion tokens for common state transitions.
5. Improve selected, hover, and focus consistency across list rows.
6. Add screenshot-backed before/after notes for visual PRs.

Likely app-safe improvements:

- Compact default buttons from 36px toward 32-34px where the surrounding target
  remains comfortable.
- Keep standalone icon buttons at 44px hit area, but use a smaller visible
  glyph and subtle hover background.
- Reduce ordinary card shadow intensity; reserve stronger shadows for toasts,
  dropdowns, and dialogs.
- Add 120-180ms color/opacity transitions to selected rows and tabs.
- Add 250-350ms width transitions to progress indicators only when they track
  real progress.

## Agent Prompt Guide

Before changing UI:

1. Read this file.
2. Preserve existing product direction unless explicitly asked to redesign.
3. Inspect the component being changed and match local density.
4. Prefer token-level changes over one-off class churn.
5. For visual changes, describe the intended effect in concrete terms:
   height, radius, contrast, shadow, motion, alignment, or state clarity.

Example prompt:

```text
Polish the Settings sidebar using DESIGN.md. Keep the current layout and dark
technical tone. Reduce visual button height if appropriate, preserve 44px
standalone icon hit targets, normalize radius to 6-8px, and avoid decorative
effects.
```

## References

- awesome-design-md: https://github.com/voltagent/awesome-design-md
- Stitch DESIGN.md: https://stitch.withgoogle.com/design.md
- Material Design duration and easing: https://m1.material.io/motion/duration-easing.html
- Material Design elevation and shadows: https://m1.material.io/material-design/elevation-shadows.html
- Apple HIG buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
