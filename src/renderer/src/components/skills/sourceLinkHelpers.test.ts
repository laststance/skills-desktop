import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'

import { getSourceLinkModel } from './sourceLinkHelpers'

describe('getSourceLinkModel', () => {
  describe('local (no source)', () => {
    it('marks a skill with no source repo as local', () => {
      // Arrange — a skill installed without any source repository.
      // Act
      const model = getSourceLinkModel()

      // Assert
      expect(model).toEqual({ kind: 'local' })
    })

    it('still marks a skill as local when a sourceUrl exists but the source repo is missing', () => {
      // Arrange — a stray sourceUrl with no owning source repo.
      // Act
      const model = getSourceLinkModel(undefined, 'https://github.com/x/y')

      // Assert
      expect(model).toEqual({ kind: 'local' })
    })

    it('treats an empty-string source as a local skill', () => {
      // Arrange — an empty source repo id.
      // Act
      const model = getSourceLinkModel(repositoryId(''))

      // Assert
      expect(model).toEqual({ kind: 'local' })
    })
  })

  describe('text (source without URL)', () => {
    it('shows the source repo as plain text when there is no URL to link to', () => {
      // Arrange — a source repo id with no accompanying URL.
      // Act
      const model = getSourceLinkModel(repositoryId('pbakaus/impeccable'))

      // Assert
      expect(model).toEqual({
        kind: 'text',
        source: 'pbakaus/impeccable',
      })
    })

    it('shows the source repo as plain text when the URL is an empty string', () => {
      // Arrange — a source repo id with an empty URL.
      // Act
      const model = getSourceLinkModel(repositoryId('pbakaus/impeccable'), '')

      // Assert
      expect(model).toEqual({
        kind: 'text',
        source: 'pbakaus/impeccable',
      })
    })
  })

  describe('link (source with URL)', () => {
    it('drops a trailing .git so the rendered link points at the browsable repo page', () => {
      // Arrange — a clone URL that ends in .git.
      // Act
      const model = getSourceLinkModel(
        repositoryId('pbakaus/impeccable'),
        'https://github.com/pbakaus/impeccable.git',
      )

      // Assert
      expect(model).toEqual({
        kind: 'link',
        source: 'pbakaus/impeccable',
        href: 'https://github.com/pbakaus/impeccable',
      })
    })

    it('keeps a plain repo URL intact when it has no .git suffix', () => {
      // Arrange — a browsable repo URL with no .git suffix.
      // Act
      const model = getSourceLinkModel(
        repositoryId('pbakaus/impeccable'),
        'https://github.com/pbakaus/impeccable',
      )

      // Assert
      expect(model).toEqual({
        kind: 'link',
        source: 'pbakaus/impeccable',
        href: 'https://github.com/pbakaus/impeccable',
      })
    })

    it('only strips .git at the very end so a mid-string ".git-assets" repo survives', () => {
      // Arrange — a repo whose name legitimately contains ".git" mid-string.
      // Act
      const model = getSourceLinkModel(
        repositoryId('foo/bar.git-assets'),
        'https://github.com/foo/bar.git-assets',
      )

      // Assert
      expect(model).toEqual({
        kind: 'link',
        source: 'foo/bar.git-assets',
        href: 'https://github.com/foo/bar.git-assets',
      })
    })
  })
})
