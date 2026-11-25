import {
  chmodSync,
  existsSync,
  mkdirSync,
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect, launchIsolatedElectron } from '../fixtures/electron-app'
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
  const lockPath = join(home, '.agents', '.skill-lock.json')
  const lock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, 'utf-8'))
    : { version: 3 }
  writeFileSync(
    join(home, '.e2e-installed-lock.json'),
    JSON.stringify({
      ...lock,
      skills: {
        ...lock.skills,
        'find-skills': {
          source: 'vercel-labs/skills',
          sourceType: 'github',
          sourceUrl: 'https://github.com/vercel-labs/skills.git',
        },
      },
    }),
  )
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
mv "$HOME/.e2e-installed-lock.json" "$HOME/.agents/.skill-lock.json"
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

/** Provide a catalogue result while exercising the real install dialog, IPC and child process.
 * @example await showMarketplaceResult(page, MARKETPLACE_SKILL)
 */
async function showMarketplaceResult(
  page: Page,
  skill: typeof MARKETPLACE_SKILL,
): Promise<void> {
  const meta = { arg: skill.name, requestId: `install-${skill.name}` }
  await dispatchAction(page, {
    type: 'marketplace/search/pending',
    meta: { ...meta, requestStatus: 'pending' },
  })
  await dispatchAction(page, {
    type: 'marketplace/search/fulfilled',
    payload: [skill],
    meta: { ...meta, requestStatus: 'fulfilled' },
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

  const electronApp = await launchIsolatedElectron(isolatedHome, {
    PATH: SPARSE_GUI_PATH,
  })

  try {
    // Arrange — boot the window and wait until Claude Code is installable.
    const appWindow = await electronApp.firstWindow()
    await appWindow.waitForLoadState('domcontentloaded')
    await waitForClaudeCodeAgent(appWindow)

    // Seed the Marketplace search results without hitting skills.sh. The
    // Install button below still goes through IPC, skillsCliService, and
    // child_process.spawn.
    await showMarketplaceResult(appWindow, MARKETPLACE_SKILL)

    // Act — open the Marketplace tab and confirm the install through the dialog.
    await appWindow.getByRole('tab', { name: 'Marketplace' }).click()
    await appWindow
      .getByRole('button', { name: 'Install', exact: true })
      .first()
      .click()

    const dialog = appWindow.getByRole('dialog', { name: 'Install Skill' })
    await expect(dialog.getByText('find-skills')).toBeVisible()
    await dialog.getByRole('button', { name: 'Install', exact: true }).click()

    // Assert — the fake npx ran with the pinned CLI version (SKILLS_CLI_VERSION
    // is '1.7.4' in src/shared/constants.ts; hardcoded here so this test pins
    // the literal command rather than computing the expectation from the same
    // constant the production command builds from) and the installed badge shows.
    await expect
      .poll(() => existsSync(markerPath), { timeout: 10_000 })
      .toBe(true)
    expect(readFileSync(markerPath, 'utf-8')).toContain(
      'skills@1.7.4 add vercel-labs/skills',
    )
    await expect(
      appWindow.getByRole('img', { name: /find-skills is installed/i }),
    ).toBeVisible()
  } finally {
    await electronApp.close()
  }
})

test('Marketplace installs into the shared folder and links only the chosen agents with the pinned CLI', async ({
  isolatedHome,
}) => {
  test.setTimeout(120_000)
  // Arrange. The catalogue points at a local skill collection so its contents stay deterministic.
  const collection = join(isolatedHome, 'collection')
  const claudeConfig = join(isolatedHome, 'configured-claude')
  const claude = join(claudeConfig, 'skills')
  const goose = join(isolatedHome, '.config', 'goose', 'skills')
  const shared = join(isolatedHome, '.agents', 'skills')
  for (const name of ['qa-shared', 'qa-linked']) {
    const folder = join(collection, 'skills', name)
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, 'SKILL.md'),
      `---\nname: ${name}\ndescription: An install fixture.\n---\n`,
    )
  }
  for (const dir of [claude, goose, shared]) mkdirSync(dir, { recursive: true })
  const stateDir = join(isolatedHome, 'qa-state')
  const app = await launchIsolatedElectron(isolatedHome, {
    XDG_STATE_HOME: stateDir,
    CLAUDE_CONFIG_DIR: claudeConfig,
    DISABLE_TELEMETRY: '1',
  })
  try {
    const page = await app.firstWindow()
    await waitForClaudeCodeAgent(page)
    await page.getByRole('tab', { name: 'Marketplace' }).click()
    for (const name of ['qa-linked', 'qa-shared']) {
      // Act through the same Marketplace control a user presses.
      await showMarketplaceResult(page, {
        ...MARKETPLACE_SKILL,
        name,
        repo: collection,
      })
      await page
        .getByRole('button', { name: 'Install', exact: true })
        .first()
        .click()
      const dialog = page.getByRole('dialog', { name: 'Install Skill' })
      if (name === 'qa-shared')
        await dialog.getByRole('radio', { name: 'Universal only' }).click()
      await dialog.getByRole('button', { name: 'Install', exact: true }).click()
      // A local-collection install records no repository in the CLI lock, so
      // the scanner leaves `source` unset and the row lands on the
      // "Installed source unknown" state instead of the Installed badge —
      // that hint only renders once the rescan registers the occupied name.
      await expect(page.getByText('Installed source unknown')).toBeVisible({
        timeout: 50_000,
      })
    }

    // Assert that the installed view reads the same configured directory the CLI wrote.
    await page
      .getByRole('button', { name: /Filter skills by Claude Code/ })
      .click()
    await expect(page.locator('[data-skill-name="qa-linked"]')).toBeVisible()
    await expect(page.locator('[data-skill-name="qa-shared"]')).toHaveCount(0)
    // Check physical folders, exact link target, untouched agent and the CLI's own lock.
    expect(
      readFileSync(join(shared, 'qa-linked', 'SKILL.md'), 'utf8'),
    ).toContain('name: qa-linked')
    expect(
      readFileSync(join(shared, 'qa-shared', 'SKILL.md'), 'utf8'),
    ).toContain('name: qa-shared')
    expect(lstatSync(join(claude, 'qa-linked')).isSymbolicLink()).toBe(true)
    expect(realpathSync(join(claude, 'qa-linked'))).toBe(
      realpathSync(join(shared, 'qa-linked')),
    )
    expect(
      lstatSync(join(isolatedHome, '.claude', 'skills', 'qa-linked'), {
        throwIfNoEntry: false,
      }),
    ).toBeUndefined()
    expect(
      lstatSync(join(claude, 'qa-shared'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      lstatSync(join(goose, 'qa-linked'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      lstatSync(join(goose, 'qa-shared'), { throwIfNoEntry: false }),
    ).toBeUndefined()
    expect(
      Object.keys(
        JSON.parse(
          readFileSync(join(stateDir, 'skills', '.skill-lock.json'), 'utf8'),
        ).skills,
      ).sort(),
    ).toEqual(['qa-linked', 'qa-shared'])
  } finally {
    await app.close()
  }
})
