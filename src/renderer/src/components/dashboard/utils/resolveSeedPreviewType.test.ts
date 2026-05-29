import { Activity } from 'lucide-react'
import { describe, expect, it } from 'vitest'

import type { WidgetDefinition } from '@/renderer/src/components/dashboard/types'

import { resolveSeedPreviewType } from './resolveSeedPreviewType'

// Minimal placeholder used everywhere a WidgetDefinition is required but the
// fields beyond `type` are irrelevant to the helper under test.
const PLACEHOLDER_DEFINITION = {
  label: '',
  description: '',
  icon: Activity,
  defaultSize: { w: 1, h: 1 },
  minSize: { w: 1, h: 1 },
  Component: () => null,
} as const

function makeDefinition(type: WidgetDefinition['type']): WidgetDefinition {
  return { ...PLACEHOLDER_DEFINITION, type }
}

describe('resolveSeedPreviewType', () => {
  it('seeds on Welcome when it is first and the user has not dismissed it', () => {
    // Arrange
    const availableWidgets = [
      makeDefinition('welcome'),
      makeDefinition('stats'),
    ]

    // Act
    const seed = resolveSeedPreviewType({
      availableWidgets,
      isWelcomeDismissed: false,
    })

    // Assert
    expect(seed).toBe('welcome')
  })

  it('seeds on the next widget when Welcome is first but already dismissed', () => {
    // Arrange
    const availableWidgets = [
      makeDefinition('welcome'),
      makeDefinition('stats'),
    ]

    // Act
    const seed = resolveSeedPreviewType({
      availableWidgets,
      isWelcomeDismissed: true,
    })

    // Assert
    expect(seed).toBe('stats')
  })

  it('seeds on the first widget when Welcome is not at the head of the list', () => {
    // Arrange — feature flag could reorder; the fallthrough rule only triggers
    // when Welcome is literally first.
    const availableWidgets = [
      makeDefinition('stats'),
      makeDefinition('welcome'),
    ]

    // Act
    const seed = resolveSeedPreviewType({
      availableWidgets,
      isWelcomeDismissed: true,
    })

    // Assert
    expect(seed).toBe('stats')
  })

  it('seeds nothing when the catalog has no widgets to preview', () => {
    // Arrange
    const availableWidgets: readonly WidgetDefinition[] = []

    // Act
    const seed = resolveSeedPreviewType({
      availableWidgets,
      isWelcomeDismissed: false,
    })

    // Assert
    expect(seed).toBeUndefined()
  })

  it('seeds nothing when Welcome is dismissed and no second widget remains to fall back to', () => {
    // Arrange
    const availableWidgets = [makeDefinition('welcome')]

    // Act
    const seed = resolveSeedPreviewType({
      availableWidgets,
      isWelcomeDismissed: true,
    })

    // Assert
    expect(seed).toBeUndefined()
  })
})
