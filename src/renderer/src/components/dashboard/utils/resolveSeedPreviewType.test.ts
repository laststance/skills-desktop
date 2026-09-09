import { Activity } from 'lucide-react'
import { describe, expect, test } from 'vitest'

import type { WidgetDefinition } from '@/renderer/src/components/dashboard/types'
import {
  toGridColumnSpan,
  toGridRowSpan,
} from '@/renderer/src/components/dashboard/types'

import { resolveSeedPreviewType } from './resolveSeedPreviewType'

// Minimal placeholder used everywhere a WidgetDefinition is required but the
// fields beyond `type` are irrelevant to the helper under test.
const PLACEHOLDER_DEFINITION = {
  label: '',
  description: '',
  icon: Activity,
  defaultSize: { w: toGridColumnSpan(1), h: toGridRowSpan(1) },
  minSize: { w: toGridColumnSpan(1), h: toGridRowSpan(1) },
  Component: () => null,
} as const

function makeDefinition(type: WidgetDefinition['type']): WidgetDefinition {
  return { ...PLACEHOLDER_DEFINITION, type }
}

describe('resolveSeedPreviewType', () => {
  test('seeds on Welcome when it is first and the user has not dismissed it', () => {
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

  test('seeds on the next widget when Welcome is first but already dismissed', () => {
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

  test('seeds on the first widget when Welcome is not at the head of the list', () => {
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

  test('seeds nothing when the catalog has no widgets to preview', () => {
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

  test('seeds nothing when Welcome is dismissed and no second widget remains to fall back to', () => {
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
