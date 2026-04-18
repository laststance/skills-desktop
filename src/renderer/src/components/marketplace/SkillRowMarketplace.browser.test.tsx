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
    expect(screen.getByRole('button', { name: /remove/i }).query()).toBeNull()
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
    // The badge surfaces the CLI uninstall recipe via aria-label so screen-reader
    // users have a path even though the row is intentionally unactionable.
    await expect
      .element(screen.getByRole('status', { name: /lint is installed/i }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('status', { name: /npx skills remove lint/i }))
      .toBeInTheDocument()
  })

  it('still renders an Install button when isInstalled=false (sanity)', async () => {
    const { screen } = await renderRow(makeSkill(), false)
    await expect
      .element(screen.getByRole('button', { name: /install/i }))
      .toBeInTheDocument()
  })
})
