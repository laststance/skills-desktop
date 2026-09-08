import { randomUUID } from 'node:crypto'
import { constants as fileFlags, promises as fs } from 'node:fs'
import { basename, join } from 'node:path'

import { app } from 'electron'
import sharp from 'sharp'

import {
  BACKGROUND_CHUNK_HEADER_BYTES,
  BACKGROUND_DIRECTORY_MODE,
  BACKGROUND_FILE_MODE,
  BACKGROUND_JPEG_SIGNATURE,
  BACKGROUND_PNG_CRC_BYTES,
  BACKGROUND_PNG_SIGNATURE,
  BACKGROUND_READ_CHUNK_BYTES,
  BACKGROUND_THUMBNAIL_WEBP_QUALITY,
  BACKGROUND_WEBP_ANIMATION_FLAG,
  BACKGROUND_WEBP_EFFORT,
  BACKGROUND_WEBP_HEADER_BYTES,
  BACKGROUND_WEBP_QUALITY,
} from '@/main/constants'
import { bundledBackgroundPath } from '@/main/utils/bundledBackgroundPath'
import {
  BackgroundOwnedIdSchema,
  type BackgroundApplySource,
  type BackgroundCatalog,
  type BackgroundCatalogItem,
  type BackgroundCredit,
  type BackgroundCrop,
  type BackgroundImageDescriptor,
  type BackgroundOperationError,
  type BackgroundPreview,
  type BackgroundUpload,
  type BackgroundUploadDraft,
} from '@/shared/backgrounds'
import {
  BACKGROUND_DISPLAY_LONG_EDGE_PX,
  BACKGROUND_MAX_UPLOAD_BYTES,
  BACKGROUND_MAX_UPLOAD_PIXELS,
  BACKGROUND_MIN_LONG_EDGE_PX,
  BACKGROUND_MIN_SHORT_EDGE_PX,
  BACKGROUND_PREVIEW_LONG_EDGE_PX,
  BACKGROUND_THUMBNAIL_LONG_EDGE_PX,
  BACKGROUND_TITLE_MAX_LENGTH,
  BUILTIN_BACKGROUND_IDS,
} from '@/shared/constants'
import { backgroundCropPixels } from '@/shared/utils/backgroundCropPixels'

import bundledBackgrounds from '../../../resources/backgrounds/manifest.json'

type LocalBackgroundSource = Exclude<
  BackgroundApplySource,
  { kind: 'unsplash' }
>

interface BackgroundDraft {
  ownerId: number
  directory: string
  upload: BackgroundUpload
  preview: BackgroundImageDescriptor
  claimed: boolean
  published: boolean
}

interface BackgroundImageInput {
  path: string
  title: string
  width: number
  height: number
  credit: BackgroundCredit | null
}

/** Published local crops are ready before {@link applyBackground} commits their opaque display ID. */
export interface PreparedBackgroundDisplay {
  displayId: string
  image: BackgroundImageDescriptor
}

/** Gives {@link applyBackground} safe user-facing failures without leaking source paths through IPC.
 * @returns An error whose code and message can be shown in the existing notification UI.
 * @example throw new BackgroundImageError('invalid-image', 'Choose a static image.')
 */
export class BackgroundImageError extends Error {
  constructor(
    readonly code: BackgroundOperationError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'BackgroundImageError'
  }
}

const drafts = new Map<string, BackgroundDraft>()
const pendingImports = new Map<string, number>()
const cancelledImports = new Set<string>()
let imageProcessingQueue = Promise.resolve()
let latestPreviewRequestId = 0
// Four immutable built-ins retain only successful previews; failed/in-flight work remains retryable.
const builtinPreviews = new Map<
  (typeof BUILTIN_BACKGROUND_IDS)[number],
  BackgroundPreview
>()

/** Derives private paths for image operations without accepting renderer filesystem paths.
 * @returns The dedicated userData image directory.
 * @example backgroundDirectory() // '/profile/backgrounds'
 */
function backgroundDirectory(): string {
  return join(app.getPath('userData'), 'backgrounds')
}

/** Validates ownership IDs before {@link publishBackgroundDraft} or removal derives a local path.
 * @returns The upload directory for a valid UUID.
 * @example uploadDirectory('70d7dd6c-5b03-4683-8bb9-79d592dd2f65')
 */
function uploadDirectory(uploadId: string): string {
  return join(
    backgroundDirectory(),
    'uploads',
    BackgroundOwnedIdSchema.parse(uploadId),
  )
}

/** Serializes image work for imports/crops while a failed job leaves subsequent work usable.
 * @returns This job's value or its own error.
 * @example await queueImageProcessing(() => sharp(bytes).stats())
 */
async function queueImageProcessing<Result>(
  operation: () => Promise<Result>,
): Promise<Result> {
  // One Sharp job bounds decoded memory; no extra worker pool or durable queue is needed.
  const pending = imageProcessingQueue.then(operation)
  imageProcessingQueue = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

/** Bounds actual bytes for {@link importBackgroundImage} and generated-image descriptors, even if a file grows.
 * @returns At most 20 MiB from a regular file; rejects before decoding oversized input.
 * @example await readBoundedImage('/picked/photo.png')
 */
async function readBoundedImage(path: string): Promise<Buffer> {
  const handle = await fs.open(path, fileFlags.O_RDONLY | fileFlags.O_NONBLOCK)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile())
      throw new BackgroundImageError(
        'invalid-image',
        'Choose a regular image file.',
      )
    if (metadata.size > BACKGROUND_MAX_UPLOAD_BYTES) {
      throw new BackgroundImageError(
        'invalid-image',
        'Choose an image no larger than 20 MiB.',
      )
    }
    const chunks: Buffer[] = []
    let totalBytes = 0
    // Read through the open handle, not a second path lookup; growth is checked before each append.
    while (totalBytes <= BACKGROUND_MAX_UPLOAD_BYTES) {
      const chunk = Buffer.alloc(
        Math.min(
          BACKGROUND_READ_CHUNK_BYTES,
          BACKGROUND_MAX_UPLOAD_BYTES + 1 - totalBytes,
        ),
      )
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null)
      if (bytesRead === 0) break
      totalBytes += bytesRead
      if (totalBytes > BACKGROUND_MAX_UPLOAD_BYTES) {
        throw new BackgroundImageError(
          'invalid-image',
          'Choose an image no larger than 20 MiB.',
        )
      }
      chunks.push(chunk.subarray(0, bytesRead))
    }
    return Buffer.concat(chunks, totalBytes)
  } finally {
    await handle.close()
  }
}

/** Rejects animation headers before {@link validateBackgroundImage} asks Sharp to decode a first frame.
 * @returns The verified JPEG, PNG or WebP container type.
 * @example staticImageFormat(pngBytes) // 'png'
 */
function staticImageFormat(bytes: Buffer): BackgroundUpload['format'] {
  if (
    bytes
      .subarray(0, BACKGROUND_JPEG_SIGNATURE.length)
      .equals(BACKGROUND_JPEG_SIGNATURE)
  )
    return 'jpeg'
  if (
    bytes
      .subarray(0, BACKGROUND_PNG_SIGNATURE.length)
      .equals(BACKGROUND_PNG_SIGNATURE)
  ) {
    assertStaticPng(bytes)
    return 'png'
  }
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, BACKGROUND_WEBP_HEADER_BYTES) === 'WEBP'
  ) {
    assertStaticWebp(bytes)
    return 'webp'
  }
  throw new BackgroundImageError(
    'invalid-image',
    'Choose a static JPEG, PNG or WebP image.',
  )
}

/** Rejects truncated chunks for container validation before any decoder sees their payload.
 * @returns Nothing for a complete chunk; damaged images fail safely.
 * @example assertCompleteChunk(12, pngBytes.length)
 */
function assertCompleteChunk(end: number, containerEnd: number): void {
  if (end > containerEnd)
    throw new BackgroundImageError(
      'invalid-image',
      'This image is incomplete or damaged.',
    )
}

/** Rejects animation independently of Sharp page counts for both static-image container readers.
 * @returns Nothing for static chunks; animation produces a user-facing validation error.
 * @example assertStaticChunk(kind === 'acTL')
 */
function assertStaticChunk(animated: boolean): void {
  if (animated)
    throw new BackgroundImageError(
      'invalid-image',
      'Animated PNG and WebP images are not supported. Choose a static image.',
    )
}

/** Walks PNG chunks for {@link staticImageFormat}; acTL is authoritative even when Sharp reports one page.
 * @returns Nothing after every complete chunk has been checked for animation.
 * @example assertStaticPng(pngBytes)
 */
function assertStaticPng(bytes: Buffer): void {
  for (let offset = BACKGROUND_PNG_SIGNATURE.length; offset < bytes.length;) {
    assertCompleteChunk(offset + BACKGROUND_CHUNK_HEADER_BYTES, bytes.length)
    const length = bytes.readUInt32BE(offset)
    const kind = bytes.toString(
      'ascii',
      offset + 4,
      offset + BACKGROUND_CHUNK_HEADER_BYTES,
    )
    const end =
      offset + BACKGROUND_CHUNK_HEADER_BYTES + length + BACKGROUND_PNG_CRC_BYTES
    assertCompleteChunk(end, bytes.length)
    assertStaticChunk(kind === 'acTL')
    offset = end
  }
}

/** Walks WebP RIFF chunks for {@link staticImageFormat}, including animation flags and frame chunks.
 * @returns Nothing after the declared complete container is proven static.
 * @example assertStaticWebp(webpBytes)
 */
function assertStaticWebp(bytes: Buffer): void {
  const containerEnd = bytes.readUInt32LE(4) + BACKGROUND_CHUNK_HEADER_BYTES
  assertCompleteChunk(containerEnd, bytes.length)
  for (let offset = BACKGROUND_WEBP_HEADER_BYTES; offset < containerEnd;) {
    assertCompleteChunk(offset + BACKGROUND_CHUNK_HEADER_BYTES, containerEnd)
    const length = bytes.readUInt32LE(offset + 4)
    const kind = bytes.toString('ascii', offset, offset + 4)
    const payload = offset + BACKGROUND_CHUNK_HEADER_BYTES
    const end = payload + length + (length % 2)
    assertCompleteChunk(end, containerEnd)
    const animationFlag =
      kind === 'VP8X' &&
      length > 0 &&
      (bytes[payload] & BACKGROUND_WEBP_ANIMATION_FLAG) !== 0
    assertStaticChunk(kind === 'ANIM' || kind === 'ANMF' || animationFlag)
    offset = end
  }
}

/** Validates real source pixels and full decoding for imports and recrops, independent of file extensions.
 * @returns Actual oriented dimensions and supported format.
 * @example await validateBackgroundImage(jpegBytes) // { width: 1920, height: 1080, format: 'jpeg' }
 */
async function validateBackgroundImage(
  bytes: Buffer,
  requireMinimumSize = true,
): Promise<Pick<BackgroundUpload, 'width' | 'height' | 'format'>> {
  const format = staticImageFormat(bytes)
  try {
    const decoder = sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BACKGROUND_MAX_UPLOAD_PIXELS,
    })
    const metadata = await decoder.metadata()
    const { width, height } = metadata.autoOrient
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
      throw new BackgroundImageError(
        'invalid-image',
        'Choose a static JPEG, PNG or WebP image.',
      )
    if (width * height > BACKGROUND_MAX_UPLOAD_PIXELS)
      throw new BackgroundImageError(
        'invalid-image',
        'Choose an image no larger than 80 megapixels.',
      )
    if (
      requireMinimumSize &&
      (Math.max(width, height) < BACKGROUND_MIN_LONG_EDGE_PX ||
        Math.min(width, height) < BACKGROUND_MIN_SHORT_EDGE_PX)
    ) {
      throw new BackgroundImageError(
        'invalid-image',
        'Images need a long edge of at least 1920 px and a short edge of at least 1080 px. Smaller images are not enlarged.',
      )
    }
    // Statistics evaluates the entire source without allocating an 80 MP raw output in JavaScript.
    await decoder.stats()
    return { width, height, format }
  } catch (error) {
    if (error instanceof BackgroundImageError) throw error
    if (error instanceof Error && error.message.includes('pixel limit')) {
      throw new BackgroundImageError(
        'invalid-image',
        'Choose an image no larger than 80 megapixels.',
      )
    }
    throw new BackgroundImageError(
      'invalid-image',
      'This image could not be decoded. Choose an undamaged image.',
    )
  }
}

/** Validates bounded CDN bytes for {@link applyBackground} in the same single-decoder queue as local imports.
 * @returns Actual oriented dimensions and format; small editor previews may omit the source minimum.
 * @example await inspectBackgroundImage(downloadedBytes, true)
 */
export async function inspectBackgroundImage(
  bytes: Buffer,
  requireMinimumSize: boolean,
  isCurrent?: () => boolean,
): Promise<Pick<BackgroundUpload, 'width' | 'height' | 'format'>> {
  if (bytes.length > BACKGROUND_MAX_UPLOAD_BYTES)
    throw new BackgroundImageError(
      'invalid-image',
      'Choose an image no larger than 20 MiB.',
    )
  return queueImageProcessing(async () => {
    if (isCurrent && !isCurrent())
      throw new BackgroundImageError(
        'source-missing',
        'This background request was superseded.',
      )
    return validateBackgroundImage(bytes, requireMinimumSize)
  })
}

/** Returns only converted, bounded WebP data to gallery and display callers.
 * @returns A descriptor whose actual dimensions never exceed the requested derivative bound.
 * @example await imageDescriptor('/owned/preview.webp', 1920)
 */
async function imageDescriptor(
  path: string,
  longEdge: number,
): Promise<BackgroundImageDescriptor> {
  const bytes = await readBoundedImage(path)
  const metadata = await sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: longEdge * longEdge,
  }).metadata()
  if (
    metadata.format !== 'webp' ||
    (metadata.pages ?? 1) !== 1 ||
    Math.max(metadata.width, metadata.height) > longEdge
  ) {
    throw new BackgroundImageError(
      'invalid-image',
      'The prepared background image is unavailable. Apply the image again.',
    )
  }
  return {
    url: `data:image/webp;base64,${bytes.toString('base64')}`,
    width: metadata.width,
    height: metadata.height,
  }
}

/** Produces an oriented bounded derivative for import previews and thumbnails.
 * @returns The written image descriptor.
 * @example await writePreview(bytes, previewPath, 1920, 88)
 */
async function writePreview(
  bytes: Buffer,
  path: string,
  longEdge: number,
  quality: number,
): Promise<BackgroundImageDescriptor> {
  await sharp(bytes, {
    failOn: 'warning',
    limitInputPixels: BACKGROUND_MAX_UPLOAD_PIXELS,
  })
    .autoOrient()
    .resize({
      width: longEdge,
      height: longEdge,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toColourspace('srgb')
    .webp({ quality, effort: BACKGROUND_WEBP_EFFORT })
    .toFile(path)
  await fs.chmod(path, BACKGROUND_FILE_MODE)
  return imageDescriptor(path, longEdge)
}

/** Finds only ready owned tokens for preview, synchronous acceptance and publication callers.
 * @returns A validated draft; unknown/expired tokens fail without filesystem access.
 * @example getDraft(draftId).upload
 */
function getDraft(draftId: string): BackgroundDraft {
  const draft = drafts.get(BackgroundOwnedIdSchema.parse(draftId))
  if (!draft)
    throw new BackgroundImageError(
      'source-missing',
      'This upload draft has expired. Choose the image again.',
    )
  return draft
}

/** Copies and validates native-picker input for {@link registerBackgroundHandlers}, keeping originals app-owned.
 * @returns A bounded preview and transient token; no external path is exposed or persisted.
 * @example await importBackgroundImage('/picked/photo.jpg', settingsWebContentsId)
 */
export async function importBackgroundImage(
  path: string,
  ownerId: number,
): Promise<BackgroundUploadDraft> {
  const draftId = randomUUID()
  const directory = join(backgroundDirectory(), 'staging', draftId)
  pendingImports.set(draftId, ownerId)
  return queueImageProcessing(async () => {
    try {
      if (cancelledImports.has(draftId))
        throw new BackgroundImageError(
          'source-missing',
          'The upload was cancelled.',
        )
      await fs.mkdir(directory, {
        recursive: true,
        mode: BACKGROUND_DIRECTORY_MODE,
      })
      const bytes = await readBoundedImage(path)
      await fs.writeFile(join(directory, 'original'), bytes, {
        flag: 'wx',
        mode: BACKGROUND_FILE_MODE,
      })
      const dimensions = await validateBackgroundImage(bytes)
      if (cancelledImports.has(draftId))
        throw new BackgroundImageError(
          'source-missing',
          'The upload was cancelled.',
        )
      const preview = await writePreview(
        bytes,
        join(directory, 'preview.webp'),
        BACKGROUND_PREVIEW_LONG_EDGE_PX,
        BACKGROUND_WEBP_QUALITY,
      )
      await writePreview(
        bytes,
        join(directory, 'thumbnail.webp'),
        BACKGROUND_THUMBNAIL_LONG_EDGE_PX,
        BACKGROUND_THUMBNAIL_WEBP_QUALITY,
      )
      if (cancelledImports.has(draftId))
        throw new BackgroundImageError(
          'source-missing',
          'The upload was cancelled.',
        )
      const upload: BackgroundUpload = {
        id: randomUUID(),
        title:
          basename(path).slice(0, BACKGROUND_TITLE_MAX_LENGTH).trim() ||
          'Uploaded image',
        ...dimensions,
        bytes: bytes.length,
        importedAt: new Date().toISOString(),
      }
      drafts.set(draftId, {
        ownerId,
        directory,
        upload,
        preview,
        claimed: false,
        published: false,
      })
      return {
        source: { kind: 'upload-draft', draftId },
        title: upload.title,
        width: upload.width,
        height: upload.height,
        image: preview,
        credit: null,
      }
    } catch (error) {
      if (error instanceof BackgroundImageError) throw error
      throw new BackgroundImageError(
        'save-failed',
        'The image could not be imported. Check available disk space and try again.',
      )
    } finally {
      pendingImports.delete(draftId)
      cancelledImports.delete(draftId)
      if (!drafts.has(draftId))
        await fs.rm(directory, { recursive: true, force: true })
    }
  })
}

/** Transfers a validated token to {@link applyBackground} before its first await or IPC acknowledgement.
 * @returns The stable upload metadata reserved for this application.
 * @example const upload = claimBackgroundDraft(input.source.draftId)
 */
export function claimBackgroundDraft(draftId: string): BackgroundUpload {
  const draft = getDraft(draftId)
  if (draft.claimed)
    throw new BackgroundImageError(
      'source-missing',
      'This upload is already being applied.',
    )
  draft.claimed = true
  return draft.upload
}

/** Cancels gallery-owned tokens while accepted Main-owned inputs survive late Cancel/close messages.
 * @returns Completion after this unclaimed draft's private files are removed.
 * @example await discardBackgroundDraft(draftId)
 */
export async function discardBackgroundDraft(draftId: string): Promise<void> {
  const draft = drafts.get(BackgroundOwnedIdSchema.parse(draftId))
  if (!draft || draft.claimed) return
  drafts.delete(draftId)
  await fs.rm(draft.directory, { recursive: true, force: true })
}

/** Cancels pending imports and unclaimed tokens when {@link registerBackgroundHandlers} observes owner destruction.
 * @returns Cleanup completion; accepted operations retain their files.
 * @example await discardBackgroundDraftsForOwner(settingsWebContentsId)
 */
export async function discardBackgroundDraftsForOwner(
  ownerId: number,
): Promise<void> {
  for (const [draftId, pendingOwnerId] of pendingImports) {
    if (pendingOwnerId === ownerId) cancelledImports.add(draftId)
  }
  const pendingCleanup: Promise<void>[] = []
  for (const [draftId, draft] of drafts) {
    if (draft.ownerId === ownerId && !draft.claimed)
      pendingCleanup.push(discardBackgroundDraft(draftId))
  }
  await Promise.all(pendingCleanup)
}

/** Publishes a claimed original/preview directory before {@link applyBackground} references its stable upload ID.
 * @returns The same upload metadata on a safe disk-save retry.
 * @example const upload = await publishBackgroundDraft(draftId)
 */
export async function publishBackgroundDraft(
  draftId: string,
): Promise<BackgroundUpload> {
  return queueImageProcessing(async () => {
    const draft = getDraft(draftId)
    if (!draft.claimed)
      throw new BackgroundImageError(
        'source-missing',
        'The upload has not been accepted.',
      )
    if (!draft.published) {
      const target = uploadDirectory(draft.upload.id)
      await fs.mkdir(join(backgroundDirectory(), 'uploads'), {
        recursive: true,
        mode: BACKGROUND_DIRECTORY_MODE,
      })
      // Publish first; a save failure keeps this claimed input available for Retry.
      await fs.rename(draft.directory, target)
      draft.directory = target
      draft.published = true
    }
    return draft.upload
  })
}

/** Releases the transient token after {@link applyBackground} commits or abandons its accepted application.
 * @returns Completion; committed upload files stay owned by the saved library.
 * @example await finishBackgroundDraft(draftId, true)
 */
export async function finishBackgroundDraft(
  draftId: string,
  committed: boolean,
): Promise<void> {
  const draft = drafts.get(BackgroundOwnedIdSchema.parse(draftId))
  drafts.delete(draftId)
  return queueImageProcessing(async () => {
    if (draft && !committed)
      await fs.rm(draft.directory, { recursive: true, force: true })
  })
}

/** Resolves only bundled IDs, validated drafts or current library members for local preview/crop callers.
 * @returns Actual source dimensions, owned path and optional verified credit.
 * @example localImageInput(source, settings.background.uploads)
 */
function localImageInput(
  source: LocalBackgroundSource,
  uploads: readonly BackgroundUpload[],
): BackgroundImageInput {
  if (source.kind === 'builtin') {
    const photo = bundledBackgrounds.photos.find(
      (candidate) => candidate.id === source.builtinId,
    )
    if (!photo)
      throw new BackgroundImageError(
        'source-missing',
        'This built-in background is unavailable.',
      )
    return {
      path: bundledBackgroundPath(photo.filename),
      title: photo.name,
      width: photo.width,
      height: photo.height,
      credit: {
        photographerName: photo.photographer.name,
        photographerUrl: photo.photographer.url,
        photoUrl: photo.source.url,
      },
    }
  }
  if (source.kind === 'upload-draft') {
    const draft = getDraft(source.draftId)
    return {
      path: join(draft.directory, 'original'),
      title: draft.upload.title,
      width: draft.upload.width,
      height: draft.upload.height,
      credit: null,
    }
  }
  const upload = uploads.find((candidate) => candidate.id === source.uploadId)
  if (!upload)
    throw new BackgroundImageError(
      'source-missing',
      'This image was removed from your library. Choose another image.',
    )
  return {
    path: join(uploadDirectory(upload.id), 'original'),
    title: upload.title,
    width: upload.width,
    height: upload.height,
    credit: null,
  }
}

/** Supplies catalog metadata to {@link applyBackground}, without exposing original files to either renderer.
 * @returns Four credited built-ins and the current upload library with bounded thumbnails.
 * @example await getBackgroundCatalog(settings.background.uploads)
 */
export async function getBackgroundCatalog(
  uploads: readonly BackgroundUpload[],
): Promise<BackgroundCatalog> {
  const builtins = await Promise.all(
    BUILTIN_BACKGROUND_IDS.map(
      async (builtinId): Promise<BackgroundCatalogItem> => {
        const source = {
          kind: 'builtin',
          builtinId,
        } satisfies LocalBackgroundSource
        const input = localImageInput(source, uploads)
        const photo = bundledBackgrounds.photos.find(
          (candidate) => candidate.id === builtinId,
        )
        const thumbnail = photo
          ? await queueImageProcessing(async () =>
              imageDescriptor(
                bundledBackgroundPath(photo.thumbnailFilename),
                BACKGROUND_THUMBNAIL_LONG_EDGE_PX,
              ),
            ).catch(() => null)
          : null
        return {
          source,
          title: input.title,
          width: input.width,
          height: input.height,
          thumbnail,
          credit: input.credit,
        }
      },
    ),
  )
  const uploadItems = await Promise.all(
    uploads.map(async (upload): Promise<BackgroundCatalogItem> => {
      // Missing local thumbnails keep the library item visible so removal/recovery remains available.
      // Catalog reads join the existing image queue so a large library cannot decode alongside an import/crop.
      const thumbnail = await queueImageProcessing(async () =>
        imageDescriptor(
          join(uploadDirectory(upload.id), 'thumbnail.webp'),
          BACKGROUND_THUMBNAIL_LONG_EDGE_PX,
        ),
      ).catch(() => null)
      return {
        source: { kind: 'upload', uploadId: upload.id },
        title: upload.title,
        width: upload.width,
        height: upload.height,
        thumbnail,
        credit: null,
      }
    }),
  )
  return { builtins, uploads: uploadItems }
}

/** Supplies local source metadata to {@link applyBackground} without decoding an editor preview during Apply or restoration.
 * @returns Title, original dimensions and credit for a validated owned source.
 * @example getBackgroundSourceInfo(source, settings.background.uploads)
 */
export function getBackgroundSourceInfo(
  source: LocalBackgroundSource,
  uploads: readonly BackgroundUpload[],
): Omit<BackgroundPreview, 'source' | 'image'> {
  const { title, width, height, credit } = localImageInput(source, uploads)
  return { title, width, height, credit }
}

/** Supplies the latest queued editor preview for {@link previewBackground} without delaying it behind superseded selections.
 * @returns Source metadata and a WebP preview; missing files or superseded requests reject without changing ownership/settings.
 * @example await getBackgroundPreview(source, settings.background.uploads)
 */
export async function getBackgroundPreview(
  source: LocalBackgroundSource,
  uploads: readonly BackgroundUpload[],
): Promise<BackgroundPreview> {
  const previewRequestId = ++latestPreviewRequestId
  const input = localImageInput(source, uploads)
  if (source.kind === 'upload-draft')
    return {
      source,
      title: input.title,
      width: input.width,
      height: input.height,
      image: getDraft(source.draftId).preview,
      credit: null,
    }
  return queueImageProcessing(async () => {
    // Skip old editor selections before reading/decoding; accepted displays and imports own separate work.
    if (previewRequestId !== latestPreviewRequestId)
      throw new BackgroundImageError(
        'source-missing',
        'This image preview was superseded by a newer selection.',
      )
    if (source.kind === 'upload')
      return {
        source,
        title: input.title,
        width: input.width,
        height: input.height,
        image: await imageDescriptor(
          join(uploadDirectory(source.uploadId), 'preview.webp'),
          BACKGROUND_PREVIEW_LONG_EDGE_PX,
        ),
        credit: null,
      }
    const cached = builtinPreviews.get(source.builtinId)
    if (cached) return cached
    const bytes = await readBoundedImage(input.path)
    const { data, info } = await sharp(bytes, {
      failOn: 'warning',
      limitInputPixels: BACKGROUND_MAX_UPLOAD_PIXELS,
    })
      .autoOrient()
      .resize({
        width: BACKGROUND_PREVIEW_LONG_EDGE_PX,
        height: BACKGROUND_PREVIEW_LONG_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: BACKGROUND_WEBP_QUALITY,
        effort: BACKGROUND_WEBP_EFFORT,
      })
      .toBuffer({ resolveWithObject: true })
    if (data.length > BACKGROUND_MAX_UPLOAD_BYTES)
      throw new BackgroundImageError(
        'invalid-image',
        'The background preview is too large.',
      )
    const preview: BackgroundPreview = {
      source,
      title: input.title,
      width: input.width,
      height: input.height,
      image: {
        url: `data:image/webp;base64,${data.toString('base64')}`,
        width: info.width,
        height: info.height,
      },
      credit: input.credit,
    }
    builtinPreviews.set(source.builtinId, preview)
    return preview
  })
}

/** Extracts real original pixels for {@link applyBackground}, publishing a bounded local crop before its settings reference.
 * @returns A published display ID and descriptor, or null when queued work became obsolete.
 * @example await prepareBackgroundDisplay(source, crop, uploads, isCurrent)
 */
export async function prepareBackgroundDisplay(
  source: LocalBackgroundSource,
  crop: BackgroundCrop,
  uploads: readonly BackgroundUpload[],
  isCurrent: () => boolean,
): Promise<PreparedBackgroundDisplay | null> {
  return queueImageProcessing(async () => {
    if (!isCurrent()) return null
    const input = localImageInput(source, uploads)
    const pixels = backgroundCropPixels(crop, input.width, input.height)
    if (!pixels?.isLargeEnough)
      throw new BackgroundImageError(
        'invalid-crop',
        'The crop needs a long edge of at least 1920 px and a short edge of at least 1080 px.',
      )
    const bytes = await readBoundedImage(input.path)
    const dimensions = await validateBackgroundImage(bytes)
    if (dimensions.width !== input.width || dimensions.height !== input.height)
      throw new BackgroundImageError(
        'invalid-image',
        'The original image changed. Choose the image again.',
      )
    if (!isCurrent()) return null
    const displayId = randomUUID()
    const stagingDirectory = join(backgroundDirectory(), 'display-staging')
    const temporaryPath = join(stagingDirectory, `${displayId}.webp`)
    const targetDirectory = join(backgroundDirectory(), 'displays')
    const target = join(targetDirectory, `${displayId}.webp`)
    try {
      await fs.mkdir(stagingDirectory, {
        recursive: true,
        mode: BACKGROUND_DIRECTORY_MODE,
      })
      const { left, top, width, height } = pixels
      await sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: BACKGROUND_MAX_UPLOAD_PIXELS,
      })
        .autoOrient()
        .extract({ left, top, width, height })
        .resize({
          width: BACKGROUND_DISPLAY_LONG_EDGE_PX,
          height: BACKGROUND_DISPLAY_LONG_EDGE_PX,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toColourspace('srgb')
        .webp({
          quality: BACKGROUND_WEBP_QUALITY,
          effort: BACKGROUND_WEBP_EFFORT,
        })
        .toFile(temporaryPath)
      await fs.chmod(temporaryPath, BACKGROUND_FILE_MODE)
      const image = await imageDescriptor(
        temporaryPath,
        BACKGROUND_DISPLAY_LONG_EDGE_PX,
      )
      if (!isCurrent()) return null
      await fs.mkdir(targetDirectory, {
        recursive: true,
        mode: BACKGROUND_DIRECTORY_MODE,
      })
      await fs.rename(temporaryPath, target)
      return { displayId, image }
    } finally {
      await fs.rm(temporaryPath, { force: true })
    }
  })
}

/** Loads a previously committed bounded display for {@link applyBackground} after restart.
 * @returns Its actual descriptor; malformed IDs never become paths.
 * @example await readBackgroundDisplay(selection.displayId)
 */
export async function readBackgroundDisplay(
  displayId: string,
): Promise<BackgroundImageDescriptor> {
  return imageDescriptor(
    join(
      backgroundDirectory(),
      'displays',
      `${BackgroundOwnedIdSchema.parse(displayId)}.webp`,
    ),
    BACKGROUND_DISPLAY_LONG_EDGE_PX,
  )
}

/** Deletes a known owned display only after {@link applyBackground} drops its reference or abandons preparation.
 * @returns Completion; failures leave the caller's committed settings untouched.
 * @example await removeBackgroundDisplay(previousDisplayId)
 */
export async function removeBackgroundDisplay(
  displayId: string,
): Promise<void> {
  await fs.rm(
    join(
      backgroundDirectory(),
      'displays',
      `${BackgroundOwnedIdSchema.parse(displayId)}.webp`,
    ),
    { force: true },
  )
}

/** Deletes a known app-owned upload only after {@link applyBackground} commits its removal.
 * @returns Completion without touching the user-selected external original.
 * @example await removeBackgroundUpload(uploadId)
 */
export async function removeBackgroundUpload(uploadId: string): Promise<void> {
  await fs.rm(uploadDirectory(uploadId), { recursive: true, force: true })
}
