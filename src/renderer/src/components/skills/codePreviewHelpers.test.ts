import { describe, expect, test } from 'vitest'

import { toAbsolutePath } from '@/shared/types'

import { resolvePreviewPaneState } from './codePreviewHelpers'

const ACTIVE_FILE = toAbsolutePath('/home/user/.agents/skills/tdd/SKILL.md')

describe('resolvePreviewPaneState', () => {
  test('shows the loading pane while the file list is still in flight', () => {
    // Arrange
    const input = { loading: true, loadFailed: false, activeFile: null }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'loading' })
  })

  test('shows the unavailable pane when the file list could not be read', () => {
    // Arrange
    const input = { loading: false, loadFailed: true, activeFile: null }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'unavailable' })
  })

  test('shows the empty pane when the list succeeded but held no previewable file', () => {
    // Arrange
    const input = { loading: false, loadFailed: false, activeFile: null }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'empty' })
  })

  test('shows the ready pane carrying the active file once one is selected', () => {
    // Arrange
    const input = { loading: false, loadFailed: false, activeFile: ACTIVE_FILE }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'ready', activeFile: ACTIVE_FILE })
  })

  test('reports an unreadable list rather than an empty one when both look empty', () => {
    // Arrange — a failed list leaves activeFile null exactly like a skill with
    // nothing to preview. Getting this order wrong tells the user their skill
    // has no files when the truth is the app could not read the folder.
    const input = { loading: false, loadFailed: true, activeFile: null }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'unavailable' })
  })

  test('keeps showing the spinner while a load that will fail is still running', () => {
    // Arrange — loading outranks loadFailed so a stale failure flag from the
    // previous skill cannot flash its notice over the new skill's spinner.
    const input = { loading: true, loadFailed: true, activeFile: null }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'loading' })
  })

  test('never routes a failed list to the file pane, even with a file selected', () => {
    // Arrange — defensive, not a state {@link useCodePreview} can currently
    // produce: `loadFailed` is set only when the list itself rejected, which
    // leaves `files` empty and `activeFile` null. Pinned anyway because this
    // is the one ordering a future caller could get wrong -- routing a failure
    // to the file pane would render a tab with no readable content behind it.
    const input = { loading: false, loadFailed: true, activeFile: ACTIVE_FILE }

    // Act
    const state = resolvePreviewPaneState(input)

    // Assert
    expect(state).toEqual({ kind: 'unavailable' })
  })
})
