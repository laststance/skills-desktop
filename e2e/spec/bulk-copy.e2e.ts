import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import {
  dispatchAction,
  getStoreState,
  refreshSkillsState,
  waitForInitialScan,
} from '../helpers/redux'

interface TargetAgent {
  id: string
  name: string
  path: string
}

/**
 * Build the SKILL.md body for a staged source skill.
 *
 * Deliberately a markdown `#` heading, NOT a `name:` frontmatter key: the
 * scanner derives skill identity from `name:` when present and otherwise falls
 * back to the folder basename (see bulk-delete.e2e.ts `preStageDummySkills`,
 * whose `# ${name}` skills are identified by basename). The bulk-copy modal
 * selects skills by basename via `selectSelectedSkillObjects`, so the heading
 * form keeps identity == basename while still giving each skill distinct bytes
 * to assert the *right* source landed at each destination.
 *
 * @param name - Skill folder basename, doubling as its scanned identity.
 * @returns SKILL.md contents unique to that skill.
 * @example sourceMarkerFor('bulk-copy-alpha') // => "# bulk-copy-alpha\n\nFixture…\n"
 */
function sourceMarkerFor(name: string): string {
  return `# ${name}\n\nFixture source skill for the bulk-copy E2E spec.\n`
}

/**
 * Pre-stage source-backed skills under the isolated HOME's universal source dir
 * (`~/.agents/skills/<name>`), each with a basename-identified SKILL.md.
 *
 * @param isolatedHome - E2E fixture HOME.
 * @param names - Skill basenames to create, in order.
 * @example preStageSourceSkills(home, ['bulk-copy-alpha', 'bulk-copy-beta'])
 */
function preStageSourceSkills(isolatedHome: string, names: string[]): void {
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  for (const name of names) {
    const skillDir = join(sourceDir, name)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), sourceMarkerFor(name))
  }
}

/**
 * Pick `count` distinct-path agents that can serve as bulk-copy targets.
 *
 * Excludes the universal source dir itself — the 13 universal agents share
 * `~/.agents/skills`, so copying a source skill "into" one of them resolves to
 * `<sourceDir>/<skill>` (the source) and the handler reports `Already exists`
 * (skills.ts:1158-1166). Dedups by path so IRON-RULE shared scan dirs (amp /
 * kimi-cli / replit) cannot let one tick write into another target's space. No
 * `exists` filter: the handler `mkdir -p`s the destination (skills.ts:1161), so
 * a not-installed agent is still a valid, faithful target.
 *
 * @param page - Playwright page bound to the renderer store.
 * @param sourceDir - Absolute universal source dir to exclude.
 * @param count - Number of distinct-path agents to return.
 * @returns Up to `count` agents with their id, display name, and scan path.
 */
async function pickDistinctTargetAgents(
  page: Parameters<typeof getStoreState>[0],
  sourceDir: string,
  count: number,
): Promise<TargetAgent[]> {
  return getStoreState(
    page,
    (state, params) => {
      const root = state as {
        agents: { items: Array<{ id: string; name: string; path: string }> }
      }
      const { sourceDirLiteral, countLiteral } = params as {
        sourceDirLiteral: string
        countLiteral: number
      }
      const seenPaths = new Set<string>()
      const picked: Array<{ id: string; name: string; path: string }> = []
      for (const agent of root.agents.items) {
        if (agent.path === sourceDirLiteral) continue
        if (seenPaths.has(agent.path)) continue
        seenPaths.add(agent.path)
        picked.push({ id: agent.id, name: agent.name, path: agent.path })
        if (picked.length === countLiteral) break
      }
      return picked
    },
    { sourceDirLiteral: sourceDir, countLiteral: count },
  )
}

/**
 * Read which staged skills the renderer store now knows about by name. Used as
 * a boundary assertion after `refreshSkillsState`: if the scanner ever names a
 * staged skill differently from its basename, `selectSelectedSkillObjects`
 * resolves to `[]`, the modal's Copy button stays disabled, and the UI click
 * would time out with an opaque failure. Asserting presence up front converts
 * that into a clear "staged skill missing from store" at the setup boundary.
 *
 * @param page - Playwright page bound to the renderer store.
 * @param names - Expected staged skill basenames.
 * @returns The subset of `names` present in `state.skills.items`.
 */
async function getPresentSkillNames(
  page: Parameters<typeof getStoreState>[0],
  names: string[],
): Promise<string[]> {
  return getStoreState(
    page,
    (state, expectedNames) => {
      const root = state as { skills: { items: Array<{ name: string }> } }
      const present = new Set(root.skills.items.map((skill) => skill.name))
      return (expectedNames as string[]).filter((name) => present.has(name))
    },
    names,
  )
}

/**
 * Bulk copy (issue #198) — fan the `copyToAgents` IPC out across the whole list
 * selection so every selected skill lands in every ticked agent.
 *
 * These specs are UI-driven on purpose. The single-skill IPC contract (symlink
 * vs directory branch, realpath round-trip, per-target `Already exists`) is
 * already locked by copy.e2e.ts; a `createAsyncThunk` cannot be dispatched from
 * `page.evaluate` anyway. What #198 ADDS — and what only an E2E can prove — is
 * (1) the multi-skill fan-out and (2) the SelectionToolbar → modal → thunk →
 * IPC → filesystem wiring. So we drive the real click path and assert on the
 * filesystem (deterministic) rather than the toast (timing-sensitive).
 *
 * Each test pre-stages its own source skills, so no azure-* snapshot dependency
 * and no offline skip is needed.
 */

test('the bulk Copy-to-Agents modal copies every selected skill into every ticked agent', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange — stage two fresh source skills, then make the renderer aware of
  // them so the modal's `selectSelectedSkillObjects` can resolve their paths.
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const skillNames = ['bulk-copy-alpha', 'bulk-copy-beta']
  preStageSourceSkills(isolatedHome, skillNames)

  await waitForInitialScan(appWindow)
  await refreshSkillsState(appWindow)

  // Boundary assertion — both staged skills must be in the store by basename,
  // else the selection resolves to [] and the Copy button never enables.
  expect(await getPresentSkillNames(appWindow, skillNames)).toEqual(skillNames)

  const targetAgents = await pickDistinctTargetAgents(appWindow, sourceDir, 2)
  expect(
    targetAgents,
    'expected two distinct-path target agents outside the universal source dir',
  ).toHaveLength(2)

  // Pre-condition the destinations are empty so the post-click existence checks
  // genuinely prove the click chain reached `fs.cp`, not a stale snapshot.
  for (const agent of targetAgents) {
    for (const skillName of skillNames) {
      expect(existsSync(join(agent.path, skillName))).toBe(false)
    }
  }

  // Act — enter bulk-select mode and tick both skills (global view is the
  // default; the "Copy to..." button renders only there). enterBulkSelectMode
  // first so selectAll is the last selection-affecting dispatch.
  await dispatchAction(appWindow, { type: 'ui/enterBulkSelectMode' })
  await dispatchAction(appWindow, {
    type: 'skills/selectAll',
    payload: skillNames,
  })

  // Open the modal from the toolbar's non-destructive bulk-copy button.
  await appWindow
    .getByRole('button', { name: 'Copy selected skills to agents' })
    .click()

  const dialog = appWindow.getByRole('dialog')
  await dialog
    .getByRole('heading', { name: 'Copy to Agents' })
    .waitFor({ state: 'visible', timeout: 5_000 })

  // Tick both target agents (checkbox aria-label is the agent display name).
  // Scope to the dialog: bulk mode also renders per-row skill checkboxes.
  for (const agent of targetAgents) {
    await dialog.getByRole('checkbox', { name: agent.name }).check()
  }

  // Primary button label is "Copy 2 skills to 2 agent(s)".
  await dialog
    .getByRole('button', { name: /^Copy 2 skills to 2 agent\(s\)$/ })
    .click()

  // Assert — the thunk awaits each skill's copyToAgents serially, fanning to the
  // ticked agents in order; the last serial write is the second skill into the
  // second agent. Poll that one, then read all four destinations synchronously.
  const lastWritten = join(targetAgents[1].path, skillNames[1], 'SKILL.md')
  await expect
    .poll(() => existsSync(lastWritten), { timeout: 10_000 })
    .toBe(true)

  // Every selected skill landed in every ticked agent, with the right bytes.
  for (const agent of targetAgents) {
    for (const skillName of skillNames) {
      const copiedSkillMd = join(agent.path, skillName, 'SKILL.md')
      expect(
        existsSync(copiedSkillMd),
        `expected ${skillName} copied into ${agent.id}`,
      ).toBe(true)
      expect(readFileSync(copiedSkillMd, 'utf-8')).toBe(
        sourceMarkerFor(skillName),
      )
    }
  }
})

test('a bulk copy keeps copying the rest when one skill already exists in one agent', async ({
  appWindow,
  isolatedHome,
}) => {
  // Arrange — two source skills and two distinct-path target agents.
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const skillNames = ['bulk-partial-alpha', 'bulk-partial-beta']
  const [alphaName, betaName] = skillNames
  preStageSourceSkills(isolatedHome, skillNames)

  await waitForInitialScan(appWindow)
  await refreshSkillsState(appWindow)

  expect(await getPresentSkillNames(appWindow, skillNames)).toEqual(skillNames)

  const targetAgents = await pickDistinctTargetAgents(appWindow, sourceDir, 2)
  expect(targetAgents).toHaveLength(2)
  const [occupiedAgent, freeAgent] = targetAgents

  // Pre-occupy ONLY alpha in the first agent with a sentinel. The handler's
  // `lstat(destPath)` will report `Already exists` for alpha→occupied while
  // every other (skill, agent) pair stays free — the asymmetric setup the
  // no-abort contract is proven against.
  const sentinelDir = join(occupiedAgent.path, alphaName)
  mkdirSync(sentinelDir, { recursive: true })
  const sentinelContent = `# pre-existing\nDO NOT OVERWRITE — collision sentinel.\n`
  writeFileSync(join(sentinelDir, 'SKILL.md'), sentinelContent)

  // Act — select both skills, open the modal, tick both agents, copy.
  await dispatchAction(appWindow, { type: 'ui/enterBulkSelectMode' })
  await dispatchAction(appWindow, {
    type: 'skills/selectAll',
    payload: skillNames,
  })

  await appWindow
    .getByRole('button', { name: 'Copy selected skills to agents' })
    .click()

  const dialog = appWindow.getByRole('dialog')
  await dialog
    .getByRole('heading', { name: 'Copy to Agents' })
    .waitFor({ state: 'visible', timeout: 5_000 })

  for (const agent of targetAgents) {
    await dialog.getByRole('checkbox', { name: agent.name }).check()
  }

  await dialog
    .getByRole('button', { name: /^Copy 2 skills to 2 agent\(s\)$/ })
    .click()

  // Assert — last serial write is beta→free; poll it, then read the matrix.
  const lastWritten = join(freeAgent.path, betaName, 'SKILL.md')
  await expect
    .poll(() => existsSync(lastWritten), { timeout: 10_000 })
    .toBe(true)

  // 1) Collision did NOT overwrite — the sentinel survives byte-for-byte. A
  //    regression that swapped `lstat` for `cp -f` shows up here as a mismatch.
  expect(readFileSync(join(sentinelDir, 'SKILL.md'), 'utf-8')).toBe(
    sentinelContent,
  )

  // 2) Per-skill no-abort — beta still reached the occupied agent even though
  //    alpha→occupied failed earlier in the same batch.
  const betaInOccupied = join(occupiedAgent.path, betaName, 'SKILL.md')
  expect(existsSync(betaInOccupied)).toBe(true)
  expect(readFileSync(betaInOccupied, 'utf-8')).toBe(sourceMarkerFor(betaName))

  // 3) Per-agent no-abort — alpha still reached the free agent even though
  //    alpha→occupied failed.
  const alphaInFree = join(freeAgent.path, alphaName, 'SKILL.md')
  expect(existsSync(alphaInFree)).toBe(true)
  expect(readFileSync(alphaInFree, 'utf-8')).toBe(sourceMarkerFor(alphaName))

  // 4) The free agent received both skills.
  expect(readFileSync(lastWritten, 'utf-8')).toBe(sourceMarkerFor(betaName))
})
