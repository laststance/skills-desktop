import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { _electron, type Page } from '@playwright/test'

import { SKILLS_CLI_VERSION } from '@/shared/constants'

import { test, expect } from '../fixtures/electron-app'
import { dispatchAction } from '../helpers/redux'

const SPARSE_GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const MARKETPLACE_SKILL = {
  rank: 1,
  name: 'find-skills',
  repo: 'vercel-labs/skills',
  url: 'https://skills.sh/vercel-labs/skills/find-skills',
  installCount: 1,
}

/**
 * Install a fake `npx` binary into a user-level directory that Finder-launched
 * macOS apps do not receive in PATH by default.
 *
 * @param home - Isolated E2E HOME used by the Electron process
 * @returns Path to the marker file written by the fake `npx`
 * @example
 * const markerPath = stageFallbackNpx('/tmp/home')
 * // Electron can only execute it when skillsCliService extends PATH.
 */
function stageFallbackNpx(home: string): string {
  const markerPath = join(home, '.e2e-fake-npx-args')
  const fakeNpxPath = join(home, 'Library', 'pnpm', 'npx')
  mkdirSync(dirname(fakeNpxPath), { recursive: true })

  writeFileSync(
    fakeNpxPath,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" > "$HOME/.e2e-fake-npx-args"

repo=""
skill=""
next=""
for arg in "$@"; do
  if [ "$next" = "source" ]; then
    repo="$arg"
    next=""
    continue
  fi
  if [ "$next" = "skill" ]; then
    skill="$arg"
    next=""
    continue
  fi
  case "$arg" in
    add) next="source" ;;
    --skill) next="skill" ;;
  esac
done

if [ "$repo" != "vercel-labs/skills" ] || [ "$skill" != "find-skills" ]; then
  echo "unexpected fake npx invocation: $*" >&2
  exit 64
fi

mkdir -p "$HOME/.agents/skills/$skill" "$HOME/.claude/skills"
cat > "$HOME/.agents/skills/$skill/SKILL.md" <<'EOF_SKILL'
---
name: find-skills
description: E2E fake skill for Marketplace install regression.
---
# find-skills
EOF_SKILL
rm -f "$HOME/.claude/skills/$skill"
ln -s "../../.agents/skills/$skill" "$HOME/.claude/skills/$skill"
echo "Installation complete"
`,
  )
  chmodSync(fakeNpxPath, 0o755)
  return markerPath
}

/**
 * Wait until the renderer store has scanned the staged Claude Code agent dir.
 *
 * @param appWindow - Main Electron renderer window
 * @returns Promise that resolves when Claude Code is installable in the modal
 * @example
 * await waitForClaudeCodeAgent(appWindow)
 */
async function waitForClaudeCodeAgent(appWindow: Page): Promise<void> {
  await appWindow.waitForFunction(() => {
    const store = window.__store__
    const state = store?.getState() as
      | { agents?: { items?: Array<{ id: string; exists: boolean }> } }
      | undefined
    return state?.agents?.items?.some(
      (agent) => agent.id === 'claude-code' && agent.exists,
    )
  })
}

test('Marketplace Install works when Electron starts with sparse macOS GUI PATH', async ({
  isolatedHome,
}) => {
  // Stage the agent dir before Electron boots so the install modal can offer
  // Claude Code without touching the developer's real ~/.claude directory.
  mkdirSync(join(isolatedHome, '.agents', 'skills'), { recursive: true })
  mkdirSync(join(isolatedHome, '.claude', 'skills'), { recursive: true })
  const markerPath = stageFallbackNpx(isolatedHome)

  const repoRoot = resolve(__dirname, '..', '..')
  const mainEntry = resolve(repoRoot, 'out', 'main', 'index.mjs')
  const electronApp = await _electron.launch({
    args: [mainEntry],
    env: {
      ...process.env,
      HOME: isolatedHome,
      PATH: SPARSE_GUI_PATH,
      E2E_USERDATA_DIR: resolve(isolatedHome, 'userData'),
      E2E_DISABLE_UPDATE: '1',
      E2E_BACKGROUND_LAUNCH: process.env['E2E_BACKGROUND_LAUNCH'] ?? '1',
    },
  })

  try {
    const appWindow = await electronApp.firstWindow()
    await appWindow.waitForLoadState('domcontentloaded')
    await waitForClaudeCodeAgent(appWindow)

    // Drive the real Marketplace UI without relying on skills.sh or the real
    // skills CLI search endpoint. The Install button still goes through IPC,
    // skillsCliService, and child_process.spawn.
    await dispatchAction(appWindow, {
      type: 'marketplace/setMarketplaceSearchQuery',
      payload: 'find-skills',
    })
    await dispatchAction(appWindow, {
      type: 'marketplace/search/fulfilled',
      payload: [MARKETPLACE_SKILL],
      meta: {
        arg: 'find-skills',
        requestId: 'e2e-marketplace-install-path',
        requestStatus: 'fulfilled',
      },
    })

    await appWindow.getByRole('tab', { name: 'Marketplace' }).click()
    await appWindow
      .getByRole('button', { name: 'Install', exact: true })
      .first()
      .click()

    const dialog = appWindow.getByRole('dialog', { name: 'Install Skill' })
    await expect(dialog.getByText('find-skills')).toBeVisible()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()

    await expect
      .poll(() => existsSync(markerPath), { timeout: 10_000 })
      .toBe(true)
    expect(readFileSync(markerPath, 'utf-8')).toContain(
      `skills@${SKILLS_CLI_VERSION} add vercel-labs/skills`,
    )
    await expect(
      appWindow.getByRole('img', { name: /find-skills is installed/i }),
    ).toBeVisible()
  } finally {
    await electronApp.close()
  }
})
