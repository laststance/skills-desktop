import { createORPCClient, safe } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'

import {
  BACKGROUND_HTTP_TIMEOUT_MS,
  BACKGROUND_NOTIFICATION_RESPONSE_BYTES,
  BACKGROUND_REMOTE_JPEG_QUALITY,
} from '@/main/constants'
import type {
  BackgroundCredit,
  BackgroundCrop,
  BackgroundImageDescriptor,
  BackgroundOperationError,
  BackgroundPreview,
} from '@/shared/backgrounds'
import {
  BACKGROUND_MAX_UPLOAD_BYTES,
  BACKGROUND_PREVIEW_LONG_EDGE_PX,
} from '@/shared/constants'
import { backgroundCropPixels } from '@/shared/utils/backgroundCropPixels'

import {
  UNSPLASH_REFERRAL_SOURCE,
  UNSPLASH_RPC_URL,
} from '../../../website/src/lib/constants'
import type {
  UnsplashClient,
  UnsplashPhoto,
} from '../../../website/src/lib/unsplash-contract'

import {
  BackgroundImageError,
  inspectBackgroundImage,
} from './backgroundImages'

/** Keeps provider failures safe for operation replay without including remote bodies or local paths.
 * @returns A typed user-facing failure for {@link applyBackground}.
 * @example throw new BackgroundRemoteError({ code: 'provider-unavailable', message: 'Try again.' })
 */
export class BackgroundRemoteError extends Error {
  constructor(readonly detail: BackgroundOperationError) {
    super(detail.message)
    this.name = 'BackgroundRemoteError'
  }
}

/** Bounds declared and streamed bytes for image preparation and the typed notification response.
 * @returns Complete bytes; oversized or incomplete responses release their reader before failing.
 * @example await readBackgroundResponse(response, 65536)
 */
async function readBackgroundResponse(
  response: Response,
  limit: number,
): Promise<Buffer> {
  if (
    Number(response.headers.get('content-length')) > limit ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new RangeError('Background response limit exceeded')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    // Count real chunks too; Content-Length may be missing or dishonest.
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > limit)
        throw new RangeError('Background response limit exceeded')
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks, bytes)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

/** Applies one deadline to headers and body, with redirects forbidden, for every Main background request.
 * @returns A bounded response that oRPC or image validation can consume without unbounded buffering.
 * @example await fetchBackgroundResponse(imageUrl, 20971520)
 */
async function fetchBackgroundResponse(
  input: string | Request,
  limit: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController()
  const deadline = setTimeout(
    () => controller.abort(),
    BACKGROUND_HTTP_TIMEOUT_MS,
  )
  const signals = [controller.signal]
  if (input instanceof Request) signals.push(input.signal)
  if (init?.signal) signals.push(init.signal)
  try {
    const response = await globalThis.fetch(input, {
      ...init,
      signal: AbortSignal.any(signals),
      redirect: 'error',
    })
    const bytes = await readBackgroundResponse(response, limit)
    const headers = new Headers(response.headers)
    // Fetch has already decoded content encodings; the reconstructed response contains the decoded bytes.
    headers.delete('content-encoding')
    headers.delete('content-length')
    return new Response(new Uint8Array(bytes), {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  } finally {
    clearTimeout(deadline)
  }
}

const client: UnsplashClient = createORPCClient(
  new RPCLink({
    url: UNSPLASH_RPC_URL,
    fetch: async (request, init) =>
      fetchBackgroundResponse(
        request,
        BACKGROUND_NOTIFICATION_RESPONSE_BYTES,
        init,
      ),
  }),
)

/** Keeps the direct CDN's source coordinate space stable, preserving ixid while removing arbitrary transforms.
 * @returns A JPEG hotlink; previews alone request the bounded editor size.
 * @example backgroundPhotoUrl(photo, false) // Direct images.unsplash.com URL with ixid and no crop/resize.
 */
export function backgroundPhotoUrl(
  photo: UnsplashPhoto,
  preview: boolean,
): string {
  const url = new URL(photo.urls.raw)
  const ixid = url.searchParams.get('ixid') ?? ''
  url.search = ''
  url.searchParams.set('ixid', ixid)
  url.searchParams.set('fm', 'jpg')
  url.searchParams.set('q', String(BACKGROUND_REMOTE_JPEG_QUALITY))
  if (preview) {
    url.searchParams.set('w', String(BACKGROUND_PREVIEW_LONG_EDGE_PX))
    url.searchParams.set('h', String(BACKGROUND_PREVIEW_LONG_EDGE_PX))
    url.searchParams.set('fit', 'max')
  }
  return url.href
}

/** Adds the provider's referral attribution for gallery, restored images and the active main background.
 * @returns Verified photographer/photo links carrying the required application referral.
 * @example backgroundPhotoCredit(photo).photographerName
 */
export function backgroundPhotoCredit(photo: UnsplashPhoto): BackgroundCredit {
  const photographer = new URL(photo.photographer.profileUrl)
  const source = new URL(photo.links.html)
  for (const url of [photographer, source]) {
    url.searchParams.set('utm_source', UNSPLASH_REFERRAL_SOURCE)
    url.searchParams.set('utm_medium', 'referral')
  }
  return {
    photographerName: photo.photographer.name,
    photographerUrl: photographer.href,
    photoUrl: source.href,
  }
}

/** Verifies actual CDN bytes before {@link prepareOnlineBackground} or the crop editor trusts a descriptor.
 * @returns The direct hotlink with actual decoded dimensions; online bytes are never saved or rehosted.
 * @example await downloadBackgroundDescriptor(photo, false)
 */
async function downloadBackgroundDescriptor(
  photo: UnsplashPhoto,
  preview: boolean,
  isCurrent?: () => boolean,
): Promise<BackgroundImageDescriptor> {
  const url = backgroundPhotoUrl(photo, preview)
  try {
    const response = await fetchBackgroundResponse(
      url,
      BACKGROUND_MAX_UPLOAD_BYTES,
    )
    if (!response.ok) throw new Error('Background CDN unavailable')
    const bytes = Buffer.from(await response.arrayBuffer())
    const dimensions = await inspectBackgroundImage(bytes, !preview, isCurrent)
    if (
      preview &&
      Math.max(dimensions.width, dimensions.height) >
        BACKGROUND_PREVIEW_LONG_EDGE_PX
    ) {
      throw new BackgroundImageError(
        'invalid-image',
        'The background preview exceeded its size limit.',
      )
    }
    if (
      !preview &&
      (dimensions.width !== photo.width || dimensions.height !== photo.height)
    ) {
      throw new BackgroundImageError(
        'invalid-image',
        'The downloaded image resolution does not match this photo. Refresh the gallery and choose it again.',
      )
    }
    return { url, width: dimensions.width, height: dimensions.height }
  } catch (error) {
    if (error instanceof BackgroundImageError) throw error
    throw new BackgroundRemoteError({
      code: 'provider-unavailable',
      message:
        'The background image could not be downloaded. Check your connection and try again.',
    })
  }
}

/** Supplies a bounded hotlinked editor preview without notifying Unsplash or changing the selected image.
 * @returns Original source dimensions and separately verified preview dimensions.
 * @example await previewOnlineBackground(photo)
 */
export async function previewOnlineBackground(
  photo: UnsplashPhoto,
): Promise<BackgroundPreview> {
  return {
    source: { kind: 'unsplash', photo },
    title: photo.altDescription ?? photo.description ?? 'Unsplash photo',
    width: photo.width,
    height: photo.height,
    image: await downloadBackgroundDescriptor(photo, true),
    credit: backgroundPhotoCredit(photo),
  }
}

/** Validates the accepted crop against the original CDN response, never against the small editor preview.
 * @returns A full-resolution direct image whose crop contains enough real pixels.
 * @example await prepareOnlineBackground(photo, fullCrop)
 */
export async function prepareOnlineBackground(
  photo: UnsplashPhoto,
  crop: BackgroundCrop,
  isCurrent?: () => boolean,
): Promise<BackgroundImageDescriptor> {
  if (!backgroundCropPixels(crop, photo.width, photo.height)?.isLargeEnough) {
    throw new BackgroundImageError(
      'invalid-crop',
      'The crop needs a long edge of at least 1920 px and a short edge of at least 1080 px.',
    )
  }
  return downloadBackgroundDescriptor(photo, false, isCurrent)
}

/** Sends the sole Apply side effect through the shared oRPC contract, without automatic retries or caching.
 * @returns Resolves only after explicit provider acknowledgement; uncertain delivery stays visible to the user.
 * @example await notifyBackgroundDownload(photo)
 */
export async function notifyBackgroundDownload(
  photo: UnsplashPhoto,
): Promise<void> {
  const result = await safe(
    client.unsplash.trackDownload({
      photoId: photo.id,
      downloadLocation: photo.links.downloadLocation,
    }),
  )
  if (result.isSuccess && result.data?.acknowledged === true) return
  if (result.isDefined) {
    const error = result.error
    if (error.code === 'RATE_LIMITED') {
      const retryAfterSeconds =
        typeof error.data?.retryAfterSeconds === 'number' &&
        Number.isFinite(error.data.retryAfterSeconds) &&
        error.data.retryAfterSeconds >= 0
          ? error.data.retryAfterSeconds
          : undefined
      throw new BackgroundRemoteError({
        code: 'rate-limited',
        message: 'Unsplash is temporarily rate limited. Try again later.',
        retryAfterSeconds,
      })
    }
    if (error.code !== 'NOTIFICATION_UNCERTAIN') {
      throw new BackgroundRemoteError({
        code: 'provider-unavailable',
        message: 'Unsplash could not acknowledge this image. Try again later.',
      })
    }
  }
  // A timeout or transport failure cannot prove whether the provider received the notification.
  throw new BackgroundRemoteError({
    code: 'notification-uncertain',
    message:
      'Unsplash notification could not be confirmed. The current background was kept; retry only when you are ready.',
  })
}
