// @vitest-environment happy-dom

import { configureStore } from '@reduxjs/toolkit'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import dashboardReducer, {
  addPage,
  setCurrentPage,
  selectCurrentPageId,
  selectIsEditMode,
  selectDashboardPages,
} from '@/renderer/src/redux/slices/dashboardSlice'

import { useDashboardKeyboardShortcuts } from './useDashboardKeyboardShortcuts'

// React's act() requires this global flag so updates flush synchronously in
// the happy-dom node lane (mirrors what @testing-library would set up).
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

/**
 * Builds a minimal real Redux store carrying only the dashboard slice, seeds it
 * with `pageCount` real pages via the `addPage` action, and resets the active
 * page to the first one so page-switch assertions start from a known tab.
 * @param pageCount - How many dashboard pages to create.
 * @returns The configured store plus the seeded pages (id-stable for assertions).
 * @example const { store, pages } = makeSeededStore(3)
 */
function makeSeededStore(pageCount: number) {
  const store = configureStore({ reducer: { dashboard: dashboardReducer } })
  for (let index = 0; index < pageCount; index += 1) {
    store.dispatch(addPage())
  }
  const pages = selectDashboardPages(store.getState())
  // addPage moves the active page to the newest; pin it back to page 1 so a
  // ⌘1 press has a visible effect to assert against.
  if (pages[0]) store.dispatch(setCurrentPage(pages[0].id))
  return { store, pages }
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

/**
 * Mounts the hook inside a real Provider tree so its `useAppDispatch`,
 * `useAppSelector`, and `useEffect` listener registration all run for real.
 * @param store - The Redux store the hook reads pages from and dispatches to.
 * @example mountHook(store)
 */
function mountHook(store: ReturnType<typeof makeSeededStore>['store']): void {
  function HookHost(): null {
    useDashboardKeyboardShortcuts()
    return null
  }
  act(() => {
    root.render(
      // react-doctor-disable-next-line react-doctor/no-children-prop -- test harness mounts via createElement (not JSX); children-as-prop is the canonical programmatic way to wrap the hook host in the Redux Provider.
      createElement(Provider, { store, children: createElement(HookHost) }),
    )
  })
}

/**
 * Dispatches a real keydown on `window` inside act() so any resulting Redux
 * update is flushed before assertions read store state.
 * @param init - KeyboardEvent options (key, modifiers, target override).
 * @example dispatchKeydown({ key: 'e', metaKey: true })
 */
function dispatchKeydown(init: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  target?: EventTarget
}): void {
  const event = new KeyboardEvent('keydown', {
    key: init.key,
    metaKey: Boolean(init.metaKey),
    ctrlKey: Boolean(init.ctrlKey),
    bubbles: true,
    cancelable: true,
  })
  // Some specs need the event to originate from an editable element; redefine
  // `target` because KeyboardEvent ignores it until dispatched against a node.
  if (init.target) {
    Object.defineProperty(event, 'target', { value: init.target })
  }
  act(() => {
    window.dispatchEvent(event)
  })
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('dashboard keyboard shortcuts', () => {
  it('toggles edit mode when Cmd+E is pressed outside an input', () => {
    // Arrange
    const { store } = makeSeededStore(1)
    mountHook(store)

    // Act
    dispatchKeydown({ key: 'e', metaKey: true })

    // Assert
    expect(selectIsEditMode(store.getState())).toBe(true)
  })

  it('toggles edit mode when Ctrl+E is pressed (non-mac modifier path)', () => {
    // Arrange
    const { store } = makeSeededStore(1)
    mountHook(store)

    // Act
    dispatchKeydown({ key: 'e', ctrlKey: true })

    // Assert
    expect(selectIsEditMode(store.getState())).toBe(true)
  })

  it('still toggles edit mode when Shift produces an uppercase E', () => {
    // Arrange
    const { store } = makeSeededStore(1)
    mountHook(store)

    // Act
    dispatchKeydown({ key: 'E', metaKey: true })

    // Assert
    expect(selectIsEditMode(store.getState())).toBe(true)
  })

  it('switches to the matching page when Cmd+digit targets an existing page', () => {
    // Arrange
    const { store, pages } = makeSeededStore(3)
    mountHook(store)

    // Act
    dispatchKeydown({ key: '2', metaKey: true })

    // Assert
    expect(selectCurrentPageId(store.getState())).toBe(pages[1].id)
  })

  it('ignores a Cmd+digit when no page exists at that index', () => {
    // Arrange
    const { store, pages } = makeSeededStore(2)
    mountHook(store)

    // Act
    dispatchKeydown({ key: '9', metaKey: true })

    // Assert — active page is unchanged because page 9 does not exist
    expect(selectCurrentPageId(store.getState())).toBe(pages[0].id)
  })

  it('does nothing for a plain keypress with no Cmd or Ctrl modifier', () => {
    // Arrange
    const { store } = makeSeededStore(1)
    mountHook(store)

    // Act
    dispatchKeydown({ key: 'e' })

    // Assert — edit mode stays off because the modifier guard returned early
    expect(selectIsEditMode(store.getState())).toBe(false)
  })

  it('lets number keys type into inputs instead of switching pages', () => {
    // Arrange
    const { store, pages } = makeSeededStore(3)
    mountHook(store)
    const renameInput = document.createElement('input')
    document.body.appendChild(renameInput)

    // Act
    dispatchKeydown({ key: '2', metaKey: true, target: renameInput })

    // Assert — page is unchanged because the editable-target guard returned early
    expect(selectCurrentPageId(store.getState())).toBe(pages[0].id)
    renameInput.remove()
  })

  it('ignores a modified key that is neither E nor a 1-9 digit', () => {
    // Arrange
    const { store, pages } = makeSeededStore(2)
    mountHook(store)

    // Act
    dispatchKeydown({ key: 'k', metaKey: true })

    // Assert — neither edit mode nor the active page changes
    expect(selectIsEditMode(store.getState())).toBe(false)
    expect(selectCurrentPageId(store.getState())).toBe(pages[0].id)
  })

  it('detaches the window listener on unmount so later keys are ignored', () => {
    // Arrange
    const { store } = makeSeededStore(1)
    mountHook(store)
    act(() => {
      root.unmount()
    })
    // Re-create the root so the shared afterEach unmount is a safe no-op.
    root = createRoot(container)

    // Act
    dispatchKeydown({ key: 'e', metaKey: true })

    // Assert — edit mode stays off because the cleanup removed the listener
    expect(selectIsEditMode(store.getState())).toBe(false)
  })
})
