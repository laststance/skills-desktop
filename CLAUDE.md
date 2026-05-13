# Skills Desktop

Electron desktop app (macOS) for visualizing Skills symlink status across AI agents.


- Never use direct `fs` access in the renderer when Context Isolation is enabled; use preload IPC instead.
- Build macOS `APPLE_KEYCHAIN_PROFILE=skills-desktop pnpm build:mac`
- For UI, visual polish, layout, motion, and design-token changes, read `DESIGN.md` first and follow it as the design source of truth.

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
pnpm validate
```

Runs `lint`, `test`, `typecheck`, and `fallow:dead-code` in parallel via `run-p`.

Only after it passes, run the Electron e2e suite:

```bash
pnpm test:e2e
```

PRs are ready to ship only when `validate` and e2e both pass in that order.

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

### Adding a test skill for QA (global install)

When a verification run needs a fresh, throwaway skill (e.g. to exercise the
delete + UndoToast flow without touching anything the user actually relies on),
install one globally in non-interactive mode:

```bash
npx skills add --yes --global https://github.com/microsoft/azure-skills --skill azure-ai
```

`--yes` skips the skills CLI's confirmation prompts (scope, etc.); `--global`
forces the install into `~/.agents/skills/` regardless of CWD (without it,
running from inside a project with a local `.agents/` directory installs
project-local instead). The new skill is symlinked into every installed agent
immediately and is safe to delete in the same run. Use this in preference to
deleting an existing user skill.

## Design Source

`DESIGN.md` owns the app's visual system: product context, color roles,
typography, spacing, radius, elevation, motion, component styling,
accessibility, responsive behavior, and visual-polish guardrails. Keep design
guidance there so agents and design tools have one place to read before
changing UI.
