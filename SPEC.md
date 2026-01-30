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

Agents are **auto-detected** by scanning for skills directories at standard paths:

| Agent            | Detection Path              | Auto-detect |
| ---------------- | --------------------------- | ----------- |
| Claude Code      | `~/.claude/skills/`         | Yes         |
| Cursor           | `~/.cursor/skills/`         | Yes         |
| OpenAI Codex     | `~/.codex/skills/`          | Yes         |
| Gemini CLI       | `~/.gemini/skills/`         | Yes         |
| OpenCode         | `~/.opencode/skills/`       | Yes         |
| GitHub Copilot   | `~/.github-copilot/skills/` | Yes         |
| Cline            | `~/.cline/skills/`          | Yes         |
| Roo Code         | `~/.roo-code/skills/`       | Yes         |
| Amp              | `~/.amp/skills/`            | Yes         |
| Goose            | `~/.goose/skills/`          | Yes         |
| Aider            | `~/.aider/skills/`          | Yes         |
| Codeium Windsurf | `~/.codeium/skills/`        | Yes         |
| Zed              | `~/.zed/skills/`            | Yes         |
| Continue         | `~/.continue/skills/`       | Yes         |
| PearAI           | `~/.pearai/skills/`         | Yes         |
| Void             | `~/.void/skills/`           | Yes         |
| Melty            | `~/.melty/skills/`          | Yes         |
| Trae             | `~/.trae/skills/`           | Yes         |
| Junie            | `~/.junie/skills/`          | Yes         |
| Kilo Code        | `~/.kilo-code/skills/`      | Yes         |
| Blackbox AI      | `~/.blackbox-ai/skills/`    | Yes         |

**Detection Logic:**

1. On startup, scan each standard path
2. If directory exists, add agent to sidebar
3. Count symlinks and display in agent row
4. Only show agents that have skills directory present

## Features

### Core Features

- [x] Display source directory (`~/.agents/skills/`)
- [x] Auto-detect installed AI agents
- [x] List all installed skills with metadata
- [x] Show symlink status per skill per agent
- [x] Validate symlink integrity (valid/broken/missing)

### Symlink Status

| Status  | Symbol | Color           | Description                               |
| ------- | ------ | --------------- | ----------------------------------------- |
| Valid   | `✓`    | Cyan (#22D3EE)  | Symlink exists and points to valid target |
| Broken  | `◐`    | Amber (#F59E0B) | Symlink exists but target is missing      |
| Missing | `○`    | Gray (#475569)  | No symlink for this agent                 |

### Skill Metadata

Each skill displays:

- **name**: Skill identifier from `SKILL.md` frontmatter
- **description**: Brief description from `SKILL.md` frontmatter
- **path**: Full path to skill directory
- **symlink count**: Number of active symlinks across agents

### Actions (Read-only MVP)

| Action                 | MVP | Future |
| ---------------------- | --- | ------ |
| View skill details     | Yes | -      |
| View symlink status    | Yes | -      |
| Repair broken symlinks | No  | Yes    |
| Add new skill          | No  | Yes    |
| Remove skill           | No  | Yes    |

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

26 themes total: 24 OKLCH color themes + 2 shadcn/ui neutral themes.

**Theme Types:**

| Type    | Description                                             | Count                  |
| ------- | ------------------------------------------------------- | ---------------------- |
| Color   | OKLCH hue-based dynamic colors (all UI elements tinted) | 24 (12 hues × 2 modes) |
| Neutral | shadcn/ui default gray palette (no hue tint)            | 2 (Dark + Light)       |

**Color Theme Hues (12):**

| Name   | Hue | Example               |
| ------ | --- | --------------------- |
| Rose   | 350 | `oklch(0.7 0.18 350)` |
| Orange | 45  | `oklch(0.7 0.18 45)`  |
| Amber  | 70  | `oklch(0.7 0.18 70)`  |
| Yellow | 95  | `oklch(0.7 0.18 95)`  |
| Lime   | 125 | `oklch(0.7 0.18 125)` |
| Green  | 145 | `oklch(0.7 0.18 145)` |
| Teal   | 175 | `oklch(0.7 0.18 175)` |
| Cyan   | 195 | `oklch(0.7 0.18 195)` |
| Sky    | 220 | `oklch(0.7 0.18 220)` |
| Blue   | 250 | `oklch(0.7 0.18 250)` |
| Indigo | 275 | `oklch(0.7 0.18 275)` |
| Violet | 300 | `oklch(0.7 0.18 300)` |

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
  - 12 color palette buttons
  - Neutral Dark/Light buttons (shadcn/ui defaults)

## IPC Communication

### Channels (Renderer → Main)

```typescript
// Invoke pattern (async request/response)
'skills:getAll'      → Promise<Skill[]>
'agents:getAll'      → Promise<Agent[]>
'source:getStats'    → Promise<SourceStats>
'files:list'         → Promise<SkillFile[]>
'files:read'         → Promise<SkillFileContent>
```

### Type Definitions

```typescript
interface Skill {
  name: string
  description: string
  path: string
  symlinkCount: number
  symlinks: SymlinkInfo[]
}

interface Agent {
  id: string
  name: string
  path: string
  exists: boolean
  skillCount: number
}

interface SymlinkInfo {
  agentId: string
  agentName: string
  status: SymlinkStatus
  targetPath: string
  linkPath: string
}

type SymlinkStatus = 'valid' | 'broken' | 'missing'

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
```

## Redux State

```typescript
interface RootState {
  theme: ThemeState
  skills: SkillsState
  agents: AgentsState
  ui: UIState
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
│   │   │   └── files.ts
│   │   ├── updater.ts
│   │   ├── constants.ts
│   │   └── services/
│   │       ├── skillScanner.ts
│   │       ├── agentScanner.ts
│   │       ├── symlinkChecker.ts
│   │       ├── metadataParser.ts
│   │       └── fileReader.ts
│   ├── preload/
│   │   ├── index.ts          # Context bridge
│   │   └── index.d.ts
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── redux/
│   │       ├── components/
│   │       ├── views/
│   │       ├── hooks/
│   │       └── styles/
│   └── shared/
│       ├── types.ts
│       ├── constants.ts
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

## Menu Bar (Minimal)

- **Edit**: Undo, Redo, Cut, Copy, Paste, Select All
- **Window**: Minimize, Close

## Empty State

When `~/.agents/skills/` does not exist:

- Show "No skills installed" message
- Display installation guide: `npx skills add <owner/repo>`

## Auto Update

| Setting           | Value                      |
| ----------------- | -------------------------- |
| Provider          | GitHub Releases            |
| Check on startup  | Yes                        |
| User notification | Dialog on update available |
| Install timing    | On app restart             |

```typescript
// src/main/updater.ts
import { autoUpdater } from 'electron-updater'

export function initAutoUpdater() {
  autoUpdater.checkForUpdatesAndNotify()
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
- Feature grid (21 agents, symlink status, 24 themes)
- Download CTA linking to GitHub Release
- OG image for social sharing

## File References

- **Design**: `design/skills-desktop.pen` (Pencil MCP)
- **Skills Spec**: https://agentskills.io
- **Skills CLI**: https://github.com/vercel-labs/skills
- **Skills Registry**: https://skills.sh
