import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import { installLayoutStyles } from '@/renderer/src/test/installLayoutStyles'
import type { Skill, SkillName } from '@/shared/types'

const mockGetAll = vi.fn()

beforeEach(() => {
  // Stub the IPC bridge so the SkillsList useEffect dispatch of fetchSkills
  // does not throw. The thunk fires on mount; tests assert the *render branch*
  // chosen from preloadedState, so the resolved value here is irrelevant.
  vi.stubGlobal('electron', {
    skills: {
      getAll: mockGetAll.mockResolvedValue([]),
      onDeleteProgress: vi.fn(() => () => {}),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Build a minimal Skill fixture matching `selectFilteredSkills`'s default
 * branch (no agent selected → keeps `isSource: true` items).
 * @param overrides - Partial Skill overrides
 * @returns Complete Skill object
 * @example makeSkill({ name: 'task' as SkillName })
 */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'task' as SkillName,
    description: 'Task management skill',
    path: '/home/user/.agents/skills/task' as Skill['path'],
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...overrides,
  }
}

/**
 * Build a combined store with the slices SkillsList reads, seeded via
 * `preloadedState` so we can simulate `loading=true` while items already
 * contains data — the exact state hit during background refetch after a
 * mutation (Add/Delete/Unlink etc).
 * @param skillsState - Partial skills slice override (loading, items)
 * @returns Redux store
 */
async function createStore(
  skillsState: { loading?: boolean; items?: Skill[] } = {},
) {
  const { default: uiReducer } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { default: skillsReducer } =
    await import('@/renderer/src/redux/slices/skillsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: bookmarkReducer } =
    await import('@/renderer/src/redux/slices/bookmarkSlice')

  // Build a complete SkillsState that satisfies the slice's typing while
  // letting tests override only the two fields that matter for the render
  // branch (loading, items). Other slices are omitted from preloadedState
  // so they fall back to each reducer's own initialState — this avoids
  // re-declaring shapes that aren't exported.
  return configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarkReducer,
    },
    preloadedState: {
      skills: {
        items: skillsState.items ?? [],
        selectedSkill: null,
        loading: skillsState.loading ?? false,
        error: null,
        skillToUnlink: null,
        unlinking: false,
        skillToAddSymlinks: null,
        selectedAddAgentIds: [],
        addingSymlinks: false,
        skillToCopy: null,
        selectedCopyAgentIds: [],
        copying: false,
        selectedSkillNames: [],
        selectionAnchor: null,
        inFlightDeleteNames: [],
        inFlightUnlinkNames: [],
        bulkDeleting: false,
        bulkUnlinking: false,
        bulkProgress: null,
      },
    },
  })
}

/**
 * Render SkillsList inside the provider stack it needs. The fixed-height
 * outer div lets react-window v2 measure a non-zero viewport so virtualized
 * rows actually mount; without it, rowCount > 0 but no rows are rendered.
 * @returns vitest-browser-react screen for locator queries
 */
async function renderSkillsList(skillsState: {
  loading?: boolean
  items?: Skill[]
}) {
  const store = await createStore(skillsState)
  const { SkillsList } = await import('./SkillsList')
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <div style={{ height: 600, width: 800 }}>
          <SkillsList />
        </div>
      </TooltipProvider>
    </Provider>,
  )
}

/**
 * Render SkillsList in the same scroll shell used by the Installed tab.
 * @param skillsState - Skill slice fields needed for the visible rows.
 * @returns vitest-browser-react screen for locator queries.
 * @example
 * await renderInstalledListShell({ items: [makeSkill()] })
 */
async function renderInstalledListShell(skillsState: {
  loading?: boolean
  items?: Skill[]
}) {
  const store = await createStore(skillsState)
  const { SkillsList } = await import('./SkillsList')
  return render(
    <Provider store={store}>
      <TooltipProvider>
        <div
          data-testid="installed-list-shell"
          className="overflow-hidden py-4 pl-4 pr-[5px]"
          style={{ height: 360, width: 800 }}
        >
          <SkillsList />
        </div>
      </TooltipProvider>
    </Provider>,
  )
}

/**
 * Require a DOM node to be an HTMLElement before layout measurement.
 * @param element - Candidate node from querySelector or closest.
 * @param label - Human-readable selector name for failure output.
 * @returns HTMLElement safe for getBoundingClientRect measurement.
 * @example
 * const card = requireHTMLElement(document.querySelector('.group'), 'card')
 */
function requireHTMLElement(
  element: Element | null,
  label: string,
): HTMLElement {
  if (!(element instanceof HTMLElement)) {
    throw new Error(`${label} should exist for layout measurement`)
  }
  return element
}

/**
 * Measure the Installed list card and reserved scrollbar gutter geometry.
 * @param deleteButtonAriaLabel - Exact aria-label for the row delete button.
 * @param cardLabel - Human-readable card label for failure output.
 * @returns DOM list element plus rounded gutter and spacing metrics.
 * @example
 * const metrics = measureInstalledListLayout('Delete skill-0', 'first skill card')
 */
function measureInstalledListLayout(
  deleteButtonAriaLabel: string,
  cardLabel: string,
) {
  const shell = requireHTMLElement(
    document.querySelector('[data-testid="installed-list-shell"]'),
    'installed list shell',
  )
  const list = requireHTMLElement(
    document.querySelector('[role="list"]'),
    'virtualized list',
  )
  const deleteButton = requireHTMLElement(
    Array.from(document.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === deleteButtonAriaLabel,
    ) ?? null,
    `${cardLabel} delete button`,
  )
  const card = requireHTMLElement(deleteButton.closest('.group'), cardLabel)
  const shellRect = shell.getBoundingClientRect()
  const listRect = list.getBoundingClientRect()
  const cardRect = card.getBoundingClientRect()
  const reservedGutterWidthPx = list.offsetWidth - list.clientWidth
  const reservedGutterLeftPx = listRect.right - reservedGutterWidthPx

  return {
    list,
    reservedGutterWidthPx,
    leftGutterPx: Math.round(cardRect.left - shellRect.left),
    rightGutterPx: Math.round(shellRect.right - cardRect.right),
    reservedGutterLeftSpacingPx: Math.round(
      reservedGutterLeftPx - cardRect.right,
    ),
    reservedGutterRightSpacingPx: Math.round(shellRect.right - listRect.right),
  }
}

describe('SkillsList loading branch — scroll-preservation regression', () => {
  it('shows the "Loading skills..." placeholder on initial fetch (loading=true, items=[])', async () => {
    // Arrange
    // Pin getAll on a never-resolving promise so the on-mount fetchSkills
    // useEffect cannot flip loading→false before the assertion polls the
    // DOM. Without this the fulfilled reducer would land first and the
    // empty-list branch ("No skills installed") would replace the
    // placeholder — a flake unrelated to the bug under test.
    mockGetAll.mockReturnValue(new Promise(() => {}))

    // Act
    const screen = await renderSkillsList({ loading: true, items: [] })

    // Assert
    await expect
      .element(screen.getByText('Loading skills...'))
      .toBeInTheDocument()
  })

  it('keeps the list mounted during background refetch (loading=true, items=[skill])', async () => {
    // Arrange
    // Background refetch after a mutation: Redux flips loading=true while
    // items still contain the previous data. The `loading && skills.length === 0`
    // guard ensures the existing <List> stays mounted so react-window's
    // internal scrollTop survives. If a future change reverts to `if (loading)`
    // the list unmounts and the placeholder shows — this assertion catches that regression.
    mockGetAll.mockReturnValue(new Promise(() => {}))

    // Act
    const screen = await renderSkillsList({
      loading: true,
      items: [makeSkill({ name: 'task' as SkillName })],
    })

    // Assert
    expect(screen.getByText('Loading skills...').query()).toBeNull()
  })
})

describe('SkillsList scrollbar gutter layout', () => {
  it('keeps installed skill cards and scrollbar spacing balanced when the vertical scrollbar is visible', async () => {
    // Arrange
    const layoutStyleElement = installLayoutStyles()
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const visibleSkills = Array.from({ length: 8 }, (_value, index) =>
      makeSkill({
        name: `skill-${index}` as SkillName,
        description: `Skill ${index} with enough body copy to use the normal installed card height.`,
      }),
    )

    try {
      // Act
      const screen = await renderInstalledListShell({ items: visibleSkills })
      await expect.element(screen.getByText('skill-0')).toBeInTheDocument()

      // Assert
      const metrics = measureInstalledListLayout(
        'Delete skill-0',
        'first skill card',
      )

      expect(metrics.reservedGutterWidthPx).toBe(6)
      expect(metrics.leftGutterPx).toBe(16)
      expect(metrics.rightGutterPx).toBe(16)
      expect(metrics.reservedGutterLeftSpacingPx).toBe(5)
      expect(metrics.reservedGutterRightSpacingPx).toBe(5)
    } finally {
      layoutStyleElement.remove()
    }
  })

  it('keeps installed skill cards and reserved scrollbar gutter balanced when vertical scrolling is unnecessary', async () => {
    // Arrange
    const layoutStyleElement = installLayoutStyles()
    mockGetAll.mockReturnValue(new Promise(() => {}))
    const visibleSkills = [
      makeSkill({
        name: 'single-skill' as SkillName,
        description: 'A short list should not need vertical scrolling.',
      }),
    ]

    try {
      // Act
      const screen = await renderInstalledListShell({ items: visibleSkills })
      await expect.element(screen.getByText('single-skill')).toBeInTheDocument()

      // Assert
      const metrics = measureInstalledListLayout(
        'Delete single-skill',
        'single skill card',
      )

      expect(metrics.list.scrollHeight).toBeLessThanOrEqual(
        metrics.list.clientHeight,
      )
      expect(metrics.reservedGutterWidthPx).toBe(6)
      expect(metrics.leftGutterPx).toBe(16)
      expect(metrics.rightGutterPx).toBe(16)
      expect(metrics.reservedGutterLeftSpacingPx).toBe(5)
      expect(metrics.reservedGutterRightSpacingPx).toBe(5)
    } finally {
      layoutStyleElement.remove()
    }
  })
})
