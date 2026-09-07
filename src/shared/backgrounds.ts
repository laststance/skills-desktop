import { z } from 'zod'

import { UnsplashPhotoSchema } from '../../website/src/lib/unsplash-contract'

import {
  BACKGROUND_CROP_ASPECTS,
  BACKGROUND_FULL_CROP_PERCENT,
  BACKGROUND_LAYOUTS,
  BACKGROUND_MAX_UPLOAD_BYTES,
  BACKGROUND_MAX_UPLOAD_PIXELS,
  BACKGROUND_MIN_LONG_EDGE_PX,
  BACKGROUND_MIN_SHORT_EDGE_PX,
  BACKGROUND_TITLE_MAX_LENGTH,
  BUILTIN_BACKGROUND_IDS,
} from './constants'

/** Opaque IDs select app-owned records, never caller-supplied filesystem paths. */
export const BackgroundOwnedIdSchema = z.uuid()
export const BackgroundLayoutSchema = z.enum(BACKGROUND_LAYOUTS)
export const BackgroundCropAspectSchema = z.enum(BACKGROUND_CROP_ASPECTS)

/** Oriented-source percentages survive preview resizing; Main validates real crop pixels again. */
export const BackgroundCropSchema = z
  .strictObject({
    x: z.number().min(0).max(BACKGROUND_FULL_CROP_PERCENT),
    y: z.number().min(0).max(BACKGROUND_FULL_CROP_PERCENT),
    width: z.number().positive().max(BACKGROUND_FULL_CROP_PERCENT),
    height: z.number().positive().max(BACKGROUND_FULL_CROP_PERCENT),
  })
  .refine(
    (crop) =>
      crop.x + crop.width <= BACKGROUND_FULL_CROP_PERCENT &&
      crop.y + crop.height <= BACKGROUND_FULL_CROP_PERCENT,
    'Crop must stay within the oriented source',
  )

/** Stable references may be persisted; transient draft tokens are deliberately excluded. */
export const BackgroundSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('builtin'),
    builtinId: z.enum(BUILTIN_BACKGROUND_IDS),
  }),
  z.strictObject({
    kind: z.literal('upload'),
    uploadId: BackgroundOwnedIdSchema,
  }),
  z.strictObject({ kind: z.literal('unsplash'), photo: UnsplashPhotoSchema }),
])

/** Apply alone accepts an owned draft; accepting it transfers ownership before IPC acknowledgement. */
export const BackgroundApplySourceSchema = z.discriminatedUnion('kind', [
  ...BackgroundSourceSchema.options,
  z.strictObject({
    kind: z.literal('upload-draft'),
    draftId: BackgroundOwnedIdSchema,
  }),
])

/** Persisted originals are app-owned IDs; source paths and image payloads never enter settings. */
export const BackgroundUploadSchema = z
  .strictObject({
    id: BackgroundOwnedIdSchema,
    title: z.string().trim().min(1).max(BACKGROUND_TITLE_MAX_LENGTH),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    format: z.enum(['jpeg', 'png', 'webp']),
    bytes: z.number().int().positive().max(BACKGROUND_MAX_UPLOAD_BYTES),
    importedAt: z.iso.datetime(),
  })
  .refine(
    (upload) =>
      Math.max(upload.width, upload.height) >= BACKGROUND_MIN_LONG_EDGE_PX &&
      Math.min(upload.width, upload.height) >= BACKGROUND_MIN_SHORT_EDGE_PX &&
      upload.width * upload.height <= BACKGROUND_MAX_UPLOAD_PIXELS,
    'Upload resolution must satisfy the oriented-source limits',
  )

/** Local display IDs refer to prepared crops; online images stay hotlinked with a percentage crop. */
export const BackgroundSelectionSchema = z
  .strictObject({
    source: BackgroundSourceSchema,
    crop: BackgroundCropSchema,
    aspect: BackgroundCropAspectSchema,
    displayId: BackgroundOwnedIdSchema.optional(),
  })
  .refine(
    (selection) =>
      selection.source.kind === 'unsplash'
        ? selection.displayId === undefined
        : selection.displayId !== undefined,
    'Only local backgrounds must reference a prepared display image',
  )

/** Missing legacy background settings default safely; invalid records never authorize file cleanup. */
export const BackgroundSettingsSchema = z
  .strictObject({
    selected: BackgroundSelectionSchema.nullable(),
    layout: BackgroundLayoutSchema,
    uploads: z.array(BackgroundUploadSchema),
    hasAppliedImage: z.boolean(),
  })
  .superRefine((background, context) => {
    const uploadIds = new Set(background.uploads.map((upload) => upload.id))
    // Duplicate ownership records would make removal ambiguous, so reject the whole background value.
    if (uploadIds.size !== background.uploads.length) {
      context.addIssue({ code: 'custom', message: 'Upload IDs must be unique' })
    }
    // A saved selection cannot point at an upload absent from the same atomic library snapshot.
    if (
      background.selected?.source.kind === 'upload' &&
      !uploadIds.has(background.selected.source.uploadId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Selected upload is missing from the library',
      })
    }
    if (background.selected !== null && !background.hasAppliedImage) {
      context.addIssue({
        code: 'custom',
        message: 'A selected background must retain its first-application flag',
      })
    }
  })

/** The same request ID deduplicates double Apply; retry retains acknowledged provider side effects. */
export const BackgroundApplyInputSchema = z.strictObject({
  requestId: z.uuid(),
  source: BackgroundApplySourceSchema,
  crop: BackgroundCropSchema,
  aspect: BackgroundCropAspectSchema,
  retryOperationId: z.number().int().positive().optional(),
})

export type BackgroundCrop = z.infer<typeof BackgroundCropSchema>
export type BackgroundCropAspect = z.infer<typeof BackgroundCropAspectSchema>
export type BackgroundLayout = z.infer<typeof BackgroundLayoutSchema>
export type BackgroundSource = z.infer<typeof BackgroundSourceSchema>
export type BackgroundApplySource = z.infer<typeof BackgroundApplySourceSchema>
export type BackgroundUpload = z.infer<typeof BackgroundUploadSchema>
export type BackgroundSelection = z.infer<typeof BackgroundSelectionSchema>
export type BackgroundSettings = z.infer<typeof BackgroundSettingsSchema>
export type BackgroundApplyInput = z.infer<typeof BackgroundApplyInputSchema>

/** Full-source default shared by Reset, bundled images and first-time crop editing. */
export const DEFAULT_BACKGROUND_CROP: BackgroundCrop = {
  x: 0,
  y: 0,
  width: BACKGROUND_FULL_CROP_PERCENT,
  height: BACKGROUND_FULL_CROP_PERCENT,
}
export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  selected: null,
  layout: 'fill',
  uploads: [],
  hasAppliedImage: false,
}

/** Main supplies a bounded image URL and its dimensions; renderers never request or open a path. */
export interface BackgroundImageDescriptor {
  url: string
  width: number
  height: number
}

/** Credits use verified metadata for bundled and online Unsplash images; uploads have no credit. */
export interface BackgroundCredit {
  photographerName: string
  photographerUrl: string
  photoUrl: string
}

/** Thumbnail metadata keeps library browsing separate from expensive full-image preparation. */
export interface BackgroundCatalogItem {
  source: BackgroundSource
  title: string
  width: number
  height: number
  thumbnail: BackgroundImageDescriptor | null
  credit: BackgroundCredit | null
}

export interface BackgroundCatalog {
  builtins: BackgroundCatalogItem[]
  uploads: BackgroundCatalogItem[]
}

/** Editor dimensions are the oriented original; preview dimensions never determine crop acceptance. */
export interface BackgroundPreview {
  source: BackgroundApplySource
  title: string
  width: number
  height: number
  image: BackgroundImageDescriptor
  credit: BackgroundCredit | null
}

/** Import returns an uncommitted token; cancelling it cannot be confused with deleting a saved upload. */
export interface BackgroundUploadDraft extends BackgroundPreview {
  source: Extract<BackgroundApplySource, { kind: 'upload-draft' }>
}

/** Crop describes the displayed URL: full crop for prepared local files, accepted crop for hotlinks. */
export interface BackgroundDisplay {
  selection: BackgroundSelection
  image: BackgroundImageDescriptor
  crop: BackgroundCrop
  title: string
  credit: BackgroundCredit | null
}

/** Increasing IDs let reopened windows reject older operations while Main owns accepted inputs. */
export interface BackgroundApplyAcceptance {
  operationId: number
  requestId: string
}

/** Main retains a recoverable error without exposing provider secrets or arbitrary filesystem paths. */
export interface BackgroundOperationError {
  code:
    | 'invalid-image'
    | 'invalid-crop'
    | 'source-missing'
    | 'provider-unavailable'
    | 'rate-limited'
    | 'notification-uncertain'
    | 'save-failed'
  message: string
  retryAfterSeconds?: number
}

/** Only Apply has long-running state; Clear and Remove remain ordinary serialized settings mutations. */
export type BackgroundOperation = BackgroundApplyAcceptance & {
  source: BackgroundApplySource
} & (
    | { status: 'applying' }
    | { status: 'succeeded'; opacityAdjusted: boolean }
    | { status: 'failed'; error: BackgroundOperationError }
    | { status: 'superseded' }
  )

/** Revisions also order same-operation progress, so a delayed snapshot cannot overwrite a newer result. */
export interface BackgroundSnapshot {
  revision: number
  operation: BackgroundOperation | null
  display: BackgroundDisplay | null
}
