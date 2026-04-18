import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import type {
  HttpUrl,
  RepositoryId,
  SkillName,
  SkillSearchResult,
} from '../../../../shared/types'

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
    await import('../../redux/slices/marketplaceSlice')
  const { default: bookmarkReducer } =
    await import('../../redux/slices/bookmarkSlice')
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
  it('renders no Remove button when isInstalled=true', async () => {
    const { screen } = await renderRow(makeSkill(), true)
    // Exact-match 'Remove' so we don't false-positive on the bookmark
    // toggle's "Remove <name> from bookmarks" aria-label.
    expect(screen.getByRole('button', { name: 'Remove' }).query()).toBeNull()
  })

  it('renders no Uninstall button when isInstalled=true', async () => {
    const { screen } = await renderRow(makeSkill(), true)
    expect(
      screen.getByRole('button', { name: /uninstall/i }).query(),
    ).toBeNull()
  })

  it('renders no Trash icon button when isInstalled=true', async () => {
    const { screen } = await renderRow(makeSkill(), true)
    expect(screen.getByRole('button', { name: /trash/i }).query()).toBeNull()
    expect(screen.getByRole('button', { name: /delete/i }).query()).toBeNull()
  })

  it('renders the static Installed badge with a discoverable uninstall hint', async () => {
    const skill = makeSkill({ name: 'lint' as SkillName })
    const { screen } = await renderRow(skill, true)
    // Static informational badge uses role="img" — `role="status"` is for
    // live regions that announce dynamic state changes, not labels. The
    // aria-label includes `--global` so the recipe matches how the app
    // installs (InstallModal hardcodes isGlobal=true) and works when copied.
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

  it('still renders an Install button when isInstalled=false (sanity)', async () => {
    const { screen } = await renderRow(makeSkill(), false)
    // Exact 'Install' (not /install/i) — the regex would also match the
    // Installed badge's "<name> is installed …" aria-label if both states
    // ever rendered together. Anchoring on the button's exact accessible
    // name keeps this assertion truthful regardless of future layout shifts.
    await expect
      .element(screen.getByRole('button', { name: 'Install' }))
      .toBeInTheDocument()
  })
})

/**
 * Bookmark toggle round-trip. The bookmark selector was memoized in 6c3ac03
 * (Set-backed `selectIsBookmarked`); a regression in either the selector or
 * the click handler would break this entry-point with no other test catching
 * it. Two cases lock both directions: unbookmarked → bookmarked and back.
 */
describe('SkillRowMarketplace — bookmark toggle', () => {
  it('toggles unbookmarked → bookmarked via star click', async () => {
    const { screen, store } = await renderRow(makeSkill(), false)
    await screen.getByRole('button', { name: 'Bookmark task' }).click()
    await expect
      .element(
        screen.getByRole('button', { name: 'Remove task from bookmarks' }),
      )
      .toBeInTheDocument()
    expect(store.getState().bookmarks.items.map((b) => b.name)).toEqual([
      'task',
    ])
  })

  it('toggles bookmarked → unbookmarked on second click', async () => {
    const { screen, store } = await renderRow(makeSkill(), false)
    const bookmarkButton = screen.getByRole('button', { name: 'Bookmark task' })
    await bookmarkButton.click()
    await screen
      .getByRole('button', { name: 'Remove task from bookmarks' })
      .click()
    await expect
      .element(screen.getByRole('button', { name: 'Bookmark task' }))
      .toBeInTheDocument()
    expect(store.getState().bookmarks.items).toEqual([])
  })
})
