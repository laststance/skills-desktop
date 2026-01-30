/**
 * Generate app icons from SVG source
 * Creates PNG at various sizes and macOS icns
 */
const sharp = require('sharp')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const SIZES = [16, 32, 64, 128, 256, 512, 1024]
const SVG_PATH = path.join(__dirname, '../resources/icon.svg')
const OUTPUT_DIR = path.join(__dirname, '../resources')
const ICONSET_DIR = path.join(OUTPUT_DIR, 'icon.iconset')

async function generateIcons() {
  // Create iconset directory
  if (!fs.existsSync(ICONSET_DIR)) {
    fs.mkdirSync(ICONSET_DIR, { recursive: true })
  }

  // Read SVG
  const svgBuffer = fs.readFileSync(SVG_PATH)

  // Generate PNGs for iconset
  for (const size of SIZES) {
    const filename =
      size === 1024 ? `icon_512x512@2x.png` : `icon_${size}x${size}.png`
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONSET_DIR, filename))

    // Also create @2x versions for retina
    if (size <= 512 && size >= 32) {
      const retinaFilename = `icon_${size / 2}x${size / 2}@2x.png`
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(path.join(ICONSET_DIR, retinaFilename))
    }

    console.log(`Generated ${filename}`)
  }

  // Also create main icon.png
  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(OUTPUT_DIR, 'icon.png'))
  console.log('Generated icon.png')

  // Convert to icns using macOS iconutil
  try {
    execSync(
      `iconutil -c icns "${ICONSET_DIR}" -o "${path.join(OUTPUT_DIR, 'icon.icns')}"`,
    )
    console.log('Generated icon.icns')
  } catch (err) {
    console.error('Failed to generate icns (requires macOS):', err.message)
  }

  // Clean up iconset directory
  fs.rmSync(ICONSET_DIR, { recursive: true })
  console.log('Cleaned up iconset directory')
}

generateIcons().catch(console.error)
