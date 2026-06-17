// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { isSearchInput } from './isSearchInput'

describe('isSearchInput', () => {
  it('matches the search box so Cmd+A can grab filtered rows while it is focused', () => {
    // Arrange — the skills filter renders as <input type="search">
    const searchInput = document.createElement('input')
    searchInput.type = 'search'

    // Act
    const result = isSearchInput(searchInput)

    // Assert — the bulk-select handler should act on (and blur) this input
    expect(result).toBe(true)
  })

  it('ignores ordinary text inputs so native Cmd+A still selects their text', () => {
    // Arrange — a rename field or any other text input (default type="text")
    const textInput = document.createElement('input')

    // Act
    const result = isSearchInput(textInput)

    // Assert — only the search box is special-cased; text fields keep native Cmd+A
    expect(result).toBe(false)
  })

  it('ignores textareas so multi-line editing keeps native Cmd+A', () => {
    // Arrange — a <textarea> is editable but not a search box
    const textarea = document.createElement('textarea')

    // Act
    const result = isSearchInput(textarea)

    // Assert
    expect(result).toBe(false)
  })

  it('treats no focus (null target) as not the search box', () => {
    // Arrange — document.activeElement can be null before any focus
    const target = null

    // Act
    const result = isSearchInput(target)

    // Assert
    expect(result).toBe(false)
  })
})
