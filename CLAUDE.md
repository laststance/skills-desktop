# Skills Desktop

Electron desktop app (macOS) for visualizing Skills symlink status across AI agents.


- Never use direct `fs` access in the renderer when Context Isolation is enabled; use preload IPC instead.
- Build macOS `APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac`

### 🔴 Releases — Use `/electron-release` ONLY

`/electron-release` is the single source of truth for the entire release pipeline:

**version bump → notarized build → ZIP rename → GitHub release → website URL update → artifacts upload**

**Forbidden:**
- `/ship` MUST NOT bump `package.json` version. `/ship` is for code commits/PRs only. Version bumps are owned exclusively by `/electron-release`.
- Manual `gh release create` outside `/electron-release` (skips notarization check, ZIP rename, website update — auto-update breaks)
- Manual edit of `package.json` `"version"` field

For local production build verification (no release):

```bash
APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac
```

Without `APPLE_KEYCHAIN_PROFILE`: signing succeeds but notarization fails → Gatekeeper blocks the app.

## Gotchas

- **`*.browser.test.tsx`** runs in the Chromium lane via vitest browser mode. Vitest 4 projects need `dedupe + optimizeDeps` duplicated inline or React context breaks across files
- **`npx skills remove <name>` defaults to local scope** while `npx skills add` defaults to global. Always pass `--global` for uninstall hints surfaced to users — see `SkillRowMarketplace.tsx` installed badge `aria-label`
- **Port 9222 sticks** if `pnpm dev` died unclean. `kill-port 9222` (or `pkill -f electron`) before relaunching

## Quality Gate

Before opening or merging a PR, run the fast gates first:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm fallow:dead-code
```

Only after all four pass, run the Electron e2e suite:

```bash
pnpm test:e2e
```

PRs are ready to ship only when the fast gates and e2e both pass in that order.

## Domain Concepts

| Entity    | Location             | Description                                                    |
| --------- | -------------------- | -------------------------------------------------------------- |
| Skill     | `~/.agents/skills/`  | Directory with SKILL.md                                        |
| Agent     | `~/.<agent>/skills/` | AI agents (count = `AGENT_DEFINITIONS.length` in `src/shared/constants.ts`) |
| Symlink   | Agent→Skill          | `valid` / `broken` / `missing`                                 |
| Universal | `~/.agents/skills/`  | 12 agents share this source dir (see `UNIVERSAL_AGENT_IDS` in `src/shared/constants.ts`) |

### Skills CLI

| Resource       | Location                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| Repository     | https://github.com/vercel-labs/skills (paths below are inside that repo)                       |
| CLI agent list | `src/agents.ts`                                                                                |
| CLI types      | `src/types.ts`                                                                                 |
| Pinned version | `SKILLS_CLI_VERSION` in `src/shared/constants.ts` (currently `1.5.1`) — bump via `/cli-upgrade` |

`AGENT_DEFINITIONS` in `src/shared/constants.ts` mirrors the CLI's agent
list. Each entry: `id` (app state), `cliId` (`--agent` flag), `name`
(display), `dir` (home subpath like `.claude`).

## UI Verification

Drive the running app via **`playwright-cli`** (CDP attach to Electron's
`:9222` debug port). The full workflow (phases, triage, report template)
lives in the `/qa-electron` skill — invoke it for systematic QA runs.
Quick ad-hoc verification commands:

```bash
# 1. Start dev server (exposes CDP on :9222)
pnpm dev

# 2. Attach once per session
playwright-cli attach --cdp=http://localhost:9222

# 3. Inspect + interact (use --s=default for the attached session)
playwright-cli --s=default snapshot                  # a11y tree with eN element refs
playwright-cli --s=default screenshot --filename=/tmp/shot.png
playwright-cli --s=default click e5                  # interact by ref from snapshot
playwright-cli --s=default fill e3 "text"
playwright-cli --s=default press Escape
playwright-cli --s=default eval 'document.title'     # run JS in renderer

# 4. Detach when done (does NOT close the app — pnpm dev still owns it)
playwright-cli --s=default detach
```

Re-snapshot after any action that mutates the DOM — `eN` refs are valid
only for the most recent snapshot.

## QA Safety

During QA runs, **do NOT delete skills under `~/.claude/skills/` or `~/.cursor/skills/`** — those are the user's live Claude Code and Cursor working sets. Skills under any other agent directory are safe to delete: they can be reinstalled instantly via the Marketplace tab or sync flow.

| Path                  | Deletable in QA? | Reason                                |
| --------------------- | ---------------- | ------------------------------------- |
| `~/.claude/skills/`   | ❌               | User's live Claude Code working set   |
| `~/.cursor/skills/`   | ❌               | User's live Cursor working set        |
| `~/.<other>/skills/`  | ✅               | Reinstallable via marketplace or sync |

## Design Context

### Users
Developers who use multiple AI coding agents (Claude Code, Cursor, Codex, etc.) and need to manage shared skills/plugins across them. They use this app to visualize symlink status, install skills from a marketplace, and keep their agent environments in sync. Context: quick glances during workflow, not prolonged sessions.

### Brand Personality
**Technical, Minimal, Sharp** — An engineering tool that respects the developer's intelligence. No hand-holding, no visual noise. Every pixel earns its place.

### Emotional Goals
- **Trust & confidence**: "My skills are properly linked, nothing is broken"
- **Control**: "I can see and manage every agent's state from one place"

### Aesthetic Direction
- **Visual tone**: Dark-first, high information density without clutter. Terminal-inspired clarity with native macOS polish
- **References**: Warp terminal, Linear, VS Code Dark+
- **Anti-references**: AWS Console, Jira — information-overloaded dashboards with competing visual hierarchies
- **Theme**: OKLCH color system with dual `--theme-hue` × `--theme-chroma` axes. 27 presets (17 color hues + 2 pure neutral + 8 tinted neutral, see `THEME_PRESETS` in `src/shared/constants.ts`) persist via `@laststance/redux-storage-middleware` (version-migrated v0→v1→v2). Dark mode is default, light supported

### Color System
- OKLCH-based; every shadcn token derives from `oklch(L calc(var(--theme-chroma) * K) var(--theme-hue))`, so a single preset table (`THEME_PRESETS` in `src/shared/constants.ts`) drives all surfaces
- `--theme-chroma`: `0` (neutral/shadcn grayscale) or `COLOR_PRESET_CHROMA = 0.16` (color preset) — same formula, two modes. `--theme-hue`: OKLCH angle (0–360), irrelevant when chroma is 0
- Status tokens: `--success` (fixed green, theme-invariant) = valid/linked, amber = broken, `--muted-foreground` = missing. `--success` stays green even in neutral presets so "linked" never collapses to mid-gray
- Skill type borders: `--success` = symlinked, emerald = local
- Low-chroma backgrounds, high-chroma accents — information through color, not decoration

### Typography
- **Sans**: Inter — neutral, highly legible at small sizes, tabular-nums for data
- **Mono**: JetBrains Mono — code blocks, paths, technical content
- System font stack fallback for native feel

### Spacing & Layout
- Base unit: 4px grid (Tailwind default)
- Border radius: 8px (`--radius: 0.5rem`)
- Panel layout: react-resizable-panels with collapsible Inspector pattern
- Sidebar: fixed 240px, content panels: percentage-based

### Design Principles
1. **Information density over decoration** — Show data, not chrome. Every visual element communicates state
2. **Status at a glance** — Color-coded symlink states (success green / amber / muted) should stay readable in peripheral vision regardless of chosen theme preset
3. **Native macOS feel** — Window glow effects, drag regions, system-level keyboard shortcuts. Feels like it belongs on macOS
4. **Progressive disclosure** — Default 3-column layout; Detail Inspector appears only when needed (Apple HIG Inspector pattern)
5. **Developer respect** — No tooltips explaining obvious things, no confirmation dialogs for safe actions, no marketing language in the UI
