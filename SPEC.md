# Skills Desktop - Specification

> Electron app for visualizing installed Skills and symlink status across AI agents

## Overview

Skills Desktop provides a GUI to manage and monitor skills installed via `npx skills add <owner/repo>`. It displays the central skill repository (`~/.agents/skills/`) and shows symlink status for each supported AI agent.

## Platform Support

| Platform | Status |
|----------|--------|
| macOS    | Supported |
| Windows  | Not supported |
| Linux    | Not supported |

## Language Support

| Language | Status |
|----------|--------|
| English  | Supported |
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

| Agent | Detection Path | Auto-detect |
|-------|----------------|-------------|
| Claude Code | `~/.claude/skills/` | Yes |
| Cursor | `~/.cursor/skills/` | Yes |
| OpenAI Codex | `~/.codex/skills/` | Yes |
| Gemini CLI | `~/.gemini/skills/` | Yes |
| OpenCode | `~/.opencode/skills/` | Yes |
| GitHub Copilot | `~/.github-copilot/skills/` | Yes |
| Cline | `~/.cline/skills/` | Yes |
| Roo Code | `~/.roo-code/skills/` | Yes |
| Amp | `~/.amp/skills/` | Yes |
| Goose | `~/.goose/skills/` | Yes |
| Aider | `~/.aider/skills/` | Yes |
| Codeium Windsurf | `~/.codeium/skills/` | Yes |
| Zed | `~/.zed/skills/` | Yes |
| Continue | `~/.continue/skills/` | Yes |
| PearAI | `~/.pearai/skills/` | Yes |
| Void | `~/.void/skills/` | Yes |
| Melty | `~/.melty/skills/` | Yes |
| Trae | `~/.trae/skills/` | Yes |
| Junie | `~/.junie/skills/` | Yes |
| Kilo Code | `~/.kilo-code/skills/` | Yes |
| Blackbox AI | `~/.blackbox-ai/skills/` | Yes |

**Detection Logic:**
1. On startup, scan each standard path
2. If directory exists, add agent to sidebar
3. Count symlinks and display in agent row
4. Only show agents that have skills directory present

## Features

### Core Features

- [ ] Display source directory (`~/.agents/skills/`)
- [ ] Auto-detect installed AI agents
- [ ] List all installed skills with metadata
- [ ] Show symlink status per skill per agent
- [ ] Validate symlink integrity (valid/broken/missing)

### Symlink Status

| Status | Symbol | Color | Description |
|--------|--------|-------|-------------|
| Valid | `✓` | Cyan (#22D3EE) | Symlink exists and points to valid target |
| Broken | `◐` | Amber (#F59E0B) | Symlink exists but target is missing |
| Missing | `○` | Gray (#475569) | No symlink for this agent |

### Skill Metadata

Each skill displays:
- **name**: Skill identifier from `SKILL.md` frontmatter
- **description**: Brief description from `SKILL.md` frontmatter
- **path**: Full path to skill directory
- **symlink count**: Number of active symlinks across agents

### Actions (Read-only MVP)

| Action | MVP | Future |
|--------|-----|--------|
| View skill details | Yes | - |
| View symlink status | Yes | - |
| View source directory details | Yes | - |
| Repair broken symlinks | No | Yes |
| Add new skill | No | Yes |
| Remove skill | No | Yes |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Electron |
| Frontend | React + TypeScript |
| State Management | Redux Toolkit |
| State Persistence | @laststance/redux-storage-middleware |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| Build | Vite |
| Package Manager | pnpm |

## Design System

Based on Terminal Minimal style:

| Token | Value |
|-------|-------|
| Background | `#0A0F1C` (Deep slate) |
| Surface | `#1E293B` (Slate 800) |
| Inset | `#0F172A` (Slate 900) |
| Accent | `#22D3EE` (Cyan 400) |
| Text Primary | `#FFFFFF` |
| Text Secondary | `#94A3B8` |
| Text Muted | `#64748B` |
| Font Mono | JetBrains Mono |
| Font Sans | Inter |

### Theme System

24 color themes generated using OKLCH + APCA (apcach library) for perceptually accurate palettes.

**Base Hues (12):**

| Name | Hue | Hex (Light) |
|------|-----|-------------|
| Rose | 350 | #E11D48 |
| Orange | 45 | #F97316 |
| Amber | 70 | #F59E0B |
| Yellow | 95 | #EAB308 |
| Lime | 125 | #84CC16 |
| Green | 145 | #22C55E |
| Teal | 175 | #14B8A6 |
| Cyan | 195 | #22D3EE |
| Sky | 220 | #0EA5E9 |
| Blue | 250 | #3B82F6 |
| Indigo | 275 | #6366F1 |
| Violet | 300 | #8B5CF6 |

**Modes:** Light / Dark (×12 hues = 24 themes)

**State Management:**

| Aspect | Technology |
|--------|------------|
| State | Redux Toolkit |
| Persistence | @laststance/redux-storage-middleware |
| Side Effects | Redux Toolkit Listener Middleware |
| Storage Key | `skills-desktop-theme` |

**Theme State Shape:**

```typescript
interface ThemeState {
  hue: number;        // 0-360 (OKLCH hue)
  mode: 'light' | 'dark';
  preset: string;     // e.g., "cyan", "blue", "forest"
}
```

**Theme Switching Logic:**

Theme switching is implemented via Redux Toolkit's `listenerMiddleware`, NOT in React components.

```typescript
// src/redux/listener.ts
import { createListenerMiddleware } from '@reduxjs/toolkit'
import { setTheme } from './themeSlice'

export const listenerMiddleware = createListenerMiddleware()

listenerMiddleware.startListening({
  actionCreator: setTheme,
  effect: async (action) => {
    const { hue, mode } = action.payload
    // Direct DOM manipulation - apply CSS custom properties
    document.documentElement.style.setProperty('--theme-hue', String(hue))
    document.documentElement.classList.toggle('dark', mode === 'dark')
  },
})
```

Reference: https://github.com/laststance/nsx/blob/main/src/redux/listener.ts

**Theme Selector UI:**
- Location: Main screen header (right side)
- Components: `ThemeSelector/Collapsed`, `ThemeSelector/Dropdown`
- Features: Light/Dark toggle, 12 color options

## File References

- **Design**: `pencil-welcome-desktop.pen` (Pencil MCP)
- **Skills Spec**: https://agentskills.io
- **Skills CLI**: https://github.com/vercel-labs/skills
- **Skills Registry**: https://skills.sh
