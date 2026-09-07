import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { DEFAULT_BACKGROUND_CROP } from '@/shared/backgrounds'

import type * as BackgroundImagesModule from './backgroundImages'

const electronPaths = vi.hoisted(() => ({
  userData: '',
  appPath: process.cwd(),
}))
vi.mock('electron', () => ({
  app: {
    getPath: () => electronPaths.userData,
    getAppPath: () => electronPaths.appPath,
  },
}))

let images: typeof BackgroundImagesModule
let directory: string

/** Writes a real fixture for ingestion tests without mocking image metadata or decoding.
 * @returns The external input path and its exact original bytes.
 * @example await writeImage(1920, 1080, 'png')
 */
async function writeImage(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' = 'png',
  orientation?: number,
): Promise<{ path: string; bytes: Buffer }> {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: '#2468ac' },
  })
  const bytes = await (
    orientation ? pipeline.withMetadata({ orientation }) : pipeline
  )
    .toFormat(format)
    .toBuffer()
  const path = join(directory, `${randomUUID()}.${format}`)
  await fs.writeFile(path, bytes)
  return { path, bytes }
}

/** Reads actual pixels from a bounded descriptor to prove crop/orientation behavior.
 * @returns Decoded bytes, never a mocked image response.
 * @example descriptorBytes(preview.image.url)
 */
function descriptorBytes(url: string): Buffer {
  return Buffer.from(url.slice('data:image/webp;base64,'.length), 'base64')
}

/** Builds checksum-correct PNG chunks for real APNG and over-limit-header fixtures.
 * @returns A complete PNG chunk with length, type, payload and CRC.
 * @example pngChunk('acTL', animationControl)
 */
function pngChunk(kind: string, payload: Buffer): Buffer {
  const type = Buffer.from(kind)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, payload])))
  return Buffer.concat([length, type, payload, checksum])
}

/** Extracts real PNG image-data chunks so the animation fixture contains valid encoded frames.
 * @returns The source PNG's combined compressed pixel data.
 * @example pngPixels(pngBytes)
 */
function pngPixels(bytes: Buffer): Buffer {
  const chunks: Buffer[] = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset)
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  return Buffer.concat(chunks)
}

beforeEach(async () => {
  vi.resetModules()
  directory = await fs.mkdtemp(join(tmpdir(), 'skills-background-images-'))
  electronPaths.userData = join(directory, 'profile')
  images = await import('./backgroundImages')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(directory, { recursive: true, force: true })
})

describe('background image ingestion', () => {
  test.each([
    [1920, 1080],
    [1080, 1920],
  ])(
    'accepts a %i×%i source and keeps the editor in original pixel coordinates',
    async (width, height) => {
      // Arrange
      const original = await writeImage(width, height)

      // Act
      const draft = await images.importBackgroundImage(original.path, 1)
      const preview = await sharp(descriptorBytes(draft.image.url)).metadata()

      // Assert
      expect([draft.width, draft.height]).toEqual([width, height])
      expect([preview.width, preview.height]).toEqual([width, height])
      expect(await fs.readFile(original.path)).toEqual(original.bytes)
      expect(draft.source.kind).toBe('upload-draft')
      expect(draft.image.url.startsWith('data:image/webp;base64,')).toBe(true)
    },
  )

  test.each([
    [1919, 1080],
    [1920, 1079],
  ])(
    'rejects a %i×%i source without enlarging it or retaining a staging copy',
    async (width, height) => {
      // Arrange
      const original = await writeImage(width, height)

      // Act
      await expect(
        images.importBackgroundImage(original.path, 1),
      ).rejects.toThrow('at least 1920 px')

      // Assert
      expect(
        await fs.readdir(
          join(electronPaths.userData, 'backgrounds', 'staging'),
        ),
      ).toEqual([])
      expect(await fs.readFile(original.path)).toEqual(original.bytes)
    },
  )

  test.each(['jpeg', 'png', 'webp'] as const)(
    'accepts real static %s bytes independently of the filename extension',
    async (format) => {
      // Arrange
      const original = await writeImage(1920, 1080, format)
      const misleadingPath = join(directory, 'picture.bin')
      await fs.rename(original.path, misleadingPath)

      // Act
      const draft = await images.importBackgroundImage(misleadingPath, 1)
      const upload = images.claimBackgroundDraft(draft.source.draftId)

      // Assert
      expect(upload.format).toBe(format)
      expect(upload.title).toBe('picture.bin')
    },
  )

  test('rejects a fake JPEG extension before unsupported content reaches the decoder', async () => {
    // Arrange
    const original = join(directory, 'fake.jpg')
    await fs.writeFile(original, '<svg width="1920" height="1080"></svg>')

    // Act
    await expect(images.importBackgroundImage(original, 1)).rejects.toThrow(
      'static JPEG, PNG or WebP',
    )

    // Assert
    expect(await fs.readFile(original, 'utf8')).toBe(
      '<svg width="1920" height="1080"></svg>',
    )
  })

  test('accepts exactly 20 MiB of actual bytes and rejects one byte more before decoding', async () => {
    // Arrange
    const original = await writeImage(1920, 1080, 'jpeg')
    await fs.appendFile(
      original.path,
      Buffer.alloc(20 * 1024 * 1024 - original.bytes.length),
    )

    // Act
    const draft = await images.importBackgroundImage(original.path, 1)
    const accepted = images.claimBackgroundDraft(draft.source.draftId)
    await fs.appendFile(original.path, Buffer.from([0]))

    // Assert
    expect(accepted.bytes).toBe(20_971_520)
    await expect(
      images.importBackgroundImage(original.path, 2),
    ).rejects.toThrow('no larger than 20 MiB')
    expect((await fs.stat(original.path)).size).toBe(20_971_521)
  })

  // Real 80 MP fixture creation, full decode and two derivatives exceed the 5s default under parallel Linux coverage.
  test(
    'fully decodes an 80 megapixel source while keeping the editor preview bounded',
    { timeout: 30_000 },
    async () => {
      // Arrange
      const original = await writeImage(10000, 8000, 'jpeg')

      // Act
      const draft = await images.importBackgroundImage(original.path, 1)

      // Assert
      expect([draft.width, draft.height]).toEqual([10000, 8000])
      expect([draft.image.width, draft.image.height]).toEqual([1920, 1536])
      expect(descriptorBytes(draft.image.url).length).toBeLessThan(20_971_521)
    },
  )

  test('rejects a file that grows past 20 MiB after its size was checked', async () => {
    // Arrange
    const original = await writeImage(1920, 1080, 'jpeg')
    const handle = await fs.open(original.path, 'r')
    const originalStat = await handle.stat()
    vi.spyOn(handle, 'stat').mockResolvedValueOnce(originalStat)
    vi.spyOn(fs, 'open').mockResolvedValueOnce(handle)
    await fs.appendFile(
      original.path,
      Buffer.alloc(20_971_521 - original.bytes.length),
    )

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('no larger than 20 MiB')

    // Assert
    expect((await fs.stat(original.path)).size).toBe(20_971_521)
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([])
  })

  test('rejects a checksum-correct 80,000,001-pixel header before allocating its claimed pixels', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const header = Buffer.from(original.bytes.subarray(16, 29))
    header.writeUInt32BE(80_000_001, 0)
    header.writeUInt32BE(1, 4)
    await fs.writeFile(
      original.path,
      Buffer.concat([
        original.bytes.subarray(0, 8),
        pngChunk('IHDR', header),
        original.bytes.subarray(33),
      ]),
    )

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('80 megapixels')

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([])
  })

  test.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'applies EXIF orientation %i before checking dimensions and making the preview',
    async (orientation) => {
      // Arrange
      const original = await writeImage(1920, 1080, 'jpeg', orientation)

      // Act
      const draft = await images.importBackgroundImage(original.path, 1)
      const metadata = await sharp(descriptorBytes(draft.image.url)).metadata()

      // Assert
      expect([draft.width, draft.height]).toEqual(
        orientation >= 5 ? [1080, 1920] : [1920, 1080],
      )
      expect([metadata.width, metadata.height]).toEqual(
        orientation >= 5 ? [1080, 1920] : [1920, 1080],
      )
      expect(metadata.orientation).toBeUndefined()
    },
  )

  test('rejects truncated JPEG pixel data even when the header still reports a valid resolution', async () => {
    // Arrange
    const original = await writeImage(1920, 1080, 'jpeg')
    const damaged = original.bytes.subarray(
      0,
      Math.floor(original.bytes.length / 2),
    )
    expect((await sharp(damaged).metadata()).width).toBe(1920)
    await fs.writeFile(original.path, damaged)

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('could not be decoded')

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([])
  })

  test('mirrors actual preview pixels for EXIF orientation 2 instead of only dropping the orientation tag', async () => {
    // Arrange
    const blueHalf = await sharp({
      create: { width: 960, height: 1080, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
    const bytes = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: 'red' },
    })
      .composite([{ input: blueHalf, left: 960, top: 0 }])
      .withMetadata({ orientation: 2 })
      .jpeg()
      .toBuffer()
    const path = join(directory, 'mirrored.jpg')
    await fs.writeFile(path, bytes)

    // Act
    const draft = await images.importBackgroundImage(path, 1)
    const region = await sharp(descriptorBytes(draft.image.url))
      .extract({ left: 10, top: 10, width: 10, height: 10 })
      .toBuffer()
    // Sharp stats reads its original input, so encode the selected region before measuring its pixels.
    const pixels = await sharp(region).stats()

    // Assert
    expect(pixels.channels[0].max).toBeLessThan(5)
    expect(pixels.channels[2].min).toBeGreaterThan(250)
  })

  test('rejects actual APNG animation even when Sharp metadata exposes only its first page', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const animation = Buffer.alloc(8)
    animation.writeUInt32BE(2, 0)
    const frame = Buffer.alloc(26)
    frame.writeUInt32BE(1920, 4)
    frame.writeUInt32BE(1080, 8)
    frame.writeUInt16BE(1, 20)
    frame.writeUInt16BE(10, 22)
    const nextFrame = Buffer.from(frame)
    nextFrame.writeUInt32BE(1, 0)
    const sequence = Buffer.alloc(4)
    sequence.writeUInt32BE(2, 0)
    const pixels = pngPixels(original.bytes)
    const apng = Buffer.concat([
      original.bytes.subarray(0, 33),
      pngChunk('acTL', animation),
      pngChunk('fcTL', frame),
      pngChunk('IDAT', pixels),
      pngChunk('fcTL', nextFrame),
      pngChunk('fdAT', Buffer.concat([sequence, pixels])),
      pngChunk('IEND', Buffer.alloc(0)),
    ])
    expect((await sharp(apng).metadata()).pages ?? 1).toBe(1)
    await fs.writeFile(original.path, apng)

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('Animated PNG and WebP')

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([])
  })

  test('rejects real animated WebP rather than silently saving its first frame', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const secondFrame = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer()
    const animated = await sharp([original.bytes, secondFrame], {
      join: { animated: true },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer()
    expect((await sharp(animated).metadata()).pages).toBe(2)
    await fs.writeFile(original.path, animated)

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('Animated PNG and WebP')

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([])
  })

  test('rejects folders and damaged chunk lengths while preserving the picked input', async () => {
    // Arrange
    const original = await writeImage(1920, 1080, 'webp')
    const damaged = Buffer.from(original.bytes)
    damaged.writeUInt32LE(0xffffffff, 4)
    await fs.writeFile(original.path, damaged)

    // Act
    await expect(images.importBackgroundImage(directory, 1)).rejects.toThrow(
      'regular image file',
    )
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('incomplete or damaged')

    // Assert
    expect(await fs.readFile(original.path)).toEqual(damaged)
  })

  test('removes a failed staging copy and accepts the next import after disk write failure', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('could not be imported')
    const draft = await images.importBackgroundImage(original.path, 1)

    // Assert
    expect(draft.width).toBe(1920)
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([draft.source.draftId])
    expect(await fs.readFile(original.path)).toEqual(original.bytes)
  })

  test('removes partially prepared files when preview encoding fails and later imports still work', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    vi.spyOn(sharp.prototype, 'toFile').mockRejectedValueOnce(
      new Error('preview failed'),
    )

    // Act
    await expect(
      images.importBackgroundImage(original.path, 1),
    ).rejects.toThrow('could not be imported')
    const draft = await images.importBackgroundImage(original.path, 1)

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([draft.source.draftId])
  })
})

describe('background draft ownership and crop publication', () => {
  test.each([5, 6, 7, 8])(
    'extracts EXIF orientation %i using portrait source coordinates before publishing a display',
    async (orientation) => {
      // Arrange
      const original = await writeImage(1920, 1080, 'jpeg', orientation)
      const draft = await images.importBackgroundImage(original.path, 1)
      images.claimBackgroundDraft(draft.source.draftId)

      // Act
      const prepared = await images.prepareBackgroundDisplay(
        draft.source,
        DEFAULT_BACKGROUND_CROP,
        [],
        () => true,
      )

      // Assert
      expect([prepared?.image.width, prepared?.image.height]).toEqual([
        1080, 1920,
      ])
    },
  )

  test('transfers ownership synchronously so a close or late Cancel cannot delete accepted input', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 7)

    // Act
    const upload = images.claimBackgroundDraft(draft.source.draftId)
    await images.discardBackgroundDraftsForOwner(7)
    await images.discardBackgroundDraft(draft.source.draftId)
    const replay = await images.getBackgroundPreview(draft.source, [])
    const published = await images.publishBackgroundDraft(draft.source.draftId)

    // Assert
    expect(upload).not.toBeInstanceOf(Promise)
    expect(replay.source).toEqual(draft.source)
    expect(replay.image).toEqual(draft.image)
    expect(published.id).toBe(upload.id)
    expect(
      await fs.readFile(
        join(
          electronPaths.userData,
          'backgrounds',
          'uploads',
          upload.id,
          'original',
        ),
      ),
    ).toEqual(original.bytes)
    expect(() => images.claimBackgroundDraft(draft.source.draftId)).toThrow(
      'already being applied',
    )
  })

  test('deletes only the cancelled window’s unclaimed draft and leaves accepted and other-window drafts available', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const cancelled = await images.importBackgroundImage(original.path, 1)
    const accepted = await images.importBackgroundImage(original.path, 1)
    const other = await images.importBackgroundImage(original.path, 2)
    images.claimBackgroundDraft(accepted.source.draftId)

    // Act
    await images.discardBackgroundDraftsForOwner(1)

    // Assert
    expect(() => images.claimBackgroundDraft(cancelled.source.draftId)).toThrow(
      'expired',
    )
    expect((await images.getBackgroundPreview(accepted.source, [])).width).toBe(
      1920,
    )
    expect((await images.getBackgroundPreview(other.source, [])).width).toBe(
      1920,
    )
    expect(await fs.readFile(original.path)).toEqual(original.bytes)
  })

  test('cancels an import whose owner closes during its staging write and lets the next queued import finish', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const writeFile = fs.writeFile
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
      entered()
      await paused
      return writeFile(...args)
    })
    const first = images.importBackgroundImage(original.path, 1)
    const rejected = expect(first).rejects.toThrow('cancelled')
    const next = images.importBackgroundImage(original.path, 2)
    await started

    // Act
    await images.discardBackgroundDraftsForOwner(1)
    release()
    await rejected
    const draft = await next

    // Assert
    expect(
      await fs.readdir(join(electronPaths.userData, 'backgrounds', 'staging')),
    ).toEqual([draft.source.draftId])
  })

  test('keeps the same claimed source for retry after a publication rename fails', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    const expectedUpload = images.claimBackgroundDraft(draft.source.draftId)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'))

    // Act
    await expect(
      images.publishBackgroundDraft(draft.source.draftId),
    ).rejects.toThrow('rename failed')
    const upload = await images.publishBackgroundDraft(draft.source.draftId)
    const retried = await images.publishBackgroundDraft(draft.source.draftId)

    // Assert
    expect(upload).toEqual(expectedUpload)
    expect(retried).toEqual(expectedUpload)
    expect((await images.getBackgroundPreview(draft.source, [])).image).toEqual(
      draft.image,
    )
  })

  test('preserves a committed owned original when the external file moves or is deleted', async () => {
    // Arrange
    const original = await writeImage(3840, 2160)
    const draft = await images.importBackgroundImage(original.path, 1)
    images.claimBackgroundDraft(draft.source.draftId)
    const upload = await images.publishBackgroundDraft(draft.source.draftId)
    await images.finishBackgroundDraft(draft.source.draftId, true)
    const moved = join(directory, 'moved.png')
    await fs.rename(original.path, moved)
    await fs.rm(moved)

    // Act
    const source = { kind: 'upload', uploadId: upload.id } as const
    const preview = await images.getBackgroundPreview(source, [upload])
    const prepared = await images.prepareBackgroundDisplay(
      source,
      DEFAULT_BACKGROUND_CROP,
      [upload],
      () => true,
    )

    // Assert
    expect([preview.width, preview.height]).toEqual([3840, 2160])
    expect([preview.image.width, preview.image.height]).toEqual([1920, 1080])
    expect([prepared?.image.width, prepared?.image.height]).toEqual([
      3840, 2160,
    ])
    expect(
      await fs.readFile(
        join(
          electronPaths.userData,
          'backgrounds',
          'uploads',
          upload.id,
          'original',
        ),
      ),
    ).toEqual(original.bytes)
    expect(() => images.claimBackgroundDraft(draft.source.draftId)).toThrow(
      'expired',
    )
  })

  test('extracts the accepted original crop so excluded red pixels never enter the blue display', async () => {
    // Arrange
    const blueHalf = await sharp({
      create: { width: 1920, height: 1080, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer()
    const sourceBytes = await sharp({
      create: { width: 3840, height: 1080, channels: 3, background: 'red' },
    })
      .composite([{ input: blueHalf, left: 1920, top: 0 }])
      .png()
      .toBuffer()
    const path = join(directory, 'two-colors.png')
    await fs.writeFile(path, sourceBytes)
    const draft = await images.importBackgroundImage(path, 1)
    images.claimBackgroundDraft(draft.source.draftId)

    // Act
    const prepared = await images.prepareBackgroundDisplay(
      draft.source,
      { x: 50, y: 0, width: 50, height: 100 },
      [],
      () => true,
    )
    expect(prepared).not.toBeNull()
    if (!prepared) throw new Error('Missing display')
    const pixels = await sharp(descriptorBytes(prepared.image.url)).stats()
    const reloaded = await images.readBackgroundDisplay(prepared.displayId)

    // Assert
    expect([prepared.image.width, prepared.image.height]).toEqual([1920, 1080])
    expect(pixels.channels[0].max).toBeLessThan(5)
    expect(pixels.channels[2].min).toBeGreaterThan(250)
    expect(reloaded).toEqual(prepared.image)
  })

  test('rejects an undersized crop and an edited owned original before publishing any display', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    images.claimBackgroundDraft(draft.source.draftId)

    // Act
    await expect(
      images.prepareBackgroundDisplay(
        draft.source,
        { x: 0, y: 0, width: 99.99, height: 100 },
        [],
        () => true,
      ),
    ).rejects.toThrow('crop needs')
    const replacement = await writeImage(2000, 1080)
    await fs.writeFile(
      join(
        electronPaths.userData,
        'backgrounds',
        'staging',
        draft.source.draftId,
        'original',
      ),
      replacement.bytes,
    )
    await expect(
      images.prepareBackgroundDisplay(
        draft.source,
        DEFAULT_BACKGROUND_CROP,
        [],
        () => true,
      ),
    ).rejects.toThrow('original image changed')

    // Assert
    await expect(
      fs.stat(join(electronPaths.userData, 'backgrounds', 'displays')),
    ).rejects.toThrow('ENOENT')
  })

  test('skips superseded queued work before reading its source and removes a superseded encoded display', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    const isCurrent = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false)

    // Act
    const skipped = await images.prepareBackgroundDisplay(
      { kind: 'upload', uploadId: randomUUID() },
      DEFAULT_BACKGROUND_CROP,
      [],
      () => false,
    )
    const cancelled = await images.prepareBackgroundDisplay(
      draft.source,
      DEFAULT_BACKGROUND_CROP,
      [],
      isCurrent,
    )

    // Assert
    expect(skipped).toBeNull()
    expect(cancelled).toBeNull()
    expect(
      await fs.readdir(
        join(electronPaths.userData, 'backgrounds', 'display-staging'),
      ),
    ).toEqual([])
    await expect(
      fs.stat(join(electronPaths.userData, 'backgrounds', 'displays')),
    ).rejects.toThrow('ENOENT')
  })

  test('removes unpublished display output after rename failure and prepares successfully on retry', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(
      new Error('display rename failed'),
    )

    // Act
    await expect(
      images.prepareBackgroundDisplay(
        draft.source,
        DEFAULT_BACKGROUND_CROP,
        [],
        () => true,
      ),
    ).rejects.toThrow('display rename failed')
    const prepared = await images.prepareBackgroundDisplay(
      draft.source,
      DEFAULT_BACKGROUND_CROP,
      [],
      () => true,
    )

    // Assert
    expect(prepared?.image.width).toBe(1920)
    expect(
      await fs.readdir(
        join(electronPaths.userData, 'backgrounds', 'display-staging'),
      ),
    ).toEqual([])
  })

  test('abandons only its own published upload and surfaces unlink failure without deleting the external original', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    images.claimBackgroundDraft(draft.source.draftId)
    const upload = await images.publishBackgroundDraft(draft.source.draftId)
    const prepared = await images.prepareBackgroundDisplay(
      draft.source,
      DEFAULT_BACKGROUND_CROP,
      [],
      () => true,
    )
    if (!prepared) throw new Error('Missing display')
    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('unlink failed'))

    // Act
    await expect(
      images.removeBackgroundDisplay(prepared.displayId),
    ).rejects.toThrow('unlink failed')
    await images.removeBackgroundDisplay(prepared.displayId)
    await images.finishBackgroundDraft(draft.source.draftId, false)

    // Assert
    await expect(
      fs.stat(
        join(electronPaths.userData, 'backgrounds', 'uploads', upload.id),
      ),
    ).rejects.toThrow('ENOENT')
    expect(await fs.readFile(original.path)).toEqual(original.bytes)
  })

  test('lists exactly four verified built-ins and keeps a missing upload visible without sweeping owned files', async () => {
    // Arrange
    const original = await writeImage(1920, 1080)
    const draft = await images.importBackgroundImage(original.path, 1)
    const upload = images.claimBackgroundDraft(draft.source.draftId)
    await images.publishBackgroundDraft(draft.source.draftId)
    await fs.rm(
      join(
        electronPaths.userData,
        'backgrounds',
        'uploads',
        upload.id,
        'thumbnail.webp',
      ),
    )

    // Act
    const catalog = await images.getBackgroundCatalog([upload])
    const preview = await images.getBackgroundPreview(
      { kind: 'builtin', builtinId: 'quiet-dunes' },
      [],
    )

    // Assert
    expect(catalog.builtins.map((item) => item.title)).toEqual([
      'Alpine lake',
      'Misty forest',
      'Pacific coast',
      'Quiet dunes',
    ])
    expect(
      catalog.builtins.map((item) => item.credit?.photographerName),
    ).toEqual(['Mike Petrucci', 'T', 'Kellen Riggin', 'Marc Wieland'])
    expect(catalog.builtins.map((item) => item.thumbnail?.width)).toEqual([
      480, 480, 480, 480,
    ])
    expect(catalog.uploads[0].thumbnail).toBeNull()
    expect([preview.width, preview.height]).toEqual([3840, 2160])
    expect([preview.image.width, preview.image.height]).toEqual([1920, 1080])
    expect(
      await fs.readFile(
        join(
          electronPaths.userData,
          'backgrounds',
          'uploads',
          upload.id,
          'original',
        ),
      ),
    ).toEqual(original.bytes)
    await images.removeBackgroundUpload(upload.id)
    expect(await fs.readFile(original.path)).toEqual(original.bytes)
  })

  test('rejects unknown tokens, missing library sources and path-like IDs before accessing arbitrary files', async () => {
    // Arrange
    const unknown = randomUUID()

    // Act / Assert
    await expect(images.publishBackgroundDraft(unknown)).rejects.toThrow(
      'expired',
    )
    await expect(
      images.getBackgroundPreview({ kind: 'upload', uploadId: unknown }, []),
    ).rejects.toThrow('removed')
    await expect(
      images.readBackgroundDisplay('../../external'),
    ).rejects.toThrow()
    await expect(
      images.removeBackgroundUpload('../../external'),
    ).rejects.toThrow()
    await expect(
      images.removeBackgroundDisplay('../../external'),
    ).rejects.toThrow()
    await expect(
      images.discardBackgroundDraft('../../external'),
    ).rejects.toThrow()
  })
})
