import { describe, expect, it } from 'vitest'

import { listAvailableWidgets } from '@/renderer/src/components/dashboard/widgets/registry'

/**
 * Behavior spec for the widget picker's experimental gate. The picker reads
 * `listAvailableWidgets(FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL)`, so the
 * boolean argument is the only thing standing between an experimental widget
 * (agent-heatmap, activity-timeline) and a user being able to drop a
 * half-finished widget onto their dashboard.
 */
describe('listAvailableWidgets — experimental gate', () => {
  it('hides experimental widgets from the picker when the flag is disabled', () => {
    // Arrange — flag off mirrors the shipped default
    // (FEATURE_FLAGS.ENABLE_DASHBOARD_EXPERIMENTAL === false).
    const experimentalEnabled = false

    // Act
    const result = listAvailableWidgets(experimentalEnabled)
    const visibleTypes = result.map((widget) => widget.type)

    // Assert — the two experimental widgets are filtered out, leaving the 8
    // stable widgets the picker should offer by default.
    expect(visibleTypes).not.toContain('agent-heatmap')
    expect(visibleTypes).not.toContain('activity-timeline')
    expect(result.length).toBe(8)
  })

  it('includes experimental widgets in the picker when the flag is enabled', () => {
    // Arrange — flag on simulates flipping ENABLE_DASHBOARD_EXPERIMENTAL to true.
    const experimentalEnabled = true

    // Act
    const result = listAvailableWidgets(experimentalEnabled)
    const visibleTypes = result.map((widget) => widget.type)

    // Assert — every widget is offered, including the two experimental ones.
    expect(visibleTypes).toContain('agent-heatmap')
    expect(visibleTypes).toContain('activity-timeline')
    expect(result.length).toBe(10)
  })
})
