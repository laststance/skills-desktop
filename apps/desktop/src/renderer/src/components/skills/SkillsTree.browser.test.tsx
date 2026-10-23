import { configureStore } from '@reduxjs/toolkit'
import { StrictMode, useState } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { SkillFilesProvider } from '@/renderer/src/hooks/SkillFilesProvider'
import agents from '@/renderer/src/redux/slices/agentsSlice'
import bookmarks from '@/renderer/src/redux/slices/bookmarkSlice'
import protect from '@/renderer/src/redux/slices/protectSlice'
import skills, {
  fetchSkills,
  inspectSkillFile,
} from '@/renderer/src/redux/slices/skillsSlice'
import ui, {
  selectAgent,
  toggleSortOrder,
} from '@/renderer/src/redux/slices/uiSlice'
import type { SkillFilesListing } from '@/shared/skillFiles'
import {
  toAbsolutePath,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toPosixRelativePath,
  toSkillName,
  toSymlinkCount,
  type Skill,
} from '@/shared/types'
import '@/renderer/src/styles/globals.css'

import { SkillsTree } from './SkillsTree'

const alpha: Skill = {
  name: toSkillName('alpha'),
  path: toAbsolutePath('/skills/alpha'),
  description: '',
  symlinks: [],
  symlinkCount: toSymlinkCount(0),
  isSource: true,
  isOrphan: false,
}
const beta: Skill = {
  ...alpha,
  name: toSkillName('beta'),
  path: toAbsolutePath('/skills/beta'),
}
const file = {
  name: toFileName('a\\b%.md'),
  path: toAbsolutePath('/skills/alpha/guides/a\\b%.md'),
  relativePath: toPosixRelativePath('guides/a\\b%.md'),
  extension: toFileExtension('.md'),
  size: toFileSizeBytes(10),
  previewable: 'text' as const,
}
const listing: SkillFilesListing = {
  status: 'complete',
  files: [file],
  issues: [],
  observedEntries: 2,
}
const listDetailed = vi.fn().mockResolvedValue(listing)
const cancelList = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  listDetailed.mockReset().mockResolvedValue(listing)
  cancelList.mockClear()
  vi.stubGlobal('electron', {
    files: { listDetailed, cancelList },
    skills: { getAll: vi.fn().mockResolvedValue([alpha, beta]) },
  })
})
afterEach(() => vi.unstubAllGlobals())

/** Mounts the real public Pierre model with the production virtualizer and StrictMode lifecycle.
 * @example const { screen, store } = await fixture()
 */
async function fixture(selected = false, items = [alpha, beta]) {
  const store = configureStore({
    reducer: { skills, ui, agents, bookmarks, protect },
  })
  store.dispatch(fetchSkills.fulfilled(items, 'seed', undefined))
  if (selected)
    store.dispatch(inspectSkillFile({ skill: alpha, path: file.path }))
  function Harness() {
    const [collapse, setCollapse] = useState(0)
    const [expanded, setExpanded] = useState(false)
    const [visible, setVisible] = useState(true)
    return (
      <>
        <button
          type="button"
          disabled={!expanded}
          onClick={() => setCollapse((value) => value + 1)}
        >
          Collapse all
        </button>
        <div style={{ height: 220, width: 264 }}>
          {visible && (
            <SkillsTree
              collapseToken={collapse}
              onExpandedChange={(expanded) => setExpanded(expanded)}
            />
          )}
        </div>
        <button type="button">After tree</button>
        <button type="button" onClick={() => setVisible(false)}>
          Hide tree
        </button>
      </>
    )
  }
  const screen = await render(
    <StrictMode>
      <Provider store={store}>
        <SkillFilesProvider>
          <Harness />
        </SkillFilesProvider>
      </Provider>
    </StrictMode>,
  )
  return { screen, store }
}

test('renders 44px skill roots without listing collapsed skills and focuses without inspecting', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  screen.getByRole('tree').element().focus()
  await userEvent.keyboard('{Home}{ArrowDown}')
  // Assert
  expect(listDetailed).not.toHaveBeenCalled()
  expect(store.getState().skills.selectedSkill).toBeNull()
  const root = screen.getByRole('treeitem', { name: 'beta', exact: true })
  await expect.element(root).toHaveAttribute('data-focused', 'true')
  expect(root.element().getBoundingClientRect().height).toBe(44)
  await expect.element(root).toHaveAttribute('aria-level', '1')
  await expect.element(root).toHaveAttribute('aria-posinset', '2')
})

test('expands once, keeps 36px children, and activates a literal backslash filename atomically', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await screen.getByRole('treeitem', { name: 'guides', exact: true }).click()
  await screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true }).click()
  // Assert
  expect(listDetailed).toHaveBeenCalledTimes(1)
  expect(store.getState().skills.selectedSkill?.path).toBe('/skills/alpha')
  expect(store.getState().skills.inspectedFile?.path).toBe(
    '/skills/alpha/guides/a\\b%.md',
  )
  expect(store.getState().skills.inspectorTabOverride).toBe('files')
  const child = screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true })
  expect(child.element().getBoundingClientRect().height).toBe(36)
  await expect.element(child).toHaveAttribute('aria-level', '3')
  expect(screen.getByRole('tree').element().scrollWidth).toBeLessThanOrEqual(
    264,
  )
})

test('collapses all without IPC and restores focused descendants to their root', async () => {
  // Arrange
  const { screen } = await fixture()
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await screen.getByRole('treeitem', { name: 'guides', exact: true }).click()
  await screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true }).click()
  // Act
  await screen
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click()
  // Assert
  await expect
    .element(screen.getByRole('treeitem', { name: 'alpha', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  expect(listDetailed).toHaveBeenCalledTimes(1)
  await expect
    .element(screen.getByRole('treeitem', { name: 'alpha', exact: true }))
    .toHaveAttribute('data-focused', 'true')
})

test('reveals the inspected file on first entry without moving DOM focus', async () => {
  // Arrange / Act
  const { screen } = await fixture(true)
  // Assert
  await expect
    .element(screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true }))
    .toBeVisible()
  expect(listDetailed).toHaveBeenCalledTimes(1)
  expect(document.activeElement?.getAttribute('role')).not.toBe('tree')
})

test('keeps another root expanded while a delayed first-entry file reveal completes', async () => {
  // Arrange
  let release: (value: SkillFilesListing) => void = () => undefined
  const pending = new Promise<SkillFilesListing>((resolve) => {
    release = resolve
  })
  listDetailed.mockImplementation(async (request) =>
    request.root === alpha.path ? pending : { ...listing, files: [] },
  )
  const { screen } = await fixture(true)
  await screen.getByRole('button', { name: 'Expand beta', exact: true }).click()
  // Act
  release(listing)
  // Assert
  await expect
    .element(screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true }))
    .toBeVisible()
  await expect
    .element(screen.getByRole('treeitem', { name: 'beta', exact: true }))
    .toHaveAttribute('aria-expanded', 'true')
})

test('disables Collapse all when the expanded tree is removed from the panel', async () => {
  // Arrange
  const { screen } = await fixture()
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await expect
    .element(screen.getByRole('button', { name: 'Collapse all', exact: true }))
    .toBeEnabled()
  // Act
  await screen.getByRole('button', { name: 'Hide tree', exact: true }).click()
  // Assert
  await expect
    .element(screen.getByRole('button', { name: 'Collapse all', exact: true }))
    .toBeDisabled()
})

test('virtualizes a thousand roots and keeps End focus visible', async () => {
  // Arrange
  const items = Array.from({ length: 1000 }, (_, index) => ({
    ...alpha,
    name: toSkillName(`skill-${index}`),
    path: toAbsolutePath(`/skills/${index}`),
  }))
  const { screen } = await fixture(false, items)
  // Act
  screen.getByRole('tree').element().focus()
  await userEvent.keyboard('{End}')
  // Assert
  await expect
    .element(screen.getByRole('treeitem', { name: 'skill-999', exact: true }))
    .toBeVisible()
  expect(document.querySelectorAll('[role="treeitem"]').length).toBeLessThan(30)
  expect(listDetailed).not.toHaveBeenCalled()
})

test('keyboard disclosure and file activation leave bulk selection unchanged and Tab exits the tree', async () => {
  // Arrange
  const { screen, store } = await fixture()
  screen.getByRole('tree').element().focus()
  // Act
  await userEvent.keyboard('{Home}{ArrowRight}')
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toBeVisible()
  await userEvent.keyboard('{ArrowDown}{ArrowRight}{ArrowDown}{Enter}')
  // Assert
  expect(store.getState().skills.inspectedFile?.path).toBe(
    '/skills/alpha/guides/a\\b%.md',
  )
  expect(store.getState().skills.selectedSkillNames).toEqual([])
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}{Tab}')
  await expect
    .element(screen.getByRole('button', { name: 'After tree' }))
    .toHaveFocus()
})

test('Collapse all wins over a delayed first-entry file reveal', async () => {
  // Arrange
  let release: (value: SkillFilesListing) => void = () => undefined
  listDetailed.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const { screen } = await fixture(true)
  await expect
    .element(screen.getByRole('button', { name: 'Collapse all', exact: true }))
    .toBeEnabled()
  // Act
  await screen
    .getByRole('button', { name: 'Collapse all', exact: true })
    .click()
  release(listing)
  // Assert
  await expect
    .element(screen.getByRole('treeitem', { name: 'alpha', exact: true }))
    .toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.getByRole('treeitem', { name: 'a\\b%.md', exact: true }).query(),
  ).toBeNull()
  expect(listDetailed).toHaveBeenCalledTimes(1)
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toBeVisible()
  expect(listDetailed).toHaveBeenCalledTimes(1)
})

test('root keyboard menus allow locking and adding a skill without assigning child mutation actions', async () => {
  // Arrange
  const { screen, store } = await fixture()
  screen.getByRole('tree').element().focus()
  // Act
  await userEvent.keyboard('{Home}{Shift>}{F10}{/Shift}')
  await screen.getByRole('menuitem', { name: 'Lock', exact: true }).click()
  // Assert
  expect(store.getState().protect.items.map((entry) => entry.name)).toEqual([
    'alpha',
  ])
  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  await expect
    .element(screen.getByRole('menuitem', { name: 'Delete…', exact: true }))
    .toHaveAttribute('data-disabled', '')
  await screen.getByRole('menuitem', { name: 'Unlock', exact: true }).click()
  await userEvent.keyboard('{Shift>}{F10}{/Shift}')
  await screen
    .getByRole('menuitem', { name: 'Add to agents…', exact: true })
    .click()
  expect(store.getState().skills.skillToAddSymlinks?.name).toBe('alpha')
})

test('keeps readable files after a partial listing and offers an explicit retry', async () => {
  // Arrange
  listDetailed.mockResolvedValueOnce({
    ...listing,
    status: 'partial',
    issues: [{ relativePath: 'private', code: 'denied' }],
  })
  const { screen } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toBeVisible()
  await screen
    .getByRole('button', { name: 'Actions for alpha', exact: true })
    .click()
  await screen
    .getByRole('menuitem', { name: 'Retry loading files', exact: true })
    .click()
  // Assert
  expect(listDetailed).toHaveBeenCalledTimes(2)
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toBeVisible()
})

test('root Space and Shift range select only skills while Enter inspects without toggling them', async () => {
  // Arrange
  const { screen, store } = await fixture()
  screen.getByRole('tree').element().focus()
  // Act
  await userEvent.keyboard('{Home} {ArrowDown}{Shift>} {/Shift}{Enter}')
  // Assert
  expect(store.getState().skills.selectedSkillNames).toEqual(['alpha', 'beta'])
  expect(store.getState().skills.selectedSkill?.name).toBe('beta')
  await screen
    .getByRole('checkbox', { name: 'Select alpha', exact: true })
    .click()
  expect(store.getState().skills.selectedSkillNames).toEqual(['beta'])
})

test('a root Delete menu stages the reviewed dialog without deleting a child file', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Actions for alpha', exact: true })
    .click()
  await screen.getByRole('menuitem', { name: 'Delete…', exact: true }).click()
  // Assert
  expect(store.getState().ui.bulkConfirm).toMatchObject({
    kind: 'delete',
    origin: 'row',
    skillNames: ['alpha'],
  })
})

test('a missing-root notice requests Rescan instead of retrying the old folder', async () => {
  // Arrange
  listDetailed.mockResolvedValueOnce({
    status: 'error',
    files: [],
    issues: [],
    observedEntries: 0,
    code: 'missing',
  })
  const { screen, store } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await screen
    .getByRole('treeitem', {
      name: 'Skill folder is missing · Rescan',
      exact: true,
    })
    .click()
  // Assert
  await expect.poll(() => store.getState().skills.filesGeneration).toBe(1)
})

test('keeps root ordering synchronized with the existing name sort control', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  store.dispatch(toggleSortOrder())
  screen.getByRole('tree').element().focus()
  await userEvent.keyboard('{Home}{Enter}')
  // Assert
  expect(store.getState().skills.selectedSkill?.name).toBe('beta')
})

test('adds and removes bookmarks from the root menu without changing file navigation', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Actions for alpha', exact: true })
    .click()
  await screen.getByRole('menuitem', { name: 'Bookmark', exact: true }).click()
  // Assert
  expect(store.getState().bookmarks.items.map((entry) => entry.name)).toEqual([
    'alpha',
  ])
  await screen
    .getByRole('button', { name: 'Actions for alpha', exact: true })
    .click()
  await screen
    .getByRole('menuitem', { name: 'Remove bookmark', exact: true })
    .click()
  expect(store.getState().bookmarks.items).toEqual([])
})

test('opens the root context menu and stages agent copy and unlink with the same root identity', async () => {
  // Arrange
  const linked = {
    ...alpha,
    symlinks: [
      {
        agentId: 'cursor' as const,
        agentName: 'Cursor' as const,
        status: 'valid' as const,
        linkPath: toAbsolutePath('/cursor/skills/alpha'),
        targetPath: alpha.path,
        isLocal: false,
      },
    ],
  }
  const { screen, store } = await fixture(false, [linked])
  store.dispatch(selectAgent('cursor' as const))
  // Act
  screen
    .getByRole('treeitem', { name: 'alpha', exact: true })
    .element()
    .dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
    )
  await screen.getByRole('menuitem', { name: 'Copy to…', exact: true }).click()
  // Assert
  expect(store.getState().skills.skillToCopy?.path).toBe('/skills/alpha')
  await screen
    .getByRole('button', { name: 'Actions for alpha', exact: true })
    .click()
  await screen.getByRole('menuitem', { name: 'Unlink…', exact: true }).click()
  expect(store.getState().skills.skillToUnlink?.symlink.linkPath).toBe(
    '/cursor/skills/alpha',
  )
})

test('keyboard file Space previews without checking a root and ArrowUp moves focus only', async () => {
  // Arrange
  const { screen, store } = await fixture()
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toBeVisible()
  screen.getByRole('tree').element().focus()
  // Act
  await userEvent.keyboard('{Home}{ArrowDown} {ArrowDown} {ArrowUp}')
  // Assert
  expect(store.getState().skills.inspectedFile?.path).toBe(
    '/skills/alpha/guides/a\\b%.md',
  )
  expect(store.getState().skills.selectedSkillNames).toEqual([])
  await expect
    .element(screen.getByRole('treeitem', { name: 'guides', exact: true }))
    .toHaveAttribute('data-focused', 'true')
})

test('modifier selection checks roots while duplicate names cannot create ambiguous mutations', async () => {
  // Arrange
  const { screen, store } = await fixture(false, [
    alpha,
    { ...beta, name: alpha.name },
  ])
  // Act
  const roots = screen
    .getByRole('treeitem', { name: 'alpha', exact: true })
    .all()
  roots[0]
    .element()
    .dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))
  // Assert
  expect(store.getState().skills.selectedSkillNames).toEqual([])
  await expect
    .element(
      screen
        .getByRole('checkbox', { name: 'Select alpha', exact: true })
        .first(),
    )
    .toBeDisabled()
})

test('disclosure and checkbox clicks keep arrow navigation on the tree', async () => {
  // Arrange
  const { screen, store } = await fixture()
  // Act
  await screen
    .getByRole('button', { name: 'Expand alpha', exact: true })
    .click()
  // Assert
  await expect.element(screen.getByRole('tree')).toHaveFocus()
  await screen
    .getByRole('checkbox', { name: 'Select beta', exact: true })
    .click()
  await expect.element(screen.getByRole('tree')).toHaveFocus()
  await userEvent.keyboard('{ArrowUp}')
  expect(store.getState().skills.selectedSkillNames).toEqual(['beta'])
})
