// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'

import { isEditableTarget } from './isEditableTarget'

describe('isEditableTarget', () => {
  it('lets keyboard shortcuts fire when nothing is focused (null target)', () => {
    // Arrange — no focused element, e.g. document.activeElement before focus
    const target = null

    // Act
    const result = isEditableTarget(target)

    // Assert — null is never an editable surface, so global shortcuts proceed
    expect(result).toBe(false)
  })

  it('stands down for native text inputs so keystrokes reach the field', () => {
    // Arrange — a native <input>
    const input = document.createElement('input')

    // Act
    const result = isEditableTarget(input)

    // Assert — inputs are editable; shortcut listeners must defer
    expect(result).toBe(true)
  })

  it('stands down for textareas so keystrokes reach the field', () => {
    // Arrange — a native <textarea>
    const textarea = document.createElement('textarea')

    // Act
    const result = isEditableTarget(textarea)

    // Assert — textareas are editable; shortcut listeners must defer
    expect(result).toBe(true)
  })

  it('treats a non-HTML element (SVG node) as non-editable, skipping the HTMLElement-only checks', () => {
    // Arrange — an SVG element is an Element but NOT an HTMLElement, so the
    // contenteditable / role branch (guarded by `instanceof HTMLElement`) is
    // skipped entirely and the function falls through to its default.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

    // Act
    const result = isEditableTarget(svg)

    // Assert — SVG nodes are not text-editable, so shortcuts still fire
    expect(result).toBe(false)
  })

  it('stands down for contenteditable elements so typing into rich-text surfaces works', () => {
    // Arrange — a plain <div> made editable via contentEditable
    const editableDiv = document.createElement('div')
    editableDiv.contentEditable = 'true'

    // Act
    const result = isEditableTarget(editableDiv)

    // Assert — contenteditable hosts are editable; shortcut listeners must defer
    expect(result).toBe(true)
  })

  it('stands down for ARIA role="textbox" elements so custom text widgets accept keystrokes', () => {
    // Arrange — a <div> presenting as a textbox via the ARIA role attribute
    const ariaTextbox = document.createElement('div')
    ariaTextbox.setAttribute('role', 'textbox')

    // Act
    const result = isEditableTarget(ariaTextbox)

    // Assert — role=textbox marks a custom editable surface; defer to it
    expect(result).toBe(true)
  })

  it('lets shortcuts fire over an ordinary non-editable element', () => {
    // Arrange — a plain <div> with no editability signals
    const plainDiv = document.createElement('div')

    // Act
    const result = isEditableTarget(plainDiv)

    // Assert — ordinary elements are not editable; global shortcuts proceed
    expect(result).toBe(false)
  })
})
