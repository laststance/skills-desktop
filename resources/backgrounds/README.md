# Bundled backgrounds

Four curated starter photos, downloaded from their public Unsplash photo pages
on 2026-09-08 JST. Each page identified the photo as free under the
[Unsplash License](https://unsplash.com/license). These are bundled application
assets acquired separately from the live Unsplash API integration.

| ID              | Photographer                                        | Source                                                                                                     | Downloaded pixels | Bundled pixels | Thumbnail pixels |
| --------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | -------------- | ---------------- |
| `alpine-lake`   | [Mike Petrucci](https://unsplash.com/@mikepetrucci) | [Photo](https://unsplash.com/photos/lake-forest-and-mountains-during-day-5oRIcisKaxU)                      | 4608 × 3072       | 3840 × 2560    | 480 × 320        |
| `misty-forest`  | [T](https://unsplash.com/@tanyabarrow)              | [Photo](https://unsplash.com/photos/misty-pine-forest-with-dense-undergrowth-c7f6RvusKDA)                  | 6000 × 4000       | 3840 × 2560    | 480 × 320        |
| `pacific-coast` | [Kellen Riggin](https://unsplash.com/@kalaniparker) | [Photo](https://unsplash.com/photos/coastal-landscape-with-ocean-and-rocky-cliffs-5XWwlkEnscA)             | 7728 × 5152       | 3840 × 2560    | 480 × 320        |
| `quiet-dunes`   | [Marc Wieland](https://unsplash.com/@mawiswiss)     | [Photo](https://unsplash.com/photos/desert-landscape-with-rolling-sand-dunes-under-a-pale-sky-v--MQrXgC90) | 3990 × 2244       | 3840 × 2160    | 480 × 270        |

## Metadata contract

`manifest.json` is the attribution and file inventory. Its four stable `id`
values identify built-in choices; filenames are relative to this directory.
`width` / `height` describe the bundled WebP and are the crop coordinate space.
`source.originalWidth` / `source.originalHeight` describe the downloaded JPEG
after orientation; they are provenance, not the runtime crop dimensions.

The manifest preserves source-page, photographer-profile and download URLs,
license verification time, original dimensions, and SHA-256 hashes of originals
and derivatives. The original JPEGs are not packaged. Display photographer and
Unsplash credits from this metadata; do not add live API download notifications
for these bundled files.

## Conversion

Sharp 0.35.4 auto-oriented each source, converted to sRGB, then resized inside
3840 × 3840 without enlargement or cropping. WebP quality is 88, effort 6.
Thumbnails are independently resized from the downloaded source inside
480 × 480, quality 78, effort 6. The complete frame is preserved; crop selection
belongs to the application. EXIF metadata is stripped from the derivatives.

The four full images total 5,710,138 bytes; the four thumbnails total 61,244
bytes. All eight files were fully decoded after conversion, checked against
the manifest, and visually inspected.

## Verification

Run from the repository root after installing dependencies:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import sharp from 'sharp'

const directory = 'resources/backgrounds/'
const { photos } = JSON.parse(await readFile(directory + 'manifest.json', 'utf8'))
assert.deepEqual(photos.map(photo => photo.id), [
  'alpine-lake', 'misty-forest', 'pacific-coast', 'quiet-dunes',
])
assert.deepEqual(photos.map(photo => [photo.width, photo.height]), [
  [3840, 2560], [3840, 2560], [3840, 2560], [3840, 2160],
])
assert.equal((await readdir(directory)).filter(name => name.endsWith('.webp')).length, 8)
for (const photo of photos) {
  for (const thumbnail of [false, true]) {
    const filename = thumbnail ? photo.thumbnailFilename : photo.filename
    const bytes = await readFile(directory + filename)
    const metadata = await sharp(bytes, { failOn: 'warning' }).metadata()
    assert.equal(metadata.format, 'webp')
    assert.equal(metadata.pages ?? 1, 1)
    assert.equal(Math.max(metadata.width, metadata.height), thumbnail ? 480 : 3840)
    assert.deepEqual([metadata.width, metadata.height], thumbnail
      ? [photo.thumbnailWidth, photo.thumbnailHeight]
      : [photo.width, photo.height])
    assert.equal(bytes.length, thumbnail ? photo.thumbnailBytes : photo.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      thumbnail ? photo.thumbnailSha256 : photo.sha256)
    await sharp(bytes, { failOn: 'warning' }).raw().toBuffer()
  }
}
console.log('Verified four backgrounds and four thumbnails')
JS
```
