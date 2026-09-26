import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

// Real Tailwind output: the reveal is `opacity-0` plus hover/focus variants.
import '@/renderer/src/styles/globals.css'

import { TooltipProvider } from '@/renderer/src/components/ui/tooltip'
import type { FilesystemEntryIdentity, Skill } from '@/shared/types'
import {
  toAbsolutePath,
  toFileSizeBytes,
  toSkillName,
  toSymlinkCount,
} from '@/shared/types'

beforeEach(() => {
  // The preload's IPC bridge, scoped to each test (see SkillItem.browser.test.tsx).
  vi.stubGlobal('electron', {
    skills: {
      getAll: vi.fn(),
      onDeleteProgress: vi.fn(() => (): void => {}),
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const directoryIdentity: FilesystemEntryIdentity = {
  kind: 'directory',
  dev: 1,
  ino: 2,
  size: toFileSizeBytes(96),
  ctimeMs: 3,
  mtimeMs: 4,
}

/**
 * Build a minimal source skill fixture with a distinct description per row.
 * @param name - Skill name, also used in the description text.
 * @param overrides - Partial Skill overrides.
 * @returns Complete Skill object
 * @example makeSkill('task').description // => 'task description'
 */
function makeSkill(name: string, overrides: Partial<Skill> = {}): Skill {
  return {
    name: toSkillName(name),
    description: `${name} description`,
    path: toAbsolutePath(`/home/user/.agents/skills/${name}`),
    filesystemIdentity: directoryIdentity,
    symlinkCount: toSymlinkCount(0),
    symlinks: [],
    isSource: true,
    isOrphan: false,
    ...overrides,
  }
}

/**
 * Render several SkillItem rows against the real reducers, so a tick on one
 * row can change how its neighbours draw their checkbox. The pointer is parked
 * on a strip below the rows: Chromium keeps it where the previous test left
 * it, and a card that renders under it would start out hovered.
 * @param skills - Rows to load into the store and render, in order.
 * @returns Browser screen and Redux store.
 * @example const { screen, store } = await renderSkillRows([makeSkill('alpha')])
 */
async function renderSkillRows(skills: Skill[]) {
  const [
    { default: uiReducer },
    { default: skillsReducer, fetchSkills },
    { default: agentsReducer },
    { default: bookmarkReducer },
    { default: protectReducer },
    { SkillItem },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/uiSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/bookmarkSlice'),
    import('@/renderer/src/redux/slices/protectSlice'),
    import('./SkillItem'),
  ])
  const store = configureStore({
    reducer: {
      ui: uiReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      bookmarks: bookmarkReducer,
      protect: protectReducer,
    },
  })
  store.dispatch(fetchSkills.fulfilled(skills, 'req-id'))

  const screen = await render(
    <Provider store={store}>
      <TooltipProvider>
        <div className="w-[480px] space-y-2">
          {skills.map((skill) => (
            <SkillItem key={skill.name} skill={skill} />
          ))}
        </div>
        <div data-testid="pointer-parking" className="h-10 w-[480px]" />
      </TooltipProvider>
    </Provider>,
  )
  await screen.getByTestId('pointer-parking').hover()
  return { screen, store }
}

/**
 * Reads an element's resolved opacity once its 150ms fade has settled.
 * @param element - The element to read.
 * @returns The computed `opacity`, e.g. `'0'` or `'1'`.
 * @example await expect.poll(() => readOpacity(box)).toBe('1')
 */
function readOpacity(element: Element): string {
  return getComputedStyle(element).opacity
}

/**
 * Reads the opacity of the `<label>` wrapping a row checkbox. A disabled box
 * fades on its label, since the box's own `disabled:opacity-50` would win.
 * @param checkbox - The row checkbox element.
 * @returns The label's computed `opacity`, or null without a wrapping label.
 * @example await expect.poll(() => readWrappingLabelOpacity(box)).toBe('0')
 */
function readWrappingLabelOpacity(checkbox: Element): string | null {
  const label = checkbox.closest('label')
  return label === null ? null : readOpacity(label)
}

/**
 * Finds the card a row renders, by the `data-skill-name` it carries.
 * @param skillName - The row's skill name.
 * @returns The row's card element.
 * @throws When no card for that skill is rendered.
 * @example getRowCard('alpha').dataset.skillName // => 'alpha'
 */
function getRowCard(skillName: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-skill-name="${skillName}"]`,
  )
  if (card === null) throw new Error(`No card is rendered for ${skillName}`)
  return card
}

/**
 * Switches the page to the dark palette for one test. The colour tokens live
 * under `.dark` / `.light`, which the app sets on `<html>`; without either,
 * every `bg-primary/5`-style utility resolves to transparent.
 * @example applyDarkPalette()
 */
function applyDarkPalette(): void {
  document.documentElement.classList.add('dark')
  onTestFinished(() => {
    document.documentElement.classList.remove('dark')
  })
}

describe('SkillItem row checkbox reveal', () => {
  test('keeps the row checkbox transparent at rest until its card is hovered', async () => {
    // Arrange
    const { screen } = await renderSkillRows([makeSkill('task')])
    const checkbox = screen.getByRole('checkbox', { name: 'Select task' })
    await expect.poll(() => readOpacity(checkbox.element())).toBe('0')

    // Act
    await screen.getByText('task description').hover()

    // Assert
    await expect.poll(() => readOpacity(checkbox.element())).toBe('1')
  })

  test('reveals the row checkbox when Tab lands on it with nothing selected', async () => {
    // Arrange
    const { screen } = await renderSkillRows([makeSkill('task')])
    const checkboxElement = screen
      .getByRole('checkbox', { name: 'Select task' })
      .element()
    await expect.poll(() => readOpacity(checkboxElement)).toBe('0')

    // Act — Tab through the card's controls until the checkbox has focus
    for (
      let pressCount = 0;
      pressCount < 10 && document.activeElement !== checkboxElement;
      pressCount += 1
    ) {
      await userEvent.keyboard('{Tab}')
    }

    // Assert — keyboard focus alone reveals it, with no hover involved
    expect(document.activeElement).toBe(checkboxElement)
    await expect.poll(() => readOpacity(checkboxElement)).toBe('1')
  })

  test('shows every row checkbox without hover once any row is ticked', async () => {
    // Arrange
    const { screen, store } = await renderSkillRows([
      makeSkill('alpha'),
      makeSkill('beta'),
    ])
    const betaCheckbox = screen.getByRole('checkbox', { name: 'Select beta' })
    await expect.poll(() => readOpacity(betaCheckbox.element())).toBe('0')
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(toggleSelection(toSkillName('alpha')))

    // Assert — the unticked neighbour is on screen too, so every tick is visible
    await expect.poll(() => readOpacity(betaCheckbox.element())).toBe('1')
  })

  test('keeps the card title in place when the first row is ticked', async () => {
    // Arrange
    const { screen, store } = await renderSkillRows([makeSkill('task')])
    const title = screen.getByText('task description').element()
    const leftBeforeTick = title.getBoundingClientRect().left
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(toggleSelection(toSkillName('task')))
    await expect
      .element(screen.getByRole('checkbox', { name: 'Deselect task' }))
      .toBeVisible()

    // Assert — the 28px gutter is reserved at rest, so nothing moves
    expect(title.getBoundingClientRect().left).toBe(leftBeforeTick)
  })

  test('keeps an ineligible row checkbox hidden at rest until its card is hovered', async () => {
    // Arrange — Cursor view with a broken link, which bulk Unlink cannot use
    const brokenTask = makeSkill('task', {
      symlinks: [
        {
          agentId: 'cursor',
          agentName: 'Cursor',
          status: 'broken',
          linkPath: toAbsolutePath('/home/user/.cursor/skills/task'),
          targetPath: toAbsolutePath('/home/user/.agents/skills/task'),
          isLocal: false,
        },
      ],
    })
    const { screen, store } = await renderSkillRows([brokenTask])
    const { selectAgent } = await import('@/renderer/src/redux/slices/uiSlice')
    store.dispatch(selectAgent('cursor'))
    const checkbox = screen.getByRole('checkbox', {
      name: 'task is not eligible for bulk selection',
    })
    await expect.element(checkbox).toBeDisabled()
    await expect
      .poll(() => readWrappingLabelOpacity(checkbox.element()))
      .toBe('0')

    // Act
    await screen.getByText('task description').hover()

    // Assert
    await expect
      .poll(() => readWrappingLabelOpacity(checkbox.element()))
      .toBe('1')
  })
})

describe('SkillItem ticked row tint', () => {
  test('tints a ticked row over its card surface so the batch reads at a glance', async () => {
    // Arrange — default dark palette: neutral primary at oklch(0.7 0 0)
    applyDarkPalette()
    const { store } = await renderSkillRows([
      makeSkill('alpha'),
      makeSkill('beta'),
    ])
    const { toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(toggleSelection(toSkillName('alpha')))

    // Assert — a 5% primary wash layered over the card surface (not replacing
    // it) and a 40% primary border on the ticked card; the unticked neighbour
    // keeps the plain card surface
    await expect
      .poll(() => getComputedStyle(getRowCard('alpha')).backgroundImage)
      .toBe(
        'linear-gradient(to right, oklab(0.7 0 0 / 0.05) 0%, oklab(0.7 0 0 / 0.05) 100%)',
      )
    expect(getComputedStyle(getRowCard('alpha')).backgroundColor).toBe(
      'oklch(0.18 0 0)',
    )
    await expect
      .poll(() => getComputedStyle(getRowCard('alpha')).borderTopColor)
      .toBe('oklab(0.7 0 0 / 0.4)')
    expect(getComputedStyle(getRowCard('beta')).backgroundColor).toBe(
      'oklch(0.18 0 0)',
    )
    expect(getComputedStyle(getRowCard('beta')).backgroundImage).toBe('none')
  })

  test('keeps the full primary border on the inspected row when it is also ticked', async () => {
    // Arrange
    applyDarkPalette()
    const alphaSkill = makeSkill('alpha')
    const { store } = await renderSkillRows([alphaSkill, makeSkill('beta')])
    const { selectSkill, toggleSelection } =
      await import('@/renderer/src/redux/slices/skillsSlice')

    // Act
    store.dispatch(toggleSelection(toSkillName('alpha')))
    store.dispatch(selectSkill(alphaSkill))

    // Assert — the inspected row's solid border outranks the ticked tint
    await expect
      .poll(() => getComputedStyle(getRowCard('alpha')).borderTopColor)
      .toBe('oklch(0.7 0 0)')
  })
})
