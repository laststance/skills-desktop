import { describe, expect, it } from 'vitest'

import type { DashboardPage } from '@/renderer/src/components/dashboard/types'

import { newDashboardPageId } from './ids'
import { nextPageName } from './nextPageName'

/**
 * Build a widget-free page with a real branded id and the given name. Only the
 * name participates in collision detection, so widgets stay empty.
 * @param name - the page's display name
 * @returns a minimal DashboardPage usable as input to nextPageName
 * @example makePage('Overview').name // => "Overview"
 */
function makePage(name: string): DashboardPage {
  return {
    id: newDashboardPageId(),
    name,
    widgets: [],
  }
}

describe('nextPageName', () => {
  it('numbers the first overflow page after the four named preset pages', () => {
    // Arrange: the default preset — four pages, none named "Page N".
    const pages = [
      makePage('Overview'),
      makePage('Discovery'),
      makePage('Actions'),
      makePage('Personal'),
    ]

    // Act
    const name = nextPageName(pages)

    // Assert: count is 4, so the familiar next number is "Page 5".
    expect(name).toBe('Page 5')
  })

  it('skips a still-present "Page N" so a deleted middle page cannot be duplicated', () => {
    // Arrange: "Page 5" was deleted earlier, leaving "Page 6" behind.
    const pages = [
      makePage('Overview'),
      makePage('Discovery'),
      makePage('Actions'),
      makePage('Personal'),
      makePage('Page 6'),
    ]

    // Act
    const name = nextPageName(pages)

    // Assert: count+1 is "Page 6", which is taken, so it bumps to "Page 7".
    expect(name).toBe('Page 7')
  })

  it('mints "Page 1" when there are no pages', () => {
    // Arrange: an empty dashboard (defensive — the UI keeps at least one page).
    const pages: DashboardPage[] = []

    // Act
    const name = nextPageName(pages)

    // Assert: count is 0, so the first mintable name is "Page 1".
    expect(name).toBe('Page 1')
  })

  it('bumps past several consecutive taken numbers', () => {
    // Arrange: two pages occupy the slots that count+1 would otherwise land on.
    const pages = [makePage('Page 2'), makePage('Page 3')]

    // Act
    const name = nextPageName(pages)

    // Assert: count+1 = 3 ("Page 3" taken) → bumps to the free "Page 4".
    expect(name).toBe('Page 4')
  })
})
