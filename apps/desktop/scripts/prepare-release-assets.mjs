/**
 * Turns a fresh `pnpm build:mac` output into the 5 publishable release assets.
 *
 * electron-builder staples the `.app` but not the DMG container, and stapling
 * changes the DMG bytes, so the DMG `sha512`/`size` in `latest-mac.yml` go
 * stale. Publishing them unfixed breaks DMG integrity checks. This script
 * notarizes + staples both DMGs, re-measures them into the yml, and copies the
 * space-named ZIPs to the hyphenated names the yml already references.
 *
 * Run by `/electron-release` after the build: `pnpm release:prepare-assets`.
 * Idempotent: an already-stapled DMG is not resubmitted.
 */
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  ARCHES,
  assetNames,
  DIST_DIR,
  execFileAsync,
  isStapled,
  parseLatestMacYml,
  resolveVersion,
  sha512Base64,
} from './release-common.mjs'

const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE ?? 'skills-desktop'
const version = await resolveVersion(process.argv[2])
const names = assetNames(version)
const ymlPath = join(DIST_DIR, 'latest-mac.yml')
let yml = await readFile(ymlPath, 'utf8')
const parsed = parseLatestMacYml(yml)

// Prove the hash method on the untouched ZIPs before trusting it for the DMG rewrite.
for (const arch of ARCHES) {
  const spaced = join(
    DIST_DIR,
    names.zip[arch].replace('Skills-Desktop', 'Skills Desktop'),
  )
  const entry = parsed.files.find((file) => file.url === names.zip[arch])
  if (entry?.sha512 !== sha512Base64(await readFile(spaced))) {
    throw new Error(
      `${names.zip[arch]}: yml sha512 does not match the built ZIP`,
    )
  }
  await copyFile(spaced, join(DIST_DIR, names.zip[arch]))
}

// Arches notarize in parallel (~2 min instead of ~4).
await Promise.all(
  ARCHES.map(async (arch) => {
    const dmg = join(DIST_DIR, names.dmg[arch])
    if (await isStapled(dmg)) return
    await execFileAsync('xcrun', [
      'notarytool',
      'submit',
      dmg,
      '--keychain-profile',
      keychainProfile,
      '--wait',
    ])
    await execFileAsync('xcrun', ['stapler', 'staple', dmg])
    if (!(await isStapled(dmg)))
      throw new Error(`${names.dmg[arch]}: staple did not validate`)
  }),
)

for (const arch of ARCHES) {
  const bytes = await readFile(join(DIST_DIR, names.dmg[arch]))
  const pattern = new RegExp(
    `(- url: ${names.dmg[arch].replaceAll('.', '\\.')}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`,
  )
  if (!pattern.test(yml))
    throw new Error(`${names.dmg[arch]} missing from latest-mac.yml`)
  yml = yml.replace(pattern, `$1${sha512Base64(bytes)}$2${bytes.length}`)
}
// Temp file + rename so an interrupted run never leaves a truncated manifest.
await writeFile(`${ymlPath}.tmp`, yml)
await rename(`${ymlPath}.tmp`, ymlPath)

console.log(`✅ v${version} assets ready in ${DIST_DIR}:`)
for (const asset of [
  'latest-mac.yml',
  ...Object.values(names.zip),
  ...Object.values(names.dmg),
]) {
  console.log(`  ${asset}`)
}
