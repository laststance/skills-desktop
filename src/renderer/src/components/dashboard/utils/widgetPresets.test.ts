import { describe, expect, it } from 'vitest'

import { buildDefaultDashboardPages } from './widgetPresets'

describe('buildDefaultDashboardPages', () => {
  it('produces four pages with the expected names in order', () => {
    const pages = buildDefaultDashboardPages()
    expect(pages.map((page) => page.name)).toEqual([
      'Overview',
      'Discovery',
      'Actions',
      'Personal',
    ])
  })

  it('Overview page starts with Welcome and has a stats pair', () => {
    const [overviewPage] = buildDefaultDashboardPages()
    expect(overviewPage.widgets.map((widget) => widget.type)).toEqual([
      'welcome',
      'stats',
      'health',
      'coverage',
    ])
  })

  it('gives every widget a unique id', () => {
    const pages = buildDefaultDashboardPages()
    const widgetIds = pages.flatMap((page) =>
      page.widgets.map((widget) => widget.id),
    )
    // Set size equals array length only when every id is unique.
    expect(new Set(widgetIds).size).toBe(widgetIds.length)
  })

  it('gives every page a unique id', () => {
    const pages = buildDefaultDashboardPages()
    const pageIds = pages.map((page) => page.id)
    expect(new Set(pageIds).size).toBe(pageIds.length)
  })

  it('assigns non-negative grid coordinates to every widget', () => {
    const pages = buildDefaultDashboardPages()
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
