// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from 'vitest'

import { releaseKeyboardToList } from './releaseKeyboardToList'

/**
 * Mount a search box, an Inspector pane, and a list with a control and a
 * card description, the surfaces a list press can leave the keyboard on.
 * @returns The mounted elements and the Inspector's and card's text nodes.
 * @example const { searchInput, listButton } = mountPanes()
 */
function mountPanes(): {
  searchInput: HTMLInputElement
  inspectorButton: HTMLButtonElement
  fileText: Text
  listButton: HTMLButtonElement
  cardText: Text
} {
  const searchInput = document.createElement('input')

  const inspectorPane = document.createElement('aside')
  inspectorPane.setAttribute('data-inspector-pane', '')
  const inspectorButton = document.createElement('button')
  inspectorButton.textContent = 'Open folder'
  const fileText = document.createTextNode('# SKILL.md body')
  inspectorPane.append(inspectorButton, fileText)

  const list = document.createElement('div')
  const listButton = document.createElement('button')
  listButton.textContent = 'Clear'
  const cardText = document.createTextNode('Task management skill')
  list.append(listButton, cardText)

  document.body.append(searchInput, inspectorPane, list)
  return { searchInput, inspectorButton, fileText, listButton, cardText }
}

afterEach(() => {
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

describe('releaseKeyboardToList', () => {
  test('takes focus out of the search box, so Esc and ⌘A reach the list', () => {
    // Arrange
    const { searchInput } = mountPanes()
    searchInput.focus()

    // Act
    releaseKeyboardToList()

    // Assert
    expect(document.activeElement).toBe(document.body)
  })

  test('takes focus off an Inspector control, so ⌘A ticks rows instead of selecting the file text', () => {
    // Arrange
    const { inspectorButton } = mountPanes()
    inspectorButton.focus()

    // Act
    releaseKeyboardToList()

    // Assert
    expect(document.activeElement).toBe(document.body)
  })

  test('drops a caret left in the Inspector file text while the page body has focus', () => {
    // Arrange
    const { fileText } = mountPanes()
    document.getSelection()?.collapse(fileText, 2)

    // Act
    releaseKeyboardToList()

    // Assert
    expect(document.getSelection()?.anchorNode ?? null).toBeNull()
  })

  test('keeps focus on a list control such as the header Clear button', () => {
    // Arrange
    const { listButton } = mountPanes()
    listButton.focus()

    // Act
    releaseKeyboardToList()

    // Assert
    expect(document.activeElement).toBe(listButton)
  })

  test('keeps a text selection the user made inside the list', () => {
    // Arrange
    const { cardText } = mountPanes()
    document.getSelection()?.collapse(cardText, 4)

    // Act
    releaseKeyboardToList()

    // Assert
    expect(document.getSelection()?.anchorNode ?? null).toBe(cardText)
  })
})
