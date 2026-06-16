# Skills Desktop - Specification

> Electron app for visualizing installed Skills and symlink status across AI agents

## Overview

Skills Desktop provides a GUI to manage and monitor skills installed via `npx skills add <owner/repo>`. It displays the central skill repository (`~/.agents/skills/`) and shows symlink status for each supported AI agent.

## Platform Support

| Platform | Status        |
| -------- | ------------- |
| macOS    | Supported     |
| Windows  | Not supported |
| Linux    | Not supported |

## Language Support

| Language | Status        |
| -------- | ------------- |
| English  | Supported     |
| Japanese | Not supported |
| Others   | Not supported |

## Architecture

### Directory Structure

```
~/.agents/skills/           # Source: Central skill storage (canonical copies)
    ├── skill-a/
    ├── skill-b/
    └── ...

~/.claude/skills/           # Target: Claude Code symlinks
~/.cursor/skills/           # Target: Cursor symlinks
~/.codex/skills/            # Target: OpenAI Codex symlinks
~/.gemini/skills/           # Target: Gemini CLI symlinks
...                         # Other AI agents
```

### Agent Detection

Agents are **auto-detected** by scanning for skills directories at standard paths.
Agent definitions are synced with [vercel-labs/skills CLI](https://github.com/vercel-labs/skills/blob/main/src/agents.ts).

> **Source of truth**: `AGENT_DEFINITIONS` in `src/shared/constants.ts`. `cliId`
> is the `--agent` flag passed to the Skills CLI. `Detection Path` mirrors
> the `scanDir` field — i.e. the directory the app scans for that agent's
> own symlinks. For most agents `scanDir === installDir`; the divergent
> entries (Cline, Warp, etc.) avoid surfacing every source skill as a
> "local" skill of those agents (v0.13.0 regression guard).

| Agent              | CLI ID            | Detection Path                      |
| ------------------ | ----------------- | ----------------------------------- |
| Claude Code        | `claude-code`     | `~/.claude/skills/`                 |
| Cursor             | `cursor`          | `~/.cursor/skills/`                 |
| Codex              | `codex`           | `~/.codex/skills/`                  |
| Gemini CLI         | `gemini-cli`      | `~/.gemini/skills/`                 |
| OpenCode           | `opencode`        | `~/.config/opencode/skills/`        |
| GitHub Copilot     | `github-copilot`  | `~/.copilot/skills/`                |
| Cline              | `cline`           | `~/.cline/skills/`                  |
| Roo Code           | `roo`             | `~/.roo/skills/`                    |
| Amp                | `amp`             | `~/.config/agents/skills/`          |
| Goose              | `goose`           | `~/.config/goose/skills/`           |
| Devin Desktop      | `windsurf`        | `~/.codeium/windsurf/skills/`       |
| Continue           | `continue`        | `~/.continue/skills/`               |
| Trae               | `trae`            | `~/.trae/skills/`                   |
| Junie              | `junie`           | `~/.junie/skills/`                  |
| Kilo Code          | `kilo`            | `~/.kilocode/skills/`               |
| OpenHands          | `openhands`       | `~/.openhands/skills/`              |
| Neovate            | `neovate`         | `~/.neovate/skills/`                |
| Qoder              | `qoder`           | `~/.qoder/skills/`                  |
| Zencoder           | `zencoder`        | `~/.zencoder/skills/`               |
| Pochi              | `pochi`           | `~/.pochi/skills/`                  |
| AdaL               | `adal`            | `~/.adal/skills/`                   |
| Kimi Code CLI      | `kimi-code-cli`   | `~/.kimi/skills/`                   |
| IBM Bob            | `bob`             | `~/.bob/skills/`                    |
| Firebender         | `firebender`      | `~/.firebender/skills/`             |
| Antigravity        | `antigravity`     | `~/.gemini/antigravity/skills/`     |
| Augment            | `augment`         | `~/.augment/skills/`                |
| CodeBuddy          | `codebuddy`       | `~/.codebuddy/skills/`              |
| Command Code       | `command-code`    | `~/.commandcode/skills/`            |
| Cortex Code        | `cortex`          | `~/.snowflake/cortex/skills/`       |
| Crush              | `crush`           | `~/.config/crush/skills/`           |
| Deep Agents        | `deepagents`      | `~/.deepagents/agent/skills/`       |
| Droid              | `droid`           | `~/.factory/skills/`                |
| iFlow CLI          | `iflow-cli`       | `~/.iflow/skills/`                  |
| Kiro CLI           | `kiro-cli`        | `~/.kiro/skills/`                   |
| Kode               | `kode`            | `~/.kode/skills/`                   |
| MCPJam             | `mcpjam`          | `~/.mcpjam/skills/`                 |
| Mistral Vibe       | `mistral-vibe`    | `~/.vibe/skills/`                   |
| Mux                | `mux`             | `~/.mux/skills/`                    |
| OpenClaw           | `openclaw`        | `~/.openclaw/skills/`               |
| Pi                 | `pi`              | `~/.pi/agent/skills/`               |
| Qwen Code          | `qwen-code`       | `~/.qwen/skills/`                   |
| Replit             | `replit`          | `~/.config/agents/skills/`          |
| Trae CN            | `trae-cn`         | `~/.trae-cn/skills/`                |
| Warp               | `warp`            | `~/.warp/skills/`                   |
| AiderDesk          | `aider-desk`      | `~/.aider-desk/skills/`             |
| CodeArts Agent     | `codearts-agent`  | `~/.codeartsdoer/skills/`           |
| Codemaker          | `codemaker`       | `~/.codemaker/skills/`              |
| Code Studio        | `codestudio`      | `~/.codestudio/skills/`             |
| Devin for Terminal | `devin`           | `~/.config/devin/skills/`           |
| Dexto              | `dexto`           | `~/.dexto/skills/`                  |
| ForgeCode          | `forgecode`       | `~/.forge/skills/`                  |
| Hermes Agent       | `hermes-agent`    | `~/.hermes/skills/`                 |
| Rovo Dev           | `rovodev`         | `~/.rovodev/skills/`                |
| Tabnine CLI        | `tabnine-cli`     | `~/.tabnine/agent/skills/`          |
| Antigravity CLI    | `antigravity-cli` | `~/.gemini/antigravity-cli/skills/` |
| AstrBot            | `astrbot`         | `~/.astrbot/data/skills/`           |
| Autohand Code CLI  | `autohand-code`   | `~/.autohand/skills/`               |
| inference.sh       | `inference-sh`    | `~/.inferencesh/skills/`            |
| Jazz               | `jazz`            | `~/.jazz/skills/`                   |
| Lingma             | `lingma`          | `~/.lingma/skills/`                 |
| Loaf               | `loaf`            | `~/.loaf/skills/`                   |
| Moxby              | `moxby`           | `~/.moxby/skills/`                  |
| Ona                | `ona`             | `~/.ona/skills/`                    |
| Qoder CN           | `qoder-cn`        | `~/.qoder-cn/skills/`               |
| Reasonix           | `reasonix`        | `~/.reasonix/skills/`               |
| Terramind          | `terramind`       | `~/.terramind/skills/`              |
| Tinycloud          | `tinycloud`       | `~/.tinycloud/skills/`              |
| Zed                | `zed`             | `~/.zed/skills/`                    |

**Detection Logic:**

1. On startup, scan each standard path
2. If directory exists, add agent to sidebar
3. Count symlinks and display in agent row
4. Only show agents that have skills directory present

## Features

### Core Features

- [x] Display source directory (`~/.agents/skills/`)
- [x] Auto-detect installed AI agents (68 agents)
- [x] List all installed skills with metadata
- [x] Show symlink status per skill per agent
- [x] Validate symlink integrity (valid/broken/inaccessible/missing)
- [x] Local skills support with visual distinction

### Dashboard

When the **Installed** tab is open and no skill is selected, the detail panel renders a customizable, widget-based dashboard (`DashboardCanvas`) as the home view. It is not a separate tab — the app has only `installed` and `marketplace` tabs, and the dashboard fills the Installed tab's no-selection state. Layout is a draggable, resizable grid persisted across launches via the Redux `dashboard` slice.

- [x] Widget grid with drag-to-move and resize (edit mode via `DashboardEditToolbar`)
- [x] Multiple dashboard pages with tab navigation (`DashboardPageTabs`)
- [x] Widget picker with live preview before adding (`WidgetPicker`)
- [x] Keyboard shortcuts for edit-mode actions (`useDashboardKeyboardShortcuts`)
- [x] Layout and page state persisted between sessions

**Built-in widgets:**

| Widget         | Shows                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| Welcome        | Dismissible introduction card shown on first launch                                    |
| Skill Stats    | Totals for skills, linked skills, and agents at a glance                               |
| Symlink Health | Valid vs. broken symlinks across all agents; "Scan issues" opens orphan/broken cleanup |
| Agent Coverage | Which agents have which skills — quick matrix view                                     |
| Bookmarks      | Saved skills from the marketplace                                                      |
| Trending       | Popular marketplace skills right now                                                   |
| What's New     | Recently added or updated marketplace skills                                           |
| Quick Actions  | Frequent actions: sync, refresh, open marketplace                                      |

**Experimental widgets** — hidden from the picker unless `FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL` is enabled:

| Widget            | Shows                                                |
| ----------------- | ---------------------------------------------------- |
| Agent Heatmap     | Symlink density per agent visualized as a heatmap    |
| Activity Timeline | Recent add/remove/sync events in chronological order |

### Skills Marketplace

GUI wrapper for `npx skills` CLI commands:

- [x] Search skills via `npx skills find <query>`
- [x] Install skills via `npx skills add <repo>`
- [x] Select target agents for installation
- [x] Installation progress tracking

### Symlink Status

| Status       | Symbol | Color           | Description                               |
| ------------ | ------ | --------------- | ----------------------------------------- |
| Valid        | `✓`    | Cyan (#22D3EE)  | Symlink exists and points to valid target |
| Broken       | `◐`    | Amber (#F59E0B) | Symlink exists but target is missing      |
| Inaccessible | `!`    | Amber (#F59E0B) | Symlink target needs manual review        |
| Missing      | `○`    | Gray (#475569)  | No symlink for this agent                 |

**Orphan skill** is a separate concept layered on top of these states: a
skill record whose source directory under `~/.agents/skills/` was deleted
while one or more agent-side symlinks still dangle. Surfaced by
`scanOrphanSymlinks` and represented as the per-skill `isOrphan: boolean`
flag — see the [Orphan Skill Cleanup](#orphan-skill-cleanup) section.

### Local Skills Support

Skills can exist in two forms:

| Type   | Location                        | Indicator | Description                          |
| ------ | ------------------------------- | --------- | ------------------------------------ |
| Linked | `~/.agents/skills/` (symlinked) | 🔗        | Skill from central source, symlinked |
| Local  | Agent's own skills dir          | (none)    | Skill created directly in agent dir  |

**Visual Distinction:**

- Agent sidebar shows counts: "3 linked, 1 local"
- Skill list shows 🔗 prefix for symlinked skills (when agent selected)
- Local skills appear without link indicator

**Implementation:**

```typescript
// SymlinkInfo now includes isLocal flag
interface SymlinkInfo {
  // ... existing fields
  isLocal: boolean // true = real folder, false = symlink
}

// Agent tracks both counts
interface Agent {
  skillCount: number // symlinked skills
  localSkillCount: number // local skills (real folders)
}
```

### Skill Types

Skills fall into two categories based on their installation path. Both in-app delete paths require reviewed filesystem identity and move the selected source/local folder to the app trash with a 15-second undo window:

| Type        | Installation                   | Lock file tracked                  | In-app delete path                  |
| ----------- | ------------------------------ | ---------------------------------- | ----------------------------------- |
| CLI-managed | `npx skills add <owner/repo>`  | Yes (`~/.agents/.skill-lock.json`) | Move to app trash (undo within 15s) |
| Plain       | Created directly in skills dir | No                                 | Move to app trash (undo within 15s) |

The app detects CLI-managed skills by the `source` field on the Skill record (populated during scan from the lock file). The in-app delete button and bulk-delete flow route both CLI-managed and plain skills through reviewed app-trash deletion; CLI uninstall hints are used only in Marketplace install/uninstall copy.

### Orphan Skill Cleanup

When a skill source directory is deleted (e.g. `rm -rf ~/.agents/skills/foo`) but agent-side symlinks remain, those symlinks dangle as **orphans**. The scanner surfaces this state via `scanOrphanSymlinks` and flags the skill record with `isOrphan: true`.

**Detection rules** — `isOrphan` is set when ALL hold:

1. The source directory under `~/.agents/skills/` is missing
2. No real local folder exists for the skill in any agent dir
3. At least one agent has a dangling symlink pointing to it

**Visual treatment:**

- Amber border on the orphan skill row (same hue as the `broken` symlink color)
- `orphan` badge after the skill name (`role="img"` + `aria-label` so VoiceOver/NVDA announce the state — bare `<span>` defaults to `role="generic"` which silently drops `aria-label` per ARIA 1.2)

**Cleanup paths:**

| Path                     | Trigger                                    | Scope                                                        |
| ------------------------ | ------------------------------------------ | ------------------------------------------------------------ |
| Per-skill unlink         | Skill row's action menu → "Unlink..."      | Removes one orphan skill from one or more selected agents    |
| Per-agent cleanup dialog | Sidebar agent context menu → "Clean up..." | Previews and executes all orphan removals for a single agent |
| Global cleanup           | Sidebar footer "Clean up orphan symlinks"  | Removes all orphan symlinks across every agent               |
| Symlink Health cleanup   | Dashboard widget → "Scan issues"           | Reviews and removes orphan records plus broken agent links   |

The per-agent dialog uses the scoped sync IPC (`sync:preview` / `sync:execute` accept an optional `agentId`) so both the preview and execution stay restricted to the targeted agent. When the dialog opens with no actionable orphans (only conflicts to acknowledge), it surfaces a "conflicts skipped" hint instead of an empty success.

### Skill Metadata

Each skill displays:

- **name**: Skill identifier from `SKILL.md` frontmatter
- **description**: Brief description from `SKILL.md` frontmatter
- **path**: Full path to skill directory
- **symlink count**: Number of active symlinks across agents

### Actions

| Action                 | Status  | Notes                                                                                                                                                 |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| View skill details     | ✅ Done | -                                                                                                                                                     |
| View symlink status    | ✅ Done | -                                                                                                                                                     |
| Search skills          | ✅ Done | Marketplace tab                                                                                                                                       |
| Install skill          | ✅ Done | With agent selection                                                                                                                                  |
| Uninstall skill        | ✅ Done | Delete button and bulk-delete move reviewed CLI-managed/plain skills to app trash with undo; Marketplace hints still use `npx skills remove --global` |
| Repair broken symlinks | ✅ Done | Dashboard Symlink Health cleanup reviews and removes safe orphan/broken symlink issues without deleting live source skills                            |

## Tech Stack

| Component         | Technology                           |
| ----------------- | ------------------------------------ |
| Framework         | Electron                             |
| Frontend          | React + TypeScript                   |
| State Management  | Redux Toolkit                        |
| State Persistence | @laststance/redux-storage-middleware |
| Styling           | Tailwind CSS                         |
| UI Components     | shadcn/ui                            |
| Build             | Vite                                 |
| Package Manager   | pnpm                                 |

## Design System

Based on Terminal Minimal style with OKLCH dynamic theming.

| Token         | Value             |
| ------------- | ----------------- |
| Font Mono     | JetBrains Mono    |
| Font Sans     | Inter             |
| Border Radius | 0.5rem (--radius) |

### Theme System

54 visual themes total (37 presets): 34 OKLCH color themes + 2 pure neutral themes + 18 shadcn-baseColor-style tinted neutral themes.

**Theme Types:**

| Type           | Description                                                  | Count                     |
| -------------- | ------------------------------------------------------------ | ------------------------- |
| Color          | OKLCH hue-based dynamic colors (all UI elements tinted)      | 34 (17 hues × 2 modes)    |
| Pure Neutral   | shadcn/ui default gray palette (chroma = 0)                  | 2 (Dark + Light)          |
| Tinted Neutral | shadcn baseColor lookalikes (subtle hue tint, chroma = 0.05) | 18 (9 families × 2 modes) |

**Color Theme Hues (17):**

| Name    | Hue | Example               |
| ------- | --- | --------------------- |
| Rose    | 350 | `oklch(0.7 0.16 350)` |
| Pink    | 15  | `oklch(0.7 0.16 15)`  |
| Red     | 25  | `oklch(0.7 0.16 25)`  |
| Orange  | 45  | `oklch(0.7 0.16 45)`  |
| Amber   | 70  | `oklch(0.7 0.16 70)`  |
| Yellow  | 95  | `oklch(0.7 0.16 95)`  |
| Lime    | 125 | `oklch(0.7 0.16 125)` |
| Green   | 145 | `oklch(0.7 0.16 145)` |
| Emerald | 160 | `oklch(0.7 0.16 160)` |
| Teal    | 175 | `oklch(0.7 0.16 175)` |
| Cyan    | 195 | `oklch(0.7 0.16 195)` |
| Sky     | 220 | `oklch(0.7 0.16 220)` |
| Blue    | 250 | `oklch(0.7 0.16 250)` |
| Indigo  | 275 | `oklch(0.7 0.16 275)` |
| Violet  | 300 | `oklch(0.7 0.16 300)` |
| Fuchsia | 325 | `oklch(0.7 0.16 325)` |
| Magenta | 340 | `oklch(0.7 0.16 340)` |

**Tinted Neutral Families (9):**

shadcn-baseColor lookalikes — subtle hue tint at `chroma = 0.05` puts the
background at ~`chroma 0.0055` (matches shadcn's `oklch(0.141 0.005 285.823)`
zinc value) while accents at L=0.7 read as "subtly tinted gray." Useful
when you want the shadcn baseColor look without committing to a fully
saturated theme.

| Family | Hue | Character            |
| ------ | --- | -------------------- |
| Clay   | 20  | Warm terracotta-gray |
| Stone  | 60  | Warm sand-gray       |
| Olive  | 105 | Yellow-green gray    |
| Sage   | 150 | Green gray           |
| Steel  | 200 | Cool cyan-blue gray  |
| Slate  | 240 | Blue-gray            |
| Zinc   | 265 | Cool purple-gray     |
| Mauve  | 320 | Purple-pink-gray     |
| Plum   | 345 | Pink-purple gray     |

Each family ships with a `-dark` and `-light` preset (e.g. `zinc-dark`,
`zinc-light`) that bakes in the mode, mirroring the shape of the existing
`neutral-dark` / `neutral-light` entries.

### CSS Variables

**Color Theme (OKLCH with `var(--theme-hue)`):**

All colors dynamically tinted based on hue. Backgrounds use low chroma (0.02) for subtle tint, accents use high chroma (0.18) for vibrant color.

```css
/* .theme-color.dark */
--background: oklch(0.12 0.02 var(--theme-hue)); /* Deep, subtly tinted */
--foreground: oklch(0.98 0.01 var(--theme-hue)); /* Near white */
--card: oklch(0.18 0.025 var(--theme-hue)); /* Elevated surface */
--primary: oklch(0.7 0.18 var(--theme-hue)); /* Vibrant accent */
--secondary: oklch(0.25 0.03 var(--theme-hue)); /* Subtle accent */
--muted: oklch(0.25 0.03 var(--theme-hue)); /* Muted surface */
--muted-foreground: oklch(0.65 0.02 var(--theme-hue));
--border: oklch(0.3 0.025 var(--theme-hue));
--destructive: oklch(0.55 0.2 25); /* Fixed red hue */
```

**Neutral Theme (HSL, shadcn/ui defaults):**

Classic gray-based palette with no hue tinting.

```css
/* .theme-neutral.dark */
--background: hsl(222.2 84% 4.9%);
--foreground: hsl(210 40% 98%);
--card: hsl(222.2 84% 4.9%);
--primary: hsl(210 40% 98%);
--secondary: hsl(217.2 32.6% 17.5%);
--muted: hsl(217.2 32.6% 17.5%);
--muted-foreground: hsl(215 20.2% 65.1%);
--border: hsl(217.2 32.6% 17.5%);
--destructive: hsl(0 62.8% 30.6%);
```

### Pencil ↔ CSS Variable Mapping

| Pencil Token   | CSS Variable       | Notes                 |
| -------------- | ------------------ | --------------------- |
| bg-primary     | --background       | App background        |
| bg-surface     | --card             | Card/elevated surface |
| bg-elevated    | --secondary        | Secondary surface     |
| bg-inset       | --muted            | Inset/recessed area   |
| accent         | --primary          | Primary accent color  |
| accent-hover   | --ring             | Focus ring            |
| text-primary   | --foreground       | Primary text          |
| text-secondary | --muted-foreground | Secondary text        |
| border-default | --border           | Default border        |

**State Management:**

| Aspect       | Technology                           |
| ------------ | ------------------------------------ |
| State        | Redux Toolkit                        |
| Persistence  | @laststance/redux-storage-middleware |
| Side Effects | Redux Toolkit Listener Middleware    |
| Storage Key  | `skills-desktop-state`               |

**Theme State Shape:**

```typescript
type ThemePresetType = 'color' | 'neutral'

interface ThemeState {
  hue: number // 0-360 (OKLCH hue, only for 'color' type)
  mode: 'light' | 'dark'
  preset: string // e.g., "cyan", "neutral-dark"
  presetType: ThemePresetType
}

// Default theme: neutral-dark
const initialState: ThemeState = {
  hue: 195,
  mode: 'dark',
  preset: 'neutral-dark',
  presetType: 'neutral',
}
```

**CSS Class Structure:**

```css
/* Color themes: OKLCH with dynamic --theme-hue */
.theme-color.dark {
  /* All vars use oklch() with var(--theme-hue) */
}
.theme-color.light {
  /* Light mode OKLCH values */
}

/* Neutral themes: shadcn/ui default HSL values */
.theme-neutral.dark {
  /* All vars use hsl() static values */
}
.theme-neutral.light {
  /* Light mode HSL values */
}
```

**Theme Switching Logic:**

Theme switching is implemented via Redux Toolkit's `listenerMiddleware`:

```typescript
// src/redux/listener.ts
listenerMiddleware.startListening({
  matcher: isAnyOf(setTheme, setColorTheme, setNeutralTheme, toggleMode),
  effect: async (_action, listenerApi) => {
    const { hue, mode, presetType } = listenerApi.getState().theme
    const root = document.documentElement

    // Apply theme type class
    root.classList.toggle('theme-color', presetType === 'color')
    root.classList.toggle('theme-neutral', presetType === 'neutral')

    // Apply hue for color themes
    if (presetType === 'color') {
      root.style.setProperty('--theme-hue', String(hue))
    }

    // Apply mode
    root.classList.toggle('dark', mode === 'dark')
    root.classList.toggle('light', mode === 'light')
  },
})
```

**Theme Selector UI:**

- Location: Sidebar header (right side of "Skills Desktop" title)
- Features:
  - Light/Dark toggle (for color themes)
  - 17 color palette buttons
  - Neutral Dark/Light buttons (shadcn/ui defaults)

## IPC Communication

### Channels (Renderer → Main)

```typescript
// Invoke pattern (async request/response)
'skills:getAll'       → Promise<Skill[]>
'agents:getAll'       → Promise<Agent[]>
'source:getStats'     → Promise<SourceStats>
'files:list'          → Promise<SkillFile[]>
'files:read'          → Promise<SkillFileContent>

// Skills CLI (Marketplace)
'skills:cli:search'   → Promise<SkillSearchResult[]>
'skills:cli:install'  → Promise<CliCommandResult>
'skills:cli:cancel'   → void
'skills:cli:progress' → (Main → Renderer event)

// Sync (agent-scoped when `agentId` is set; global otherwise)
'sync:preview'        → (options?: { agentId?: AgentId }) => Promise<SyncPreviewResult>
'sync:execute'        → (options:  { agentId?: AgentId }) => Promise<SyncExecuteResult>

// Settings (atomic-write JSON at userData/settings.json)
'settings:open'       → void
'settings:get'        → Promise<Settings>
'settings:set'        → (patch: Partial<Settings>) => Promise<Settings>
'settings:changed'    → (Main → Renderer event, fanned out to every window)
```

### Type Definitions

```typescript
interface Skill {
  name: string
  description: string
  path: string
  filesystemIdentity?: FilesystemEntryIdentity
  symlinkCount: number
  symlinks: SymlinkInfo[]
  /** True when the skill lives under SOURCE_DIR (`~/.agents/skills/`); false for agent-local-only skills. */
  isSource: boolean
  /** True when every entry in `symlinks` is broken/missing AND no real local folder exists — i.e. the source skill was deleted but agent symlinks still dangle. Set by `scanOrphanSymlinks`; gates delete/unlink buttons in the renderer. */
  isOrphan: boolean
  /** Short source identifier in `owner/repo` format. @example "vercel-labs/skills" */
  source?: string
  /** Full URL to the source repository. */
  sourceUrl?: string
}

interface Agent {
  id: string
  name: string
  path: string
  exists: boolean
  skillCount: number
  localSkillCount: number
  filesystemIdentity?: FilesystemEntryIdentity
}

interface FilesystemEntryIdentity {
  kind: 'directory' | 'symlink' | 'file' | 'other'
  dev: number
  ino: number
  size: number
  ctimeMs: number
  mtimeMs: number
}

interface SymlinkInfo {
  agentId: string
  agentName: string
  status: SymlinkStatus
  targetPath?: string
  linkPath: string
  isLocal: boolean
  filesystemIdentity?: FilesystemEntryIdentity
  skillMdSymlinkTarget?: string
}

type SymlinkStatus = 'valid' | 'broken' | 'inaccessible' | 'missing'

interface SourceStats {
  path: string
  skillCount: number
  totalSize: string
  lastModified: string
}

interface SkillFile {
  name: string
  path: string
  extension: string
  size: number
}

interface SkillFileContent {
  name: string
  content: string
  extension: string
  lineCount: number
}

// Marketplace types
interface SkillSearchResult {
  rank: number
  name: string
  repo: string
  url: string
}

interface InstallOptions {
  repo: string
  global: boolean
  agents: string[]
  skills?: string[]
}

interface CliCommandResult {
  success: boolean
  stdout: string
  stderr: string
  code: number | null
}

interface InstallProgress {
  phase: 'cloning' | 'installing' | 'linking' | 'complete' | 'error'
  message: string
  percent?: number
}

type MarketplaceStatus = 'idle' | 'searching' | 'installing' | 'error'
```

## Redux State

```typescript
interface RootState {
  theme: ThemeState
  skills: SkillsState
  agents: AgentsState
  ui: UIState
  update: UpdateState
  marketplace: MarketplaceState
  settings: SettingsState
}

interface SettingsState {
  /** Cached `Settings` object — main process owns the file, renderer mirrors via `settings:changed` events. */
  values: Settings
  /** Loading state for the initial `settings:get` round-trip on app launch. */
  loaded: boolean
}

interface SkillsState {
  items: Skill[]
  selected: string | null
  loading: boolean
  error: string | null
  searchQuery: string
}

interface AgentsState {
  items: Agent[]
  selected: string | null
  loading: boolean
}

interface UIState {
  searchQuery: string
  sourceStats: SourceStats | null
  isRefreshing: boolean
}

interface MarketplaceState {
  status: MarketplaceStatus
  searchQuery: string
  searchResults: SkillSearchResult[]
  selectedSkill: SkillSearchResult | null
  installProgress: InstallProgress | null
  error: string | null
}
```

## Project Structure

```
skills-desktop/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── components.json           # shadcn/ui config
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts
│   │   ├── ipc/
│   │   │   ├── handlers.ts
│   │   │   ├── skills.ts
│   │   │   ├── agents.ts
│   │   │   ├── source.ts
│   │   │   ├── files.ts
│   │   │   ├── sync.ts           # Sync handlers (agent-scoped via `agentId`)
│   │   │   ├── settings.ts       # settings:get / set / open IPC
│   │   │   └── skillsCli.ts      # Marketplace CLI handlers
│   │   ├── updater.ts
│   │   ├── constants.ts
│   │   └── services/
│   │       ├── skillScanner.ts
│   │       ├── agentScanner.ts
│   │       ├── symlinkChecker.ts
│   │       ├── metadataParser.ts
│   │       ├── fileReader.ts
│   │       ├── settings.ts          # Atomic-write settings.json + load/parse
│   │       ├── settingsWindow.ts    # Settings BrowserWindow lifecycle
│   │       ├── syncService.ts       # Preview/execute sync (scoped or global)
│   │       └── skillsCliService.ts  # npx skills CLI wrapper
│   ├── preload/
│   │   ├── index.ts          # Context bridge
│   │   └── index.d.ts
│   ├── renderer/
│   │   ├── index.html
│   │   ├── settings/             # Separately-rendered Settings window
│   │   │   ├── index.html
│   │   │   ├── main.tsx
│   │   │   ├── SettingsApp.tsx
│   │   │   └── sections/
│   │   │       ├── About.tsx
│   │   │       ├── Appearance.tsx
│   │   │       ├── AutoUpdates.tsx
│   │   │       ├── General.tsx
│   │   │       ├── Keybindings.tsx
│   │   │       └── SectionFrame.tsx
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── redux/
│   │       │   └── slices/
│   │       │       ├── skillsSlice.ts
│   │       │       ├── agentsSlice.ts
│   │       │       ├── themeSlice.ts
│   │       │       ├── uiSlice.ts
│   │       │       ├── updateSlice.ts
│   │       │       ├── settingsSlice.ts
│   │       │       └── marketplaceSlice.ts
│   │       ├── components/
│   │       │   ├── layout/
│   │       │   ├── marketplace/    # Marketplace UI
│   │       │   │   ├── SkillsMarketplace.tsx
│   │       │   │   ├── MarketplaceSearch.tsx
│   │       │   │   ├── SkillRowMarketplace.tsx
│   │       │   │   └── InstallModal.tsx
│   │       │   └── ui/             # shadcn/ui components
│   │       ├── views/
│   │       ├── hooks/
│   │       │   └── useMarketplaceProgress.ts
│   │       └── styles/
│   └── shared/
│       ├── types.ts
│       ├── constants.ts            # AGENT_DEFINITIONS, THEME_PRESETS, KEYBINDINGS, SKILLS_CLI_VERSION
│       ├── settings.ts             # SettingsSchema (Zod) + DEFAULT_SETTINGS
│       ├── ipc-contract.ts         # Typed IPC contract (zod schemas)
│       └── ipc-channels.ts
├── resources/
│   └── icon.icns
└── website/                  # Landing page (Next.js)
```

## Window Configuration

| Property         | Value                 |
| ---------------- | --------------------- |
| Default Size     | 1200×800              |
| Minimum Size     | 800×600               |
| Title Bar Style  | `hiddenInset` (macOS) |
| Background Color | `#0A0F1C`             |

## Settings Window

A dedicated, separately-rendered Settings window (Inkdrop-style) — not a modal — opened from:

- Sidebar gear icon
- App menu **Settings…** (⌘,)

Both routes converge on the same `BrowserWindow` instance owned by `src/main/services/settingsWindow.ts`.

**Sections:**

| Section     | Purpose                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| About       | App version, updater status, links                                        |
| Agents      | Hide/show installed agents from the sidebar (visibility-only toggle)      |
| Appearance  | Theme presets, light/dark mode, window background blur                    |
| AutoUpdates | Update channel and check cadence                                          |
| General     | Default skill detail tab, preferred terminal, startup window size         |
| Keybindings | Read-only display sourced from `KEYBINDINGS` in `src/shared/constants.ts` |

**Persistence:**

User-editable values are stored in `app.getPath('userData')/settings.json` via atomic-write (write-temp + rename) by `src/main/services/settings.ts`. The schema is defined in `src/shared/settings.ts` using Zod, with `DEFAULT_SETTINGS` as the fallback when the file is missing or fails validation.

**Cross-window sync:**

Renderers cache settings in Redux (`settingsSlice`) but never write directly. The flow:

1. Renderer reads via `window.electron.settings.get()` → `settings:get` IPC → `loadSettings()` returns the parsed object
2. Renderer writes via `window.electron.settings.set(patch)` → `settings:set` IPC → main writes the updated file
3. Main fans out a `settings:changed` event to every renderer (main window + Settings window) via `broadcastTypedEvent` so all caches stay in lockstep
4. The Settings window opener is exposed as `window.electron.settings.open()` → `settings:open` IPC

**Schema:**

```typescript
// src/shared/settings.ts
export const SettingsSchema = z.object({
  defaultSkillTab: z.enum(['files', 'info']).default('files'),
  preferredTerminal: z.enum(TERMINAL_APP_IDS).default('terminal'),
  customTerminalAppName: z.string().trim().min(1).max(64).optional(),
  windowSize: windowSizeSchema, // { width, height } | undefined
  windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_RADIUS_SCHEMA.default(
    WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
  ),
  hiddenAgentIds: HIDDEN_AGENT_IDS_SCHEMA, // AgentId[] (deduped, validated against AGENT_IDS)
})
export type Settings = z.infer<typeof SettingsSchema>
export const DEFAULT_SETTINGS: Settings = {
  defaultSkillTab: 'files',
  preferredTerminal: 'terminal',
  windowBackgroundBlurRadius: WINDOW_BACKGROUND_BLUR_MIN_RADIUS,
  hiddenAgentIds: [],
}
```

The `KEYBINDINGS` constant is the single source of truth for the read-only Keybindings section, ensuring the Settings UI never drifts from the actual menu accelerators.

## Menu Bar (Minimal)

- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close

## Empty State

### No Skills Installed

When no skills are installed (`skills.length === 0`):

- Show "No skills installed" message
- Display installation guide: `npx skills add <skill-name>`

### Search Miss

When a search query yields no results (`filteredSkills.length === 0 && searchQuery.length > 0`):

- Show a `SearchX` icon (`h-8 w-8 text-muted-foreground/40`, decorative — `aria-hidden`)
- Echo the query: `No skills match "{searchQuery}"` (`text-sm text-muted-foreground`)
- Offer a ghost "Clear search" button that dispatches `setSearchQuery('')`

The message must recede (never `font-medium` or `text-foreground`) so it doesn't compete with the empty result area. Implemented in `SkillsList.tsx`.

## Auto Update

| Setting           | Value                              |
| ----------------- | ---------------------------------- |
| Provider          | GitHub Releases                    |
| Check on startup  | Yes                                |
| User notification | In-app toast (bottom-right corner) |
| Install timing    | On user-initiated restart          |

### Update Toast States

| State       | Icon        | Actions               |
| ----------- | ----------- | --------------------- |
| Available   | Download    | Later, Download       |
| Downloading | Download    | Progress bar (0-100%) |
| Ready       | RefreshCw   | Later, Restart Now    |
| Error       | AlertCircle | Dismiss               |

### IPC Events (Main → Renderer)

```typescript
'update:checking' // Update check started
'update:available' // { version, releaseNotes }
'update:not-available' // Already on latest
'update:progress' // { percent }
'update:downloaded' // { version, releaseNotes }
'update:error' // { message }
```

### Redux State

```typescript
interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  version: string | null
  releaseNotes: string | null
  progress: number
  error: string | null
  dismissed: boolean
}
```

## Build & Distribution

| Setting      | Value                                        |
| ------------ | -------------------------------------------- |
| Bundle ID    | `io.laststance.skills-desktop`               |
| Notarization | electron-builder built-in (`notarize: true`) |
| Code Signing | Hardened Runtime enabled                     |
| Targets      | macOS arm64, macOS x64 (DMG + ZIP)           |
| Publish      | GitHub Releases                              |

**Build Command:**

```bash
# Production build with notarization
APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac
```

## Landing Page

| Setting   | Value                     |
| --------- | ------------------------- |
| Framework | Next.js 15 + Tailwind CSS |
| Directory | `website/`                |
| Deploy    | Vercel (laststance team)  |
| URL       | skills-desktop.vercel.app |

**Sections:**

- Hero with app screenshot
- Feature grid (68 agents, symlink status, 27 theme presets)
- Download CTA linking to GitHub Release
- OG image for social sharing

## Skills CLI Integration

The Marketplace feature wraps `npx skills@<SKILLS_CLI_VERSION>` CLI commands (version pinned in `src/shared/constants.ts`):

| Feature | CLI Command                                    | Options                          |
| ------- | ---------------------------------------------- | -------------------------------- |
| Search  | `npx skills@<SKILLS_CLI_VERSION> find <query>` | -                                |
| Install | `npx skills@<SKILLS_CLI_VERSION> add <repo>`   | `-y`, `-g`, `--agent`, `--skill` |

**CLI Output Parsing:**

- `FORCE_COLOR=0` to disable ANSI colors
- Parse `owner/repo@skill-name` pattern from find output
- Progress events via EventEmitter

**Agent ID Mapping:**

Internal IDs map to CLI identifiers via `AGENT_DEFINITIONS`:

```typescript
// src/shared/constants.ts
// Common case (most agents): installDir === scanDir
{
  id: 'claude-code',
  cliId: 'claude-code',
  name: 'Claude Code',
  installDir: '.claude',
  scanDir: '.claude',
}

// Divergence case (Cline/Warp): CLI installs into the universal source,
// but the app scans the agent's own home dir to avoid surfacing every
// source skill as that agent's "local skill" (v0.13.0 regression guard).
{
  id: 'cline',
  cliId: 'cline',
  name: 'Cline',
  installDir: '.agents',
  scanDir: '.cline',
}
```

## File References

- **Design**: `design/skills-desktop.pen` (Pencil MCP)
- **Skills Spec**: https://agentskills.io
- **Skills CLI**: https://github.com/vercel-labs/skills
- **Skills CLI Source**: `/Users/ryotamurakami/clone/skills` (local clone)
- **Skills Registry**: https://skills.sh
