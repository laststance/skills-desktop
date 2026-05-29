import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  HttpUrl,
  RepositoryId,
  SkillName,
  SkillSearchResult,
} from '@/shared/types'

beforeEach(() => {
  // SkillRowMarketplace doesn't call IPC directly, but SkillsMarketplace and
  // its modal siblings do — keep a stub in place for safety against future
  // imports that pull in the bridge transitively.
  vi.stubGlobal('electron', {
    skillsCli: {
      search: vi.fn(),
      install: vi.fn(),
      cancel: vi.fn(),
      onProgress: vi.fn(() => () => {}),
    },
    // `marketplaceSlice.loadLeaderboard` reads `window.electron.marketplace.leaderboard`.
    // Even though no test in this file dispatches it directly, importing the slice
    // (via `createStore` below) wires reducers that may run during render. Stubbing
    // it here keeps the test resilient if a future render path triggers the thunk.
    marketplace: {
      leaderboard: vi.fn(async () => []),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal `SkillSearchResult` fixture so each test can vary just the
 * field under inspection without re-stating the whole shape.
 * @param overrides - Partial SkillSearchResult overrides
 */
function makeSkill(
  overrides: Partial<SkillSearchResult> = {},
): SkillSearchResult {
  return {
    rank: 1,
    name: 'task' as SkillName,
    repo: 'vercel-labs/skills' as RepositoryId,
    url: 'https://skills.sh/task' as HttpUrl,
    installCount: 100,
    ...overrides,
  }
}

/**
 * Real `marketplaceSlice` + `bookmarkSlice` reducers — SkillRowMarketplace
 * subscribes to `state.marketplace.status` and `selectIsBookmarked`, so the
 * store has to surface both. Using the real reducers (not handcrafted state)
 * means the test exercises the same state shape production sees.
 */
async function createStore() {
  const { default: marketplaceReducer } =
    await import('@/renderer/src/redux/slices/marketplaceSlice')
  const { default: bookmarkReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')
  return configureStore({
    reducer: {
      marketplace: marketplaceReducer,
      bookmarks: bookmarkReducer,
    },
  })
}

async function renderRow(skill: SkillSearchResult, isInstalled: boolean) {
  const store = await createStore()
  const { SkillRowMarketplace } = await import('./SkillRowMarketplace')
  const screen = await render(
    <Provider store={store}>
      <SkillRowMarketplace skill={skill} isInstalled={isInstalled} />
    </Provider>,
  )
  return { screen, store }
}

/**
 * Regression boundary for the "remove uninstall action from installed skills"
 * change. The destructive Remove/Trash button was removed end-to-end (IPC,
 * preload, redux thunk, dialog, button). These tests lock that intent in:
 * if anyone re-introduces a destructive control on an installed row, they
 * have to delete a test that explicitly says "no destructive action."
 */
describe('SkillRowMarketplace — installed row has no destructive action', () => {
  it('offers no Remove button on an already-installed skill', async () => {
    // Arrange
    const { screen } = await renderRow(makeSkill(), true)

    // Act
    // Exact-match 'Remove' so we don't false-positive on the bookmark
    // toggle's "Remove <name> from bookmarks" aria-label.
    const removeButton = screen.getByRole('button', { name: 'Remove' }).query()

    // Assert
    expect(removeButton).toBeNull()
  })

  it('offers no Uninstall button on an already-installed skill', async () => {
    // Arrange
    const { screen } = await renderRow(makeSkill(), true)

    // Act
    const uninstallButton = screen
      .getByRole('button', { name: /uninstall/i })
      .query()

    // Assert
    expect(uninstallButton).toBeNull()
  })

  it('offers no Trash or Delete icon button on an already-installed skill', async () => {
    // Arrange
    const { screen } = await renderRow(makeSkill(), true)

    // Act
    const trashButton = screen.getByRole('button', { name: /trash/i }).query()
    const deleteButton = screen.getByRole('button', { name: /delete/i }).query()

    // Assert
    expect(trashButton).toBeNull()
    expect(deleteButton).toBeNull()
  })

  it('shows an Installed badge whose hint spells out the npx remove --global command', async () => {
    // Arrange
    const skill = makeSkill({ name: 'lint' as SkillName })

    // Act
    const { screen } = await renderRow(skill, true)

    // Assert
    // Static informational badge uses role="img" — `role="status"` is for
    // live regions that announce dynamic state changes, not labels. The
    // aria-label includes `--global` so the recipe matches how the app
    // installs (InstallModal installs globally by design) and works when copied.
    await expect
      .element(screen.getByRole('img', { name: /lint is installed/i }))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByRole('img', {
          name: /npx skills remove lint --global/i,
        }),
      )
      .toBeInTheDocument()
  })

  it('shows an Install button on a not-yet-installed skill', async () => {
    // Arrange
    const { screen } = await renderRow(makeSkill(), false)

    // Act
    // Exact 'Install' (not /install/i) — the regex would also match the
    // Installed badge's "<name> is installed …" aria-label if both states
    // ever rendered together. Anchoring on the button's exact accessible
    // name keeps this assertion truthful regardless of future layout shifts.
    const installButton = screen.getByRole('button', { name: 'Install' })

    // Assert
    await expect.element(installButton).toBeInTheDocument()
  })
})

/**
 * Bookmark toggle round-trip. The bookmark selector was memoized in 6c3ac03
 * (Set-backed `selectIsBookmarked`); a regression in either the selector or
 * the click handler would break this entry-point with no other test catching
 * it. Two cases lock both directions: unbookmarked → bookmarked and back.
 */
describe('SkillRowMarketplace — bookmark toggle', () => {
  it('bookmarks a skill and saves it when the star is clicked', async () => {
    // Arrange
    const { screen, store } = await renderRow(makeSkill(), false)

    // Act
    await screen.getByRole('button', { name: 'Bookmark task' }).click()

    // Assert
    await expect
      .element(
        screen.getByRole('button', { name: 'Remove task from bookmarks' }),
      )
      .toBeInTheDocument()
    expect(store.getState().bookmarks.items.map((b) => b.name)).toEqual([
      'task',
    ])
  })

  it('removes a skill from the saved list when its star is clicked a second time', async () => {
    // Arrange
    const { screen, store } = await renderRow(makeSkill(), false)
    const bookmarkButton = screen.getByRole('button', { name: 'Bookmark task' })
    await bookmarkButton.click()

    // Act
    await screen
      .getByRole('button', { name: 'Remove task from bookmarks' })
      .click()

    // Assert
    await expect
      .element(screen.getByRole('button', { name: 'Bookmark task' }))
      .toBeInTheDocument()
    expect(store.getState().bookmarks.items).toEqual([])
  })
})
