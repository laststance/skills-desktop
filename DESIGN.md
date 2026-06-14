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

| Status                | Color                    |
| --------------------- | ------------------------ |
| Valid / linked        | `--success` fixed green  |
| Broken / inaccessible | Amber (see amber shades) |
| Missing               | `--muted-foreground`     |
| Orphan / destructive  | `--destructive`          |
| Local skill type      | Emerald                  |
| G-Stack skill type    | `--gstack`               |

Amber shades — Tailwind ships several amber steps; pin them by role so the
"needs review" hue stays consistent and reviews don't churn:

| Role                                                       | Class                     |
| ---------------------------------------------------------- | ------------------------- |
| Broken / inaccessible / needs-review status text + icons   | `text-amber-400`          |
| Warning-dialog icon glyphs, bookmark / star, stat emphasis | `text-amber-500`          |
| Amber tint backgrounds (badges, status chips, fills)       | `bg-amber-500/{10,15,20}` |

`text-amber-400` is the app-wide needs-review hue (`SymlinkStatus`, `badge`
broken variant, `HealthWidget`); `text-amber-500` is the slightly stronger amber
for warning affordances and the bookmark accent. Tint backgrounds always use the
`amber-500` base at low alpha regardless of which text shade sits on them. The
lone exception is `text-amber-300` for badge text on a denser amber tint, where
the lighter step is needed for contrast.

Rules:

- Do not make status colors follow user theme hue.
- Pair color with text, icon, position, or count; do not rely on color alone.
- Keep backgrounds low-chroma and accents high-chroma.
- In neutral themes, linked state must never collapse to gray.
- Avoid single-hue UIs. Theme presets can tint the app, but surfaces should
  still read as neutral operational UI.

### Tinted-neutral gray base

The nine shadcn-baseColor families (clay, stone, olive, sage, steel, slate,
zinc, mauve, plum) carry `--theme-chroma: 0.05` — the open band between pure
neutral (`0`) and full color (`0.16`). When that band is active the root gets a
`.tone-tinted` class that shifts the gray base in opposite directions per mode,
so the subtle tint reads without washing surfaces out:

| Mode  | Effect on the gray base                                |
| ----- | ------------------------------------------------------ |
| Light | **Deeper** gray surfaces (more contrast against white) |
| Dark  | **Lighter** gray surfaces (lifts the near-black base)  |

Implementation: the `.light.tone-tinted` / `.dark.tone-tinted` surface-lightness
overrides live in `globals.css`; the class is toggled at runtime by
`redux/listener.ts` and pre-hydration (no FOUC) by the byte-identical bootstrap
IIFE in `renderer/index.html` and `renderer/settings/index.html`. Pure-neutral
(`0`) and full-color (`0.16`) presets keep the crisp default ramp untouched, so
the default neutral-dark appearance never changes.

Rules:

- Apply the tinted gray base only inside the open `(0, 0.16)` chroma band; never
  to pure neutral or full color.
- Hold dark tinted `--secondary` / `--muted` lightness at or below `0.27` so the
  10px ThemeSelector family labels keep AA 4.5:1 contrast on `hover:bg-muted`.

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

The size scale lives once in `button.tsx` (cva `size` variants); this table
mirrors it exactly. On a pointer-driven desktop the visual height **is** the hit
target — there is no 44px touch inflation. Use a token below; never hard-code
`h-11`/`min-h-11` (44px) on a visible button (see Target sizing for the one
invisible-hit-area exception).

| Variant   | Class        | Height | Use                                            |
| --------- | ------------ | ------ | ---------------------------------------------- |
| `xs`      | `h-6 px-2`   | 24px   | Inline / metadata-dense actions (AA floor)     |
| `sm`      | `h-7 px-2.5` | 28px   | Row tools, toolbar buttons, filters            |
| `default` | `h-8 px-3`   | 32px   | Primary and secondary actions (Install, sync)  |
| `lg`      | `h-9 px-4`   | 36px   | Prominent / isolated hero CTAs                 |
| `icon`    | `size-7`     | 28px   | Icon-only buttons (close, settings, row tools) |

Base (all variants): `text-[13px]`, `rounded-md`, 16px glyphs (`[&_svg]:size-4`),
`focus-visible:ring-1`.

Rules:

- **Filled buttons are flat** — no `shadow`/`shadow-sm` on default, secondary,
  outline, or destructive. Convey state with surface + border + hover tint, not
  drop shadow (see Depth and Elevation). "Chunky" = tall + heavily padded +
  raised; the refined scale removes all three. Shadow is reserved for floating UI
  (popovers, dialogs, toasts).
- `default` (32px) is the baseline for text buttons. Reach for `lg` (36px) only
  for an isolated hero CTA; use `sm` (28px) in dense toolbars and row tools.
- Icon-only buttons are `icon` (28px) by default; drop to `size-6` (24px, the
  WCAG 2.5.8 AA floor) only for genuinely dense rows. Never go below 24px.
- If a button feels too tall, reduce the visual surface before reducing the
  accessible hit area.
- Prefer lucide icons for tool buttons; glyphs stay 14-16px, not scaled to the
  button.
- Avoid multiple primary buttons in one region.
- Destructive buttons must be visually explicit and never rely on icon alone.

### Inputs and Search

- Height: 32px (`h-8`) for standard fields; 36px (`h-9`) only for a prominent,
  isolated field. Match the adjacent button scale so a field and its submit
  button align to the same height.
- Use border + muted background, not heavy inset shadows.
- Placeholder text must stay lower contrast than real values.
- Search should feel command-palette-adjacent: compact, keyboard-first,
  immediately scannable.
- Reset native form chrome to the token palette. macOS Chromium renders the
  `type="search"` clear control (`::-webkit-search-cancel-button`) in the system
  accent (blue), which breaks the muted OKLCH surface. Prefer a palette-matched
  affordance: recolor the pseudo-element via `appearance: none` + a masked SVG in
  `--muted-foreground` (preserves one-click clear), or supply a custom clear
  button. Top-tier tools (Linear, Raycast, Notion) never expose raw browser
  chrome. The current native blue × is an accepted low-priority item — see Polish
  Backlog Guidance.

### Tabs and Segmented Controls

- Tabs and segmented-control items are 32px (`min-h-8`, or ToggleGroup
  `default`); use the `sm` size (28px) only inside an already-dense popover.
- Tabs should be compact and stable.
- Use underline, border, or subtle background to communicate selection.
- Do not increase container height on hover or active state.
- A segmented control sits left-aligned under its own label, sized to its
  content — it does not stretch full-width or center in the row. Stretching reads
  as a primary tab bar; a secondary setting toggle should stay a compact,
  left-anchored affordance. Apply `justify-start` to the ToggleGroup whenever its
  parent is a full-width flex column. (macOS System Settings, Linear preference
  toggles.)
- Keep Radix roles in mind when testing: some toggle groups expose `radio`.

### Lists and Rows

- Rows are the primary information surface.
- Use 36-44px row heights depending on density and interaction complexity.
- Status should be visible from peripheral vision through color, text, and
  spatial placement.
- Hover should clarify clickability through tint, not depth.
- Selected rows need stronger contrast than hover rows.
- Row and card corner actions follow a visibility asymmetry by intent — match
  the affordance to whether the action helps or harms:
  - Destructive actions (delete, unlink) stay hover/focus-revealed
    (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`). They must
    not advertise themselves at rest; a quiet corner avoids accidental clicks
    and visual noise. (Linear, Finder, VS Code, GitHub issue rows.)
  - Non-destructive value-add actions (bookmark, pin, copy) keep a quiet
    always-visible rest state (`opacity-40`) that lifts to full on hover/focus.
    For an action the user benefits from finding, discoverability outranks
    restraint — hidden-until-hover hurts it. (Notion, GitHub favorite/star.)
  - Reserve overlay space with padding so revealing a corner action never
    shifts the row's content (zero-layout-shift); align overlays to the title
    row, not the card's raw top edge.

### Empty States

- Empty-state prominence scales with severity. Match the treatment to whether
  the empty is expected or a failure:
  - Expected / transient empties (a search with no matches, a freshly filtered
    list) stay to one quiet muted line. A zero-result search is a normal outcome
    — typos, narrow queries — not an error, so it must not look like one.
    (Spotlight, Linear, Raycast keep search misses understated.)
  - Rare / terminal failures (network error, leaderboard unavailable) earn the
    fuller icon + heading + description treatment, because they signal that
    something actually broke and may need user action.
- Never dress an expected empty as a failure: no `h-12` icon or `text-lg`
  heading for a search miss. This is the operational reading of principle 5's
  "no noisy empty states."

### Loading and Skeletons

- A fixed-shape skeleton — not a single "Loading…" text line — is the default
  first-load placeholder for any list or panel whose populated layout is known.
  Mirror the populated layout (same row count, same chip / text / trailing
  structure) so the panel does not reflow when real data lands. (Linear, GitHub,
  Vercel load lists this way.)
- A skeleton is silent to assistive tech: the visible "Loading…" text it
  replaces was announced; pulsing bars are not. How to restore the announcement
  depends on whether the skeleton is a **primary loading surface** or a
  **decorative one in a dense grid**:
  - **Primary loading surface** — a main panel or list the user is actively
    waiting on (e.g. the Trending panel). The skeleton container MUST carry
    `role="status"` plus a descriptive `aria-label` (e.g. "Loading trending
    skills"), and the inner placeholder rows are `aria-hidden`. Swapping
    announced text for a bare skeleton here is an accessibility regression.
  - **Decorative skeleton in a dense widget grid** — many small widgets loading
    at once (e.g. `dashboard/widgets/*Skeleton`). It MAY instead be fully
    `aria-hidden`, because announcing each of N silhouettes would fire a burst of
    competing "Loading…" messages; the surrounding region's own status copy
    covers the wait. Pick one mode — never put `role="status"` and `aria-hidden`
    on the same element (they contradict).
- A panel that renders a skeleton must actually request its data. A skeleton with
  no fetch behind it is a permanent broken-looking spinner; own the fetch on
  mount (guarded by a cache TTL) wherever the populated state is the intended
  resting state.

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

Focus indicators:

The shared `button.tsx` is the source of truth — every variant ships
`focus-visible:ring-1 ring-ring` (see Buttons). Use it for any standard button so
the focus treatment is inherited, not re-invented. For focusable elements that
genuinely can't use it (clickable rows, footer links, hand-rolled icon buttons):

- Always pair `focus-visible:outline-none` with a visible `focus-visible:ring-*
ring-ring`, and always use `focus-visible`, never bare `focus` — bare `focus`
  also fires on pointer click, flashing a ring at mouse users.
- Ring width tracks prominence, not a rigid tier: compact in-surface controls may
  match `button.tsx`'s `ring-1`; standalone hand-rolled controls commonly use
  `ring-2` (e.g. `BookmarkItem`, the sidebar gear). Both are fine as long as the
  ring reads clearly against `--ring`. Do not treat a single width as mandatory.
- Full-width or edge-adjacent controls add `focus-visible:ring-inset` so the ring
  renders inside the control instead of clipping against a container border —
  full-width rows (`AgentItem`), the footer `skills.sh` link, and underline-style
  tabs all use the inset ring.

Target sizing:

This is a pointer-driven desktop app (mouse and trackpad), so the mobile 44px
finger-target minimum does not apply. The floor is WCAG 2.5.8 AA: 24x24 CSS px
(`size-6`). Comfortable standalone controls can still be larger.

- Standalone icon buttons are 28px (`size-7`, the `icon` variant) by default.
  `size-6` (24px) is the AA floor, reserved for genuinely dense rows; only an
  isolated hero icon control sizes up toward 32px (`size-8`).
- A **visible, always-on control sets real layout** — its box, and any space
  reserved for it (e.g. a fixed list column like `BOOKMARK_COLUMN_WIDTH_PX`),
  follows the button scale above. Never reserve 44px around a 16px glyph; that is
  wasted width on a pointer-driven app, and width is scarce in the center list.
- An **invisible or conditional hit area carries no resting box and no layout
  cost**, so it MAY exceed the scale. An `opacity-0 group-hover` corner action or
  a bulk-select checkbox wrapper can keep a 44px (`min-h-11 min-w-11`) target:
  the glyph stays small, nothing reads as chunky, and the larger target is pure
  ergonomics. This is the ONLY sanctioned use of 44px on a control.
- Dense row controls may show a smaller glyph inside a 24px-or-larger target. An
  invisible `after:-inset-*` halo can extend the comfortable click area, but
  never over a row that is itself clickable: `opacity-0` controls stay
  pointer-active, so the halo would steal corner clicks meant for the row.
- Do not shrink destructive or confirmation controls below the 24px floor.

Quiet resting affordances:

When a non-destructive action uses a muted always-visible rest state (see Lists
and Rows), the resting treatment must not become an accessibility gap.

- Keep the resting opacity high enough that the control never reads as disabled;
  `opacity-40` is the practical floor for a muted-but-discoverable icon.
- Restore full strength on BOTH hover and `focus-visible` — never hover alone.
- The keyboard path must surface the control at full contrast (visible focus
  ring plus full-opacity glyph), so a muted rest state is never the only way a
  keyboard or low-vision user perceives the action.

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

- The refined button scale (xs 24 / sm 28 / default 32 / lg 36 / icon 28) is now
  codified in `button.tsx` and the Buttons table above; new surfaces inherit it.
  Remaining drift work is catching stray `h-11`/`min-h-11` on visible buttons —
  the only place 44px belongs is an invisible/conditional hit area (Target
  sizing).
- Keep standalone icon buttons at the 28px (`size-7`) default — 24px (`size-6`)
  AA floor for dense rows — with a smaller visible glyph and subtle hover
  background.
- Reduce ordinary card shadow intensity; reserve stronger shadows for toasts,
  dropdowns, and dialogs.
- Add 120-180ms color/opacity transitions to selected rows and tabs.
- Add 250-350ms width transitions to progress indicators only when they track
  real progress.
- Recolor the native search clear control to the palette. Both the marketplace
  and skills-tab search inputs use `type="search"`, so macOS Chromium paints the
  `::-webkit-search-cancel-button` in system-accent blue. A single global rule
  (`appearance: none` + masked SVG in `--muted-foreground` on the pseudo-element)
  recolors both at once while preserving one-click clear; Electron's pinned
  Chromium keeps the mask approach low-risk. Low priority — the blue × is the
  only off-palette element in an otherwise clean search surface.

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
technical tone. Reduce visual button height if appropriate, keep icon hit
targets at or above the 24px WCAG AA floor, normalize radius to 6-8px, and
avoid decorative effects.
```

## References

- awesome-design-md: https://github.com/voltagent/awesome-design-md
- Stitch DESIGN.md: https://stitch.withgoogle.com/design.md
- Material Design duration and easing: https://m1.material.io/motion/duration-easing.html
- Material Design elevation and shadows: https://m1.material.io/material-design/elevation-shadows.html
- Apple HIG buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
