import { oc, type ContractRouterClient } from '@orpc/contract'
import { z } from 'zod'

import {
  UNSPLASH_API_ORIGIN,
  UNSPLASH_IMAGE_MAX_DIMENSION_PX,
  UNSPLASH_IMAGE_ORIGIN,
  UNSPLASH_MAX_PAGE,
  UNSPLASH_METADATA_MAX_LENGTH,
  UNSPLASH_NAME_MAX_LENGTH,
  UNSPLASH_PAGE_SIZE,
  UNSPLASH_QUERY_MAX_LENGTH,
  UNSPLASH_URL_MAX_LENGTH,
} from './constants'

/** Public photo IDs stay path-safe before either client requests a provider action. */
const UnsplashPhotoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)

/** CDN URLs preserve Unsplash attribution tracking and cannot become arbitrary fetch targets. */
export const UnsplashImageUrlSchema = z
  .url()
  .max(UNSPLASH_URL_MAX_LENGTH)
  .refine((value) => {
    const url = URL.parse(value)
    if (!url) return false
    return (
      url.origin === UNSPLASH_IMAGE_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/photo-[A-Za-z0-9-]+$/.test(url.pathname) &&
      Boolean(url.searchParams.get('ixid'))
    )
  }, 'Expected a direct Unsplash photo URL with ixid')

/** Credit links can open Unsplash pages only; Main still enforces its external-link policy. */
const unsplashCreditUrlSchema = z
  .url()
  .max(UNSPLASH_URL_MAX_LENGTH)
  .refine((value) => {
    const url = URL.parse(value)
    if (!url) return false
    return (
      url.origin === 'https://unsplash.com' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/(?:photos\/[A-Za-z0-9_-]+|@[A-Za-z0-9_]+)$/.test(url.pathname)
    )
  }, 'Expected an Unsplash photographer or photo page')

/** Notification URLs accept only provider tracking; photo identity is cross-checked below. */
const unsplashDownloadLocationSchema = z
  .url()
  .max(UNSPLASH_URL_MAX_LENGTH)
  .refine((value) => {
    const url = URL.parse(value)
    if (!url) return false
    const parameters = [...url.searchParams.keys()]
    return (
      url.origin === UNSPLASH_API_ORIGIN &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/photos\/[A-Za-z0-9_-]+\/download$/.test(url.pathname) &&
      parameters.every((parameter) => parameter === 'ixid') &&
      parameters.length === new Set(parameters).size &&
      (!url.searchParams.has('ixid') || Boolean(url.searchParams.get('ixid')))
    )
  }, 'Expected an exact Unsplash photo download endpoint')

/** Server and Main validate the same photo/path identity before sending credentials. */
export const UnsplashDownloadInputSchema = z
  .strictObject({
    photoId: UnsplashPhotoIdSchema,
    downloadLocation: unsplashDownloadLocationSchema,
  })
  .refine(
    ({ photoId, downloadLocation }) =>
      URL.parse(downloadLocation)?.pathname === `/photos/${photoId}/download`,
    'Photo ID does not match the download location',
  )

/** Server-free metadata shared by gallery search, saved selections and Main Apply. */
export const UnsplashPhotoSchema = z
  .strictObject({
    id: UnsplashPhotoIdSchema,
    width: z.number().int().positive().max(UNSPLASH_IMAGE_MAX_DIMENSION_PX),
    height: z.number().int().positive().max(UNSPLASH_IMAGE_MAX_DIMENSION_PX),
    description: z.string().max(UNSPLASH_METADATA_MAX_LENGTH).nullable(),
    altDescription: z.string().max(UNSPLASH_METADATA_MAX_LENGTH).nullable(),
    urls: z.strictObject({
      raw: UnsplashImageUrlSchema,
      small: UnsplashImageUrlSchema,
    }),
    links: z.strictObject({
      html: unsplashCreditUrlSchema,
      downloadLocation: unsplashDownloadLocationSchema,
    }),
    photographer: z.strictObject({
      name: z.string().trim().min(1).max(UNSPLASH_NAME_MAX_LENGTH),
      username: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
      profileUrl: unsplashCreditUrlSchema,
    }),
  })
  .refine(
    (photo) =>
      UnsplashDownloadInputSchema.safeParse({
        photoId: photo.id,
        downloadLocation: photo.links.downloadLocation,
      }).success,
    'Photo metadata does not match its download location',
  )

/** Normalization makes equivalent searches share TanStack Query entries and proxy cache keys. */
export const UnsplashSearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(UNSPLASH_QUERY_MAX_LENGTH),
  page: z.number().int().min(1).max(UNSPLASH_MAX_PAGE),
})

export const UnsplashSearchResultSchema = z.strictObject({
  items: z.array(UnsplashPhotoSchema).max(UNSPLASH_PAGE_SIZE),
  nextPage: z.number().int().min(1).max(UNSPLASH_MAX_PAGE).nullable(),
})

/** Typed recoverable failures let search and Apply distinguish quota from uncertain notifications. */
const unsplashProcedure = oc.errors({
  RATE_LIMITED: {
    status: 429,
    data: z.strictObject({
      retryAfterSeconds: z.number().nonnegative().nullable(),
    }),
  },
  UNAVAILABLE: { status: 503 },
  INVALID_RESPONSE: { status: 502 },
  NOTIFICATION_UNCERTAIN: { status: 504 },
})

/** The shared public router contains no server code, environment reads or credentials. */
export const unsplashContract = {
  unsplash: {
    search: unsplashProcedure
      .input(UnsplashSearchInputSchema)
      .output(UnsplashSearchResultSchema),
    trackDownload: unsplashProcedure
      .input(UnsplashDownloadInputSchema)
      .output(z.strictObject({ acknowledged: z.literal(true) })),
  },
}

/** Photo metadata is inferred once; no parallel renderer/server declaration can drift. */
export type UnsplashPhoto = z.infer<typeof UnsplashPhotoSchema>
export type UnsplashSearchInput = z.infer<typeof UnsplashSearchInputSchema>
export type UnsplashSearchResult = z.infer<typeof UnsplashSearchResultSchema>
export type UnsplashClient = ContractRouterClient<typeof unsplashContract>
