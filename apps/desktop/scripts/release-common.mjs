import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

export const execFileAsync = promisify(execFile)

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = join(DESKTOP_DIR, '..', '..')
export const DIST_DIR = join(DESKTOP_DIR, 'dist')
export const ARCHES = /** @type {const} */ (['arm64', 'x64'])

/** Release scripts default to the version `/electron-release` just bumped, so no step can target a stale one.
 * @param {string | undefined} override - Explicit version from argv, used to re-verify an older release.
 * @returns {Promise<string>} Semver without the `v` prefix.
 * @example const version = await resolveVersion(process.argv[2])
 */
export async function resolveVersion(override) {
  if (override) return override.replace(/^v/, '')
  const manifest = JSON.parse(
    await readFile(join(DESKTOP_DIR, 'package.json'), 'utf8'),
  )
  return manifest.version
}

/** Asset names electron-builder writes into `latest-mac.yml`; the GitHub release must carry exactly these.
 * @param {string} version - Release version without the `v` prefix.
 * @example assetNames('0.32.1').dmg.arm64 // 'skills-desktop-0.32.1-arm64.dmg'
 */
export function assetNames(version) {
  return {
    dmg: {
      arm64: `skills-desktop-${version}-arm64.dmg`,
      x64: `skills-desktop-${version}-x64.dmg`,
    },
    zip: {
      arm64: `Skills-Desktop-${version}-arm64-mac.zip`,
      x64: `Skills-Desktop-${version}-mac.zip`,
    },
  }
}

/** electron-builder's `sha512` is base64 of the raw digest, not hex; every yml comparison goes through here.
 * @param {Buffer} bytes - Whole file contents.
 * @returns {string} Base64 SHA-512.
 */
export function sha512Base64(bytes) {
  return createHash('sha512').update(bytes).digest('base64')
}

/** Reads `files:` entries plus the top-level `version`/`path`/`sha512` the updater compares and downloads.
 * @param {string} yml - `latest-mac.yml` contents.
 * @returns {{ files: { url: string, sha512: string, size: number }[], version: string, path: string, sha512: string }}
 */
export function parseLatestMacYml(yml) {
  const files = [
    ...yml.matchAll(/- url: (\S+)\n\s+sha512: (\S+)\n\s+size: (\d+)/g),
  ].map(([, url, sha512, size]) => ({ url, sha512, size: Number(size) }))
  const version = yml.match(/^version: (\S+)$/m)?.[1]
  const path = yml.match(/^path: (\S+)$/m)?.[1]
  const sha512 = yml.match(/^sha512: (\S+)$/m)?.[1]
  if (!version || !path || !sha512 || files.length !== 4) {
    throw new Error(
      'latest-mac.yml does not have 4 files plus version/path/sha512',
    )
  }
  return { files, version, path, sha512 }
}

/** `stapler validate` exits 0 only when the notarization ticket is attached to this exact file.
 * @param {string} file - DMG path.
 * @returns {Promise<boolean>} Whether a ticket is stapled.
 */
export async function isStapled(file) {
  try {
    await execFileAsync('xcrun', ['stapler', 'validate', file])
    return true
  } catch {
    return false
  }
}
