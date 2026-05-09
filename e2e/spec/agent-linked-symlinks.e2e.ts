import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import {
  dispatchAction,
  getStoreState,
  refreshSkillsState,
} from '../helpers/redux'

const AGENT_ID = 'codex'
const LINK_NAME = 'agent-only-linked-fixture'
const FRONTMATTER_NAME = 'frontmatter-name-must-not-win'
const EXTERNAL_SKILL_DESCRIPTION =
  'External linked skill used to guard agent-only symlink surfacing.'
const STORE_READY_TIMEOUT_MS = 10_000

/**
 * Waits for the renderer Redux store and initial agent scan to be ready.
 * @param page - Electron renderer page.
 * @returns Resolves when `agents.items` is populated and the skills scan is idle.
 * @example
 * await waitForStoreReady(appWindow)
 */
const waitForStoreReady = async (page: Page): Promise<void> => {
  await page.waitForFunction(
    () => {
      const store = window.__store__ ?? window.__store
      if (!store) return false
      const state = store.getState() as {
        agents?: { items?: unknown[]; loading?: boolean }
        skills?: { loading?: boolean }
      }
      return Boolean(
        state.agents?.items?.length &&
        state.agents.loading === false &&
        state.skills?.loading === false,
      )
    },
    undefined,
    { timeout: STORE_READY_TIMEOUT_MS },
  )
}

/**
 * Selects skill scan facts for one agent from the renderer store.
 * @param state - Renderer Redux root state.
 * @param args - Target agent id and skill name.
 * @returns
 * - `null` when the skill is absent from the store.
 * - A compact skill/slot summary when present.
 * @example
 * selectAgentLinkedSkillFacts(state, {
 *   agentId: 'codex',
 *   skillName: 'agent-only-linked-fixture',
 * })
 * // => { name: 'agent-only-linked-fixture', slot: { status: 'valid' } }
 */
const selectAgentLinkedSkillFacts = (
  state: unknown,
  args: { agentId: string; skillName: string },
): {
  name: string
  path: string
  description: string
  isSource: boolean
  isOrphan: boolean
  symlinkCount: number
  slot:
    | {
        agentId: string
        status: 'valid' | 'broken' | 'missing'
        isLocal: boolean
        linkPath: string
        targetPath?: string
      }
    | undefined
} | null => {
  const root = state as {
    skills: {
      items: Array<{
        name: string
        path: string
        description: string
        isSource: boolean
        isOrphan: boolean
        symlinkCount: number
        symlinks: Array<{
          agentId: string
          status: 'valid' | 'broken' | 'missing'
          isLocal: boolean
          linkPath: string
          targetPath?: string
        }>
      }>
    }
  }
  const skill = root.skills.items.find((item) => item.name === args.skillName)
  if (!skill) return null
  return {
    name: skill.name,
    path: skill.path,
    description: skill.description,
    isSource: skill.isSource,
    isOrphan: skill.isOrphan,
    symlinkCount: skill.symlinkCount,
    slot: (() => {
      const symlink = skill.symlinks.find(
        (item) => item.agentId === args.agentId,
      )
      if (!symlink) return undefined
      return {
        agentId: symlink.agentId,
        status: symlink.status,
        isLocal: symlink.isLocal,
        linkPath: symlink.linkPath,
        targetPath: symlink.targetPath,
      }
    })(),
  }
}

test('agent-only valid symlinks appear as linked skills in the selected agent view', async ({
  appWindow,
  isolatedHome,
}) => {
  await waitForStoreReady(appWindow)

  const externalSkillPath = join(isolatedHome, 'external-skills', LINK_NAME)
  const codexSkillsDir = join(isolatedHome, '.codex', 'skills')
  const codexLinkPath = join(codexSkillsDir, LINK_NAME)

  mkdirSync(externalSkillPath, { recursive: true })
  mkdirSync(codexSkillsDir, { recursive: true })
  writeFileSync(
    join(externalSkillPath, 'SKILL.md'),
    [
      '---',
      `name: ${FRONTMATTER_NAME}`,
      `description: ${EXTERNAL_SKILL_DESCRIPTION}`,
      '---',
      '',
    ].join('\n'),
  )
  symlinkSync(externalSkillPath, codexLinkPath)

  expect(lstatSync(codexLinkPath).isSymbolicLink()).toBe(true)

  await refreshSkillsState(appWindow)
  await dispatchAction(appWindow, {
    type: 'ui/selectAgent',
    payload: AGENT_ID,
  })

  const scanFacts = await getStoreState(
    appWindow,
    selectAgentLinkedSkillFacts,
    { agentId: AGENT_ID, skillName: LINK_NAME },
  )
  expect(scanFacts).toEqual({
    name: LINK_NAME,
    path: externalSkillPath,
    description: EXTERNAL_SKILL_DESCRIPTION,
    isSource: false,
    isOrphan: false,
    symlinkCount: 1,
    slot: {
      agentId: AGENT_ID,
      status: 'valid',
      isLocal: false,
      linkPath: codexLinkPath,
      targetPath: externalSkillPath,
    },
  })

  await expect(
    appWindow.getByRole('heading', {
      name: new RegExp(`Linked skill ${LINK_NAME}`),
    }),
  ).toBeVisible()
  await expect(
    appWindow.getByRole('heading', {
      name: new RegExp(FRONTMATTER_NAME),
    }),
  ).toHaveCount(0)
})
