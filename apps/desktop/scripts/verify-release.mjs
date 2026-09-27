/**
 * Live verification bar for a published release: re-downloads what users get
 * and checks it against the published `latest-mac.yml`.
 *
 * - The published yml is byte-identical to the local `dist/latest-mac.yml` (when present).
 * - All 4 binaries match their yml `sha512` + `size`, including the top-level
 *   `path`/`sha512` the updater reads.
 * - Both DMGs pass `stapler validate` and `spctl` as Notarized Developer ID.
 * - The website and `/llms.txt` link only this version's DMGs.
 *
 * Run by `/electron-release` after the website URL bump deploys:
 * `pnpm release:verify [version]`. Prints LIVE_VERIFY_ALL_OK and exits 0 only when every check passes.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

const SITE_URL = 'https://skills-desktop.vercel.app'
const version = await resolveVersion(process.argv[2])
const names = assetNames(version)
const releaseBase = `https://github.com/laststance/skills-desktop/releases/download/v${version}`
const failures = []

/** Records a failed check without aborting, so one run reports every broken asset. */
function check(ok, label) {
  console.log(`${ok ? '✅' : '❌'} ${label}`)
  if (!ok) failures.push(label)
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const workDir = await mkdtemp(join(tmpdir(), 'skills-desktop-release-'))
try {
  const publishedYml = (
    await download(`${releaseBase}/latest-mac.yml`)
  ).toString('utf8')
  const localYml = await readFile(
    join(DIST_DIR, 'latest-mac.yml'),
    'utf8',
  ).catch(() => null)
  // Local dist is absent when re-verifying an old release from a clean checkout.
  if (localYml !== null)
    check(
      localYml === publishedYml,
      'published latest-mac.yml matches local dist',
    )

  const yml = parseLatestMacYml(publishedYml)
  // The updater decides "update available" from this field alone.
  check(
    yml.version === version,
    `published latest-mac.yml version is ${version}`,
  )
  const hashes = new Map()
  for (const file of yml.files) {
    const bytes = await download(`${releaseBase}/${file.url}`)
    hashes.set(file.url, sha512Base64(bytes))
    check(
      hashes.get(file.url) === file.sha512 && bytes.length === file.size,
      `${file.url} sha512 + size`,
    )
    if (file.url.endsWith('.dmg'))
      await writeFile(join(workDir, file.url), bytes)
  }
  check(
    hashes.get(yml.path) === yml.sha512,
    `top-level path ${yml.path} sha512`,
  )

  for (const arch of ARCHES) {
    const dmg = join(workDir, names.dmg[arch])
    check(await isStapled(dmg), `${names.dmg[arch]} stapled`)
    const { stderr } = await execFileAsync('spctl', [
      '-a',
      '-t',
      'open',
      '--context',
      'context:primary-signature',
      '-vv',
      dmg,
    ]).catch((error) => error)
    check(
      /accepted/.test(stderr) && /Notarized Developer ID/.test(stderr),
      `${names.dmg[arch]} spctl Notarized Developer ID`,
    )
  }

  for (const page of ['/', '/llms.txt']) {
    const html = (await download(`${SITE_URL}${page}`)).toString('utf8')
    const links = [
      ...html.matchAll(
        /releases\/download\/v([\d.]+)\/(skills-desktop-[\w.-]+\.dmg)/g,
      ),
    ]
    const current = links.filter(([, tag]) => tag === version)
    check(
      links.length > 0 &&
        current.length === links.length &&
        ARCHES.every((arch) =>
          current.some(([, , name]) => name === names.dmg[arch]),
        ),
      `${SITE_URL}${page} links only v${version} arm64 + x64 DMGs`,
    )
  }
} finally {
  await rm(workDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`LIVE_VERIFY_FAILED (${failures.length})`)
  process.exit(1)
}
console.log('LIVE_VERIFY_ALL_OK')
