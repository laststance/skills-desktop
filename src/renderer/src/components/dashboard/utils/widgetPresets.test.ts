import { describe, expect, it } from 'vitest'

import { buildDefaultDashboardPages } from './widgetPresets'

describe('buildDefaultDashboardPages', () => {
  it('lays out the default dashboard as Overview, Discovery, Actions, Personal in that tab order', () => {
    // Arrange / Act
    const pages = buildDefaultDashboardPages()

    // Assert
    expect(pages.map((page) => page.name)).toEqual([
      'Overview',
      'Discovery',
      'Actions',
      'Personal',
    ])
  })

  it('opens the Overview page on Welcome followed by the stats, health, and coverage widgets', () => {
    // Arrange / Act
    const [overviewPage] = buildDefaultDashboardPages()

    // Assert
    expect(overviewPage.widgets.map((widget) => widget.type)).toEqual([
      'welcome',
      'stats',
      'health',
      'coverage',
    ])
  })

  it('keeps every default widget addressable by never reusing a widget id', () => {
    // Arrange / Act
    const pages = buildDefaultDashboardPages()
    const widgetIds = pages.flatMap((page) =>
      page.widgets.map((widget) => widget.id),
    )

    // Assert — Set size equals array length only when every id is unique.
    expect(new Set(widgetIds).size).toBe(widgetIds.length)
  })

  it('keeps every default page addressable by never reusing a page id', () => {
    // Arrange / Act
    const pages = buildDefaultDashboardPages()
    const pageIds = pages.map((page) => page.id)

    // Assert
    expect(new Set(pageIds).size).toBe(pageIds.length)
  })

  it('places every default widget on-grid with a positive footprint', () => {
    // Arrange / Act
    const pages = buildDefaultDashboardPages()

    // Assert
    for (const page of pages) {
      for (const widget of page.widgets) {
        expect(widget.x).toBeGreaterThanOrEqual(0)
        expect(widget.y).toBeGreaterThanOrEqual(0)
        expect(widget.w).toBeGreaterThan(0)
        expect(widget.h).toBeGreaterThan(0)
      }
    }
  })
})
