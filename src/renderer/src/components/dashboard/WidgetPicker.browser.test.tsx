import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

/**
 * Render the WidgetPicker open, inside a real-reducer store seeded with one
 * empty page so a clicked widget lands via the normal add path. dashboard /
 * skills / agents are the only slices the default (Welcome) and Skill Stats
 * previews read from — the preview mounts the REAL widget body.
 * @param onOpenChange - Spy for the dialog's open-state callback.
 * @param options - `welcomeDismissed` pre-dispatches `dismissWelcome()` to
 *   simulate a returning user (Welcome's body then renders only a muted hint).
 * @returns Render handle + the Redux store for state assertions.
 */
async function renderPicker(
  onOpenChange: (open: boolean) => void,
  options: { welcomeDismissed?: boolean } = {},
) {
  const [
    { default: dashboardReducer, addPage, dismissWelcome },
    { default: skillsReducer },
    { default: agentsReducer },
    { default: widgetPickerReducer },
    { WidgetPicker },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/dashboardSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/widgetPickerSlice'),
    import('./WidgetPicker'),
  ])

  const store = configureStore({
    reducer: {
      dashboard: dashboardReducer,
      skills: skillsReducer,
      agents: agentsReducer,
      widgetPicker: widgetPickerReducer,
    },
  })
  // One empty page so the clicked widget is placed via the common add path.
  store.dispatch(addPage({ name: 'Test Page' }))
  // Simulate a returning user who already dismissed the Welcome card.
  if (options.welcomeDismissed) store.dispatch(dismissWelcome())

  const screen = await render(
    <Provider store={store}>
      <WidgetPicker open={true} onOpenChange={onOpenChange} />
    </Provider>,
  )
  return { screen, store }
}

describe('WidgetPicker', () => {
  it('previews the first widget live when the modal opens', async () => {
    // Arrange + Act
    const { screen } = await renderPicker(vi.fn())

    // Assert: the real Welcome widget body renders in the preview stage. Its
    // in-body heading is unique to the rendered component (the list shows only
    // the short "Welcome" label), so finding it proves the live preview works.
    await expect
      .element(screen.getByText('Welcome to Skills Desktop'))
      .toBeVisible()
  })

  it('seeds the open-default preview on the next widget when Welcome was already dismissed', async () => {
    // Arrange + Act: returning user — Welcome is dismissed, so its body would
    // render only a muted hint and make a useless first frame.
    const { screen } = await renderPicker(vi.fn(), { welcomeDismissed: true })

    // Assert: the stage opens on Skill Stats instead ("Linked" is one of its
    // tiles)...
    await expect
      .element(screen.getByText('Linked', { exact: true }))
      .toBeVisible()
    // ...and the dismissed Welcome body is not what greets the user.
    expect(screen.getByText('Welcome to Skills Desktop').query()).toBeNull()
  })

  it('swaps the preview to the live component of the hovered widget', async () => {
    // Arrange
    const { screen } = await renderPicker(vi.fn())

    // Act: hover the Skill Stats row.
    await screen.getByRole('button', { name: /skill stats/i }).hover()

    // Assert: the Stats widget body now renders ("Linked" is one of its three
    // stat tiles and appears nowhere else)...
    await expect
      .element(screen.getByText('Linked', { exact: true }))
      .toBeVisible()
    // ...and the previously-shown Welcome body is gone.
    expect(screen.getByText('Welcome to Skills Desktop').query()).toBeNull()
  })

  it('adds the clicked widget to the page and closes the modal', async () => {
    // Arrange
    const onOpenChange = vi.fn()
    const { screen, store } = await renderPicker(onOpenChange)

    // Act: click the Skill Stats row (one-click-add).
    await screen.getByRole('button', { name: /skill stats/i }).click()

    // Assert: a stats widget was added to the page, and the modal was asked to
    // close.
    const pages = store.getState().dashboard.pages
    expect(pages[0]?.widgets).toHaveLength(1)
    expect(pages[0]?.widgets[0]?.type).toBe('stats')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('updates the preview when a row receives keyboard focus', async () => {
    // Arrange
    const { screen } = await renderPicker(vi.fn())

    // Act: move keyboard focus onto the Skill Stats row (no pointer involved).
    const statsRow = screen
      .getByRole('button', { name: /skill stats/i })
      .element()
    if (statsRow instanceof HTMLElement) statsRow.focus()

    // Assert: focus alone drives the live preview, so keyboard users get the
    // same preview as mouse users.
    await expect
      .element(screen.getByText('Linked', { exact: true }))
      .toBeVisible()
  })
})
