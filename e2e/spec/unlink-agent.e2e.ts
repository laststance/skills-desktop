import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

import { test, expect } from '../fixtures/electron-app'
import { getStoreState, refreshSkillsState } from '../helpers/redux'

interface SymlinkSnapshot {
  agentId: string
  status: 'valid' | 'broken' | 'missing'
  isLocal: boolean
  linkPath: string
}

const AZURE_AI_NAME = 'azure-ai'

/**
 * Pre-stage `count` source-backed dummy skills under the isolated HOME's
 * universal source dir (`~/.agents/skills/<name>`) AND create symlinks for
 * each one inside `agentPath` (`<agentPath>/<name> → <sourcePath>`).
 *
 * The bulk-unlink handler discriminates on `lstat` kind — symlinks succeed,
 * local directories are refused. Pre-staging real symlinks is what exercises
 * the happy path; using fresh names (vs. the snapshot's azure-* set) keeps
 * the test independent of skills-CLI install behavior.
 *
 * Returns the names in creation order so the caller can build the IPC payload
 * with the same iteration order and assert on it.
 */
function preStageLinkedSkills(
  isolatedHome: string,
  agentPath: string,
  count: number,
  prefix: string,
): string[] {
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  mkdirSync(agentPath, { recursive: true })
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = `${prefix}-${String(i).padStart(2, '0')}`
    const skillSourcePath = join(sourceDir, name)
    mkdirSync(skillSourcePath, { recursive: true })
    writeFileSync(
      join(skillSourcePath, 'SKILL.md'),
      `# ${name}\n\nFixture skill for the unlink-agent E2E spec.\n`,
    )
    symlinkSync(skillSourcePath, join(agentPath, name))
    names.push(name)
  }
  return names
}

/**
 * Phase-2 spec covering the three unlink-style IPCs that operate on agent-side
 * link paths without writing to trash:
 *   - `SKILLS_UNLINK_FROM_AGENT`        (single)
 *   - `SKILLS_UNLINK_MANY_FROM_AGENT`   (batch)
 *   - `SKILLS_REMOVE_ALL_FROM_AGENT`    (entire agent dir → OS trash)
 *
 * Unlink is benign by contract — it only removes the agent-side
 * symlink/folder and never touches the source under `~/.agents/skills/`.
 * No tombstone, no undo. The third op IS destructive and is gated by the
 * IRON RULE check (`isSharedAgentPath`) — when an agent's scanDir is itself
 * a symlink alias to SOURCE_DIR, deleting it would cascade into every
 * universal agent. Test 3 below pre-stages exactly that aliasing layout to
 * confirm the refusal path is wired and that no shared bytes are touched.
 *
 * Each test runs in a fresh isolated HOME via the snapshot/restore fixture so
 * trash state, leftover symlinks, and pre-staged aliases never leak across
 * tests.
 */

test('unlinkFromAgent removes one valid azure-ai symlink without touching the source or other agents', async ({
  appWindow,
  isolatedHome,
}) => {
  await appWindow.waitForFunction(
    () => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        skills?: { items?: unknown[] }
        agents?: { items?: unknown[] }
      }
      return Boolean(state.skills?.items?.length && state.agents?.items?.length)
    },
    undefined,
    { timeout: 10_000 },
  )

  const expectedSourcePath = join(
    isolatedHome,
    '.agents',
    'skills',
    AZURE_AI_NAME,
  )

  // Selector source is re-evaluated in renderer context (see redux.ts:23) so
  // closures over module-level constants are NOT preserved — `'azure-ai'`
  // must be inlined as a literal inside the selector body.
  const initialSymlinks = await getStoreState(
    appWindow,
    (state): SymlinkSnapshot[] => {
      const root = state as {
        skills: {
          items: Array<{ name: string; symlinks: SymlinkSnapshot[] }>
        }
      }
      const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
      return azure?.symlinks ?? []
    },
  )

  const target = initialSymlinks.find((symlink) => symlink.status === 'valid')
  expect(
    target,
    'expected at least one valid azure-ai symlink — adjust global-setup if --global no longer creates per-agent links',
  ).toBeTruthy()
  if (!target) return

  // Other valid symlinks act as the "untouched" control set — none of them
  // should be removed by a single-agent unlink.
  const otherValidSymlinks = initialSymlinks.filter(
    (symlink) =>
      symlink.status === 'valid' && symlink.linkPath !== target.linkPath,
  )

  const ipcResult = await appWindow.evaluate(
    async (args: { skillName: string; agentId: string; linkPath: string }) =>
      window.electron.skills.unlinkFromAgent(args),
    {
      skillName: AZURE_AI_NAME,
      agentId: target.agentId,
      linkPath: target.linkPath,
    },
  )

  expect(ipcResult.success).toBe(true)
  expect(ipcResult.error).toBeUndefined()

  // FS — target link gone, source dir intact, every other agent's link still
  // present. The third assertion is the load-bearing one: a regression that
  // unlinks too aggressively (e.g. cascading the realpath target) would wipe
  // every agent in this loop and the diff would be obvious.
  expect(existsSync(target.linkPath)).toBe(false)
  expect(existsSync(expectedSourcePath)).toBe(true)
  expect(existsSync(join(expectedSourcePath, 'SKILL.md'))).toBe(true)
  for (const other of otherValidSymlinks) {
    expect(
      existsSync(other.linkPath),
      `expected ${other.linkPath} to remain after unlinking only ${target.agentId}`,
    ).toBe(true)
  }

  // Redux — refresh and confirm the unlinked agent now reads as `missing`
  // while every other previously-valid agent remains `valid`. Until refresh
  // runs the store still holds the pre-unlink snapshot.
  await refreshSkillsState(appWindow)
  const refreshedAgentIds = otherValidSymlinks.map((symlink) => symlink.agentId)
  const refreshedSymlinks = await getStoreState(
    appWindow,
    (state): SymlinkSnapshot[] => {
      const root = state as {
        skills: {
          items: Array<{ name: string; symlinks: SymlinkSnapshot[] }>
        }
      }
      const azure = root.skills.items.find((skill) => skill.name === 'azure-ai')
      return azure?.symlinks ?? []
    },
  )
  const targetAfter = refreshedSymlinks.find(
    (symlink) => symlink.agentId === target.agentId,
  )
  expect(targetAfter?.status).toBe('missing')
  for (const otherId of refreshedAgentIds) {
    const stillValid = refreshedSymlinks.find(
      (symlink) => symlink.agentId === otherId,
    )
    expect(stillValid?.status).toBe('valid')
  }
})

test('unlinkManyFromAgent removes every pre-staged symlink and leaves source dirs untouched', async ({
  appWindow,
  isolatedHome,
}) => {
  // Pre-stage BEFORE waiting for the renderer scan. The handler reads from
  // disk independently of the renderer's scan, so it doesn't matter whether
  // these landed before or after the initial fetchSkills.
  const claudeAgentPath = join(isolatedHome, '.claude', 'skills')
  const skillNames = preStageLinkedSkills(
    isolatedHome,
    claudeAgentPath,
    3,
    'unlink-many',
  )

  await appWindow.waitForFunction(
    () => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        skills?: { items?: unknown[] }
        agents?: { items?: unknown[] }
      }
      return Boolean(state.skills?.items?.length && state.agents?.items?.length)
    },
    undefined,
    { timeout: 10_000 },
  )

  // Sanity — every pre-staged symlink is in place before the IPC fires.
  for (const name of skillNames) {
    const linkPath = join(claudeAgentPath, name)
    expect(existsSync(linkPath)).toBe(true)
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
  }

  const result = await appWindow.evaluate(
    async (args: { agentId: string; items: Array<{ skillName: string }> }) =>
      window.electron.skills.unlinkManyFromAgent(args),
    {
      agentId: 'claude-code',
      items: skillNames.map((skillName) => ({ skillName })),
    },
  )

  expect(result.items).toHaveLength(skillNames.length)
  for (const [index, item] of result.items.entries()) {
    expect(item.outcome).toBe('unlinked')
    expect(item.skillName).toBe(skillNames[index])
  }

  // FS — every link gone, every source dir still present. Unlink is benign:
  // a regression that hard-rms the realpath target (instead of just the
  // symlink) would surface here as missing source dirs.
  for (const name of skillNames) {
    expect(existsSync(join(claudeAgentPath, name))).toBe(false)
    const sourcePath = join(isolatedHome, '.agents', 'skills', name)
    expect(existsSync(sourcePath)).toBe(true)
    expect(existsSync(join(sourcePath, 'SKILL.md'))).toBe(true)
  }
})

test('removeAllFromAgent refuses when the agent path is a symlink alias to the universal source', async ({
  appWindow,
  isolatedHome,
}) => {
  // Pre-stage the IRON RULE trigger condition: an agent's scanDir is itself
  // a symlink alias to SOURCE_DIR. Without this layout the handler's
  // validatePath + isSharedAgentPath chain wouldn't fire — picking cursor
  // because it's listed in UNIVERSAL_AGENT_IDS so global-setup never created
  // its scanDir, leaving us a clean tempdir corner to alias without losing
  // any pre-existing fixture state. Parent (`.cursor`) doesn't exist yet
  // either, so mkdirSync first or symlinkSync would ENOENT.
  const sourceDir = join(isolatedHome, '.agents', 'skills')
  const cursorAgentPath = join(isolatedHome, '.cursor', 'skills')
  mkdirSync(dirname(cursorAgentPath), { recursive: true })
  rmSync(cursorAgentPath, { recursive: true, force: true })
  symlinkSync(sourceDir, cursorAgentPath)

  // Capture the SOURCE_DIR contents pre-call so we can assert nothing inside
  // it moved when the refusal path fires.
  const sourceContentsBefore = readdirSync(sourceDir).sort()
  expect(
    sourceContentsBefore.length,
    'expected the snapshot source dir to be populated by global-setup',
  ).toBeGreaterThan(0)

  await appWindow.waitForFunction(
    () => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        skills?: { items?: unknown[] }
        agents?: { items?: unknown[] }
      }
      return Boolean(state.skills?.items?.length && state.agents?.items?.length)
    },
    undefined,
    { timeout: 10_000 },
  )

  const result = await appWindow.evaluate(
    async (args: { agentId: string; agentPath: string }) =>
      window.electron.skills.removeAllFromAgent(args),
    { agentId: 'cursor', agentPath: cursorAgentPath },
  )

  expect(result.success).toBe(false)
  expect(result.removedCount).toBe(0)
  // Match the human-readable refusal copy from skills.ts:184. Pinning the
  // exact message keeps a quiet wording change from silently passing this
  // test as a generic-error catch.
  expect(result.error).toMatch(/Refusing to delete a shared skills folder/)

  // FS — the symlink alias itself is still in place (handler short-circuits
  // before any trashItem call) and SOURCE_DIR is byte-for-byte untouched.
  expect(existsSync(cursorAgentPath)).toBe(true)
  expect(lstatSync(cursorAgentPath).isSymbolicLink()).toBe(true)
  const sourceContentsAfter = readdirSync(sourceDir).sort()
  expect(sourceContentsAfter).toEqual(sourceContentsBefore)
})
