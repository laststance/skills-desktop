// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from 'vitest'

import { isInspectorFocused } from './isInspectorFocused'

/**
 * Mount a minimal Inspector pane and a list control side by side.
 * @returns The Inspector's focusable file preview, its text node, and a list button.
 * @example const { filePreview, fileText, listButton } = mountPanes()
 */
function mountPanes(): {
  filePreview: HTMLElement
  fileText: Text
  listButton: HTMLButtonElement
} {
  const inspectorPane = document.createElement('aside')
  inspectorPane.setAttribute('data-inspector-pane', '')
  const filePreview = document.createElement('div')
  filePreview.tabIndex = 0
  const fileText = document.createTextNode('# SKILL.md body')
  filePreview.append(fileText)
  inspectorPane.append(filePreview)

  const listButton = document.createElement('button')
  listButton.textContent = 'Clear'
  document.body.append(inspectorPane, listButton)
  return { filePreview, fileText, listButton }
}

describe('isInspectorFocused', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  test('leaves ⌘A to the Inspector when its file preview holds focus', () => {
    // Arrange
    const { filePreview } = mountPanes()

    // Act
    const result = isInspectorFocused(filePreview, null)

    // Assert
    expect(result).toBe(true)
  })

  test('keeps ⌘A on the list when a list control holds focus even with the caret in the Inspector', () => {
    // Arrange
    const { fileText, listButton } = mountPanes()

    // Act
    const result = isInspectorFocused(listButton, fileText)

    // Assert
    expect(result).toBe(false)
  })

  test('leaves ⌘A to the Inspector when only the body is focused and the caret sits in its text', () => {
    // Arrange
    const { fileText } = mountPanes()

    // Act
    const result = isInspectorFocused(document.body, fileText)

    // Assert
    expect(result).toBe(true)
  })

  test('keeps ⌘A on the list when only the body is focused and there is no caret', () => {
    // Arrange
    mountPanes()

    // Act
    const result = isInspectorFocused(document.body, null)

    // Assert
    expect(result).toBe(false)
  })

  test('keeps ⌘A on the list when nothing is focused and the caret sits outside the Inspector', () => {
    // Arrange
    const { listButton } = mountPanes()

    // Act
    const result = isInspectorFocused(null, listButton)

    // Assert
    expect(result).toBe(false)
  })
})
