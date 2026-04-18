import { describe, expect, it } from 'vitest'

import { repositoryId } from '../../../../shared/types'

import { getSourceLinkModel } from './sourceLinkHelpers'

describe('getSourceLinkModel', () => {
  describe('local (no source)', () => {
    it('returns local when source is undefined', () => {
      expect(getSourceLinkModel()).toEqual({ kind: 'local' })
    })

    it('returns local even when sourceUrl is provided but source is missing', () => {
      expect(getSourceLinkModel(undefined, 'https://github.com/x/y')).toEqual({
        kind: 'local',
      })
    })

    it('returns local when source is empty string', () => {
      expect(getSourceLinkModel(repositoryId(''))).toEqual({ kind: 'local' })
    })
  })

  describe('text (source without URL)', () => {
    it('returns text when source is present but sourceUrl is undefined', () => {
      expect(getSourceLinkModel(repositoryId('pbakaus/impeccable'))).toEqual({
        kind: 'text',
        source: 'pbakaus/impeccable',
      })
    })

    it('returns text when sourceUrl is empty string', () => {
      expect(
        getSourceLinkModel(repositoryId('pbakaus/impeccable'), ''),
      ).toEqual({
        kind: 'text',
        source: 'pbakaus/impeccable',
      })
    })
  })

  describe('link (source with URL)', () => {
    it('strips trailing .git from sourceUrl', () => {
      expect(
        getSourceLinkModel(
          repositoryId('pbakaus/impeccable'),
          'https://github.com/pbakaus/impeccable.git',
        ),
      ).toEqual({
        kind: 'link',
        source: 'pbakaus/impeccable',
        href: 'https://github.com/pbakaus/impeccable',
      })
    })

    it('leaves non-.git URLs unchanged', () => {
      expect(
        getSourceLinkModel(
          repositoryId('pbakaus/impeccable'),
          'https://github.com/pbakaus/impeccable',
        ),
      ).toEqual({
        kind: 'link',
        source: 'pbakaus/impeccable',
        href: 'https://github.com/pbakaus/impeccable',
      })
    })

    it('only strips .git at the end, not mid-string', () => {
      expect(
        getSourceLinkModel(
          repositoryId('foo/bar.git-assets'),
          'https://github.com/foo/bar.git-assets',
        ),
      ).toEqual({
        kind: 'link',
        source: 'foo/bar.git-assets',
        href: 'https://github.com/foo/bar.git-assets',
      })
    })
  })
})
