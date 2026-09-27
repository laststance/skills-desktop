/**
 * Points every website download link at a release. The links live in 3 files
 * (6 URLs); `llms.txt` was missed in two past releases, so this script owns the
 * list and fails unless exactly 6 URLs end up on the target version.
 *
 * Run by `/electron-release` after the GitHub release exists (never before, or
 * the live links 404 during the build): `pnpm release:bump-website [version]`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { REPO_ROOT, resolveVersion } from './release-common.mjs'

const WEBSITE_DOWNLOAD_FILES = [
  'apps/website/src/components/Hero.tsx',
  'apps/website/src/components/Download.tsx',
  'apps/website/public/llms.txt',
]
const EXPECTED_URL_COUNT = 6
const RELEASE_URL =
  /releases\/download\/v\d+\.\d+\.\d+\/skills-desktop-\d+\.\d+\.\d+-/g

const version = await resolveVersion(process.argv[2])
const replacement = `releases/download/v${version}/skills-desktop-${version}-`
const sources = await Promise.all(
  WEBSITE_DOWNLOAD_FILES.map(async (relativePath) => {
    const path = join(REPO_ROOT, relativePath)
    const source = await readFile(path, 'utf8')
    const count = source.match(RELEASE_URL)?.length ?? 0
    // Every file carries an arm64 and an x64 link; zero means the markup moved.
    if (count === 0)
      throw new Error(`${relativePath}: no release download URLs found`)
    return { relativePath, path, source, count }
  }),
)

// Count before writing so a moved link leaves every file untouched.
const total = sources.reduce((sum, { count }) => sum + count, 0)
if (total !== EXPECTED_URL_COUNT) {
  throw new Error(
    `Expected ${EXPECTED_URL_COUNT} download URLs, found ${total}`,
  )
}

for (const { relativePath, path, source, count } of sources) {
  await writeFile(path, source.replaceAll(RELEASE_URL, replacement))
  console.log(`${relativePath}: ${count} URL(s) → v${version}`)
}
console.log(`✅ ${total} website download URLs point at v${version}`)
