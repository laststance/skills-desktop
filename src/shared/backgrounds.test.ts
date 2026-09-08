import { describe, expect, it } from 'vitest'

import { IPC_ARG_SCHEMAS } from '../main/ipc/ipc-schemas'

import {
  BackgroundApplyInputSchema,
  BackgroundCropSchema,
  BackgroundSettingsSchema,
  BackgroundUploadSchema,
} from './backgrounds'
import { SettingsSchema } from './settings'

const uploadId = 'bff22dd2-3507-4e22-b580-28f4d97d8216'
const displayId = 'ebc719ce-6c5c-4c72-89b0-38e2b13f616e'
const requestId = 'f627d32a-3641-4d52-9814-22e4d6e2f2fb'
const fullCrop = { x: 0, y: 0, width: 100, height: 100 }
const savedUpload = {
  id: uploadId,
  title: 'My photograph',
  width: 1920,
  height: 1080,
  format: 'jpeg',
  bytes: 100_000,
  importedAt: '2026-09-08T00:00:00.000Z',
}

describe('background settings and IPC boundaries', () => {
  it('starts legacy installations without an image while preserving unrelated preferences', () => {
    // Arrange
    const legacySettings = {
      defaultSkillTab: 'info',
      preferredTerminal: 'warp',
      windowBackgroundOpacityPercent: 42,
    }
    // Act
    const settings = SettingsSchema.parse(legacySettings)
    // Assert
    expect(settings.background).toEqual({
      selected: null,
      layout: 'fill',
      uploads: [],
      hasAppliedImage: false,
    })
    expect(settings.defaultSkillTab).toBe('info')
    expect(settings.preferredTerminal).toBe('warp')
    expect(settings.windowBackgroundOpacityPercent).toBe(42)
  })

  it.each([
    { kind: 'upload-draft', draftId: uploadId },
    { kind: 'upload', uploadId },
    { kind: 'builtin', builtinId: 'alpine-lake' },
    {
      kind: 'unsplash',
      photo: {
        id: 'alpine-lake',
        width: 2400,
        height: 1600,
        description: null,
        altDescription: 'Alpine lake',
        urls: {
          raw: 'https://images.unsplash.com/photo-alpine-lake?ixid=fixture',
          small:
            'https://images.unsplash.com/photo-alpine-lake?ixid=fixture&w=400',
        },
        links: {
          html: 'https://unsplash.com/photos/alpine-lake',
          downloadLocation:
            'https://api.unsplash.com/photos/alpine-lake/download?ixid=fixture',
        },
        photographer: {
          name: 'Fixture Photographer',
          username: 'fixture',
          profileUrl: 'https://unsplash.com/@fixture',
        },
      },
    },
  ])('accepts the explicit application source %j', (source) => {
    // Arrange
    const input = { requestId, source, crop: fullCrop, aspect: 'original' }
    // Act
    const result = BackgroundApplyInputSchema.parse(input)
    // Assert
    expect(result.source).toEqual(source)
  })

  it.each([
    { kind: 'upload', draftId: uploadId },
    { kind: 'upload-draft', uploadId },
    { kind: 'upload-draft', draftId: '/Users/me/photo.jpg' },
    { kind: 'upload', uploadId: '../other-file' },
    { kind: 'builtin', builtinId: 'unknown-image' },
  ])('rejects a confused or path-based application source %j', (source) => {
    // Arrange / Act
    const result = BackgroundApplyInputSchema.safeParse({
      requestId,
      source,
      crop: fullCrop,
      aspect: 'original',
    })
    // Assert
    expect(result.success).toBe(false)
  })

  it('never persists a transient upload token or an unowned display path', () => {
    // Arrange
    const background = { layout: 'fill', uploads: [], hasAppliedImage: true }
    // Act / Assert
    expect(
      BackgroundSettingsSchema.safeParse({
        ...background,
        selected: {
          source: { kind: 'upload-draft', draftId: uploadId },
          crop: fullCrop,
          aspect: 'original',
          displayId,
        },
      }).success,
    ).toBe(false)
    expect(
      BackgroundSettingsSchema.safeParse({
        ...background,
        selected: {
          source: { kind: 'builtin', builtinId: 'alpine-lake' },
          crop: fullCrop,
          aspect: 'original',
          displayId: '/tmp/image.webp',
        },
      }).success,
    ).toBe(false)
  })

  it('rejects a selected upload missing from its atomic library snapshot', () => {
    // Arrange
    const selected = {
      source: { kind: 'upload', uploadId },
      crop: fullCrop,
      aspect: 'original',
      displayId,
    }
    // Act
    const result = BackgroundSettingsSchema.safeParse({
      selected,
      layout: 'fill',
      uploads: [],
      hasAppliedImage: true,
    })
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects duplicate ownership records and a selection with a cleared first-use flag', () => {
    // Arrange
    const selected = {
      source: { kind: 'upload', uploadId },
      crop: fullCrop,
      aspect: 'original',
      displayId,
    }
    // Act / Assert
    expect(
      BackgroundSettingsSchema.safeParse({
        selected: null,
        layout: 'fill',
        uploads: [savedUpload, savedUpload],
        hasAppliedImage: true,
      }).success,
    ).toBe(false)
    expect(
      BackgroundSettingsSchema.safeParse({
        selected,
        layout: 'fill',
        uploads: [savedUpload],
        hasAppliedImage: false,
      }).success,
    ).toBe(false)
  })

  it('restores an applied background without rewriting its crop, layout or ownership metadata', () => {
    // Arrange
    const background = {
      selected: {
        source: { kind: 'upload', uploadId },
        crop: fullCrop,
        aspect: '16:9',
        displayId,
      },
      layout: 'tile',
      uploads: [savedUpload],
      hasAppliedImage: true,
    }
    // Act
    const parsed = SettingsSchema.parse({ background })
    // Assert
    expect(parsed.background).toEqual(background)
  })

  it.each([
    { width: 1920, height: 1080, accepted: true },
    { width: 1080, height: 1920, accepted: true },
    { width: 1919, height: 1080, accepted: false },
    { width: 1920, height: 1079, accepted: false },
    { width: 10_000, height: 8_000, accepted: true },
    { width: 10_001, height: 8_000, accepted: false },
  ])(
    'enforces oriented upload resolution $width × $height',
    ({ width, height, accepted }) => {
      // Arrange / Act
      const result = BackgroundUploadSchema.safeParse({
        ...savedUpload,
        width,
        height,
      })
      // Assert
      expect(result.success).toBe(accepted)
    },
  )

  it.each([
    { bytes: 20_971_520, accepted: true },
    { bytes: 20_971_521, accepted: false },
  ])(
    'enforces the upload byte boundary at $bytes bytes',
    ({ bytes, accepted }) => {
      // Arrange / Act
      const result = BackgroundUploadSchema.safeParse({ ...savedUpload, bytes })
      // Assert
      expect(result.success).toBe(accepted)
    },
  )

  it.each([
    { x: -1, y: 0, width: 100, height: 100 },
    { x: 50, y: 0, width: 51, height: 100 },
    { x: 0, y: 1, width: 100, height: 100 },
    { x: 0, y: 0, width: 0, height: 100 },
    { x: Number.NaN, y: 0, width: 100, height: 100 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 100 },
  ])('rejects an invalid crop before image work starts: %j', (crop) => {
    // Arrange / Act
    const result = BackgroundCropSchema.safeParse(crop)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts fractional crops that stay exactly inside the oriented image', () => {
    // Arrange
    const crop = { x: 12.5, y: 25, width: 87.5, height: 75 }
    // Act / Assert
    expect(BackgroundCropSchema.parse(crop)).toEqual(crop)
  })

  it('prevents generic preference writes from forging library ownership or resetting first-use behavior', () => {
    // Arrange
    const forgedPatch = {
      background: {
        selected: null,
        layout: 'fill',
        uploads: [],
        hasAppliedImage: false,
      },
    }
    // Act
    const result = IPC_ARG_SCHEMAS['settings:set']?.safeParse([forgedPatch])
    // Assert
    expect(result?.success).toBe(false)
  })

  it('accepts only owned IDs for draft cleanup and saved-upload removal', () => {
    // Arrange / Act / Assert
    expect(
      IPC_ARG_SCHEMAS['backgrounds:discardDraft']?.safeParse([
        { draftId: uploadId },
      ]).success,
    ).toBe(true)
    expect(
      IPC_ARG_SCHEMAS['backgrounds:removeUpload']?.safeParse([{ uploadId }])
        .success,
    ).toBe(true)
    expect(
      IPC_ARG_SCHEMAS['backgrounds:discardDraft']?.safeParse([
        { draftId: uploadId, path: '/tmp/another-file' },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['backgrounds:removeUpload']?.safeParse([
        { uploadId: '../../original.jpg' },
      ]).success,
    ).toBe(false)
    expect(
      IPC_ARG_SCHEMAS['backgrounds:clear']?.safeParse(['/tmp/file']).success,
    ).toBe(false)
  })

  it('allows explicit display Retry without accepting renderer-supplied paths or revision state', () => {
    // Arrange
    const schema = IPC_ARG_SCHEMAS['backgrounds:retryDisplay']
    // Act / Assert
    expect(schema?.safeParse([]).success).toBe(true)
    expect(schema?.safeParse(['/tmp/background.png']).success).toBe(false)
    expect(schema?.safeParse([{ displayRetryRevision: 1 }]).success).toBe(false)
    expect(schema?.safeParse([undefined]).success).toBe(false)
  })
})
