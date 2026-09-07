import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs, promisify } from 'node:util'

import { _electron } from 'playwright'

const execFileAsync = promisify(execFile)
const APPLY_TIMEOUT_MS = 30_000
const CSP_IMAGE_PROBE_URL =
  'https://images.unsplash.com/photo-csp-fixture?ixid=fixture'
const CSP_RPC_PROBE_URL =
  'https://skills-desktop.vercel.app/api/rpc/unsplash/search'

/** Probes actual packaged document CSP while substituting only HTTP fixture bytes; {@link verifyBundle} checks both windows.
 * @param {import('playwright').Page} rendererPage - Real packaged Main or Settings renderer, without CSP bypass.
 * @param {Buffer} fixturePng - Valid bytes created by this package's Sharp runtime.
 * @returns {Promise<object>} Script rejection and allowed image/proxy request evidence, independent of provider credentials.
 * @example await verifyRendererCsp(mainWindow, await readFile(validSource))
 */
async function verifyRendererCsp(rendererPage, fixturePng) {
  assert.equal(new URL(rendererPage.url()).protocol, 'file:')
  // Playwright evaluation can execute under CSP; an inserted script element must still be rejected by Chromium.
  await assert.rejects(
    rendererPage.addScriptTag({
      content:
        "document.documentElement.dataset.backgroundCspProbe = 'executed'",
    }),
    /content security policy/i,
  )
  assert.equal(
    await rendererPage.evaluate(() =>
      document.documentElement.getAttribute('data-background-csp-probe'),
    ),
    null,
  )
  const requests = []
  await rendererPage.route(CSP_IMAGE_PROBE_URL, async (route) => {
    requests.push({ kind: 'image' })
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: fixturePng,
    })
  })
  await rendererPage.route(CSP_RPC_PROBE_URL, async (route) => {
    // Fixture responses exercise allowed CSP requests; intercepted headers do not prove wire CORS.
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'null',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'content-type',
        },
      })
      return
    }
    requests.push({ kind: 'rpc' })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': 'null' },
      body: JSON.stringify({ json: { items: [], nextPage: null } }),
    })
  })
  try {
    const result = await rendererPage.evaluate(
      async ({ imageUrl, rpcUrl }) => {
        const image = new Image()
        image.src = imageUrl
        await image.decode()
        const response = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ json: { query: 'nature', page: 1 } }),
        })
        if (!response.ok) throw new Error('The allowed proxy fixture failed')
        return {
          imageWidth: image.naturalWidth,
          imageHeight: image.naturalHeight,
          rpcPayload: await response.json(),
        }
      },
      { imageUrl: CSP_IMAGE_PROBE_URL, rpcUrl: CSP_RPC_PROBE_URL },
    )
    assert.deepEqual(result, {
      imageWidth: 1920,
      imageHeight: 1080,
      rpcPayload: { json: { items: [], nextPage: null } },
    })
    assert.deepEqual(requests, [{ kind: 'image' }, { kind: 'rpc' }])
    return {
      inlineScriptBlocked: true,
      imageDecoded: true,
      proxyRequestAllowed: true,
      documentOrigin: await rendererPage.evaluate(() => location.origin),
      network:
        'fixture responses; wire CORS and provider availability checked separately',
    }
  } finally {
    await rendererPage.unroute(CSP_IMAGE_PROBE_URL)
    await rendererPage.unroute(CSP_RPC_PROBE_URL)
  }
}

/** Runs actual packaged Sharp and upload IPC against one isolated architecture; {@link main} records both results.
 * @param {'arm64' | 'x64'} expectedArchitecture - Required runtime architecture, including Rosetta for x64.
 * @param {string} requestedBundle - Explicit app path; never falls back to a workspace Electron installation.
 * @returns {Promise<object>} Verified package identity, decoding and durable application evidence.
 * @example await verifyBundle('arm64', '/tmp/mac-arm64/Skills Desktop.app')
 */
async function verifyBundle(expectedArchitecture, requestedBundle) {
  const bundle = await realpath(resolve(requestedBundle))
  const { stdout } = await execFileAsync('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleExecutable',
    join(bundle, 'Contents', 'Info.plist'),
  ])
  const executablePath = join(bundle, 'Contents', 'MacOS', stdout.trim())
  const isolatedHome = await mkdtemp(
    join(tmpdir(), 'skills-packaged-backgrounds-'),
  )
  const userData = join(isolatedHome, 'userData')
  const validSource = join(isolatedHome, 'full-hd.png')
  const smallSource = join(isolatedHome, 'too-small.png')
  const corruptSource = join(isolatedHome, 'corrupt.png')
  const launchOptions = {
    executablePath,
    bypassCSP: false,
    env: {
      ...process.env,
      HOME: isolatedHome,
      E2E_USERDATA_DIR: userData,
      E2E_DISABLE_UPDATE: '1',
      E2E_BACKGROUND_LAUNCH: '1',
      ELECTRON_RUN_AS_NODE: '',
    },
  }
  let application
  let picker
  try {
    await mkdir(join(isolatedHome, '.agents', 'skills'), { recursive: true })
    application = await _electron.launch(launchOptions)
    const identity = await application.evaluate(
      async ({ app }, input) => {
        const path = process.getBuiltinModule('path')
        const fileSystem = process.getBuiltinModule('fs').promises
        const requirePackage = process
          .getBuiltinModule('module')
          .createRequire(path.join(app.getAppPath(), 'package.json'))
        const sharpPath = requirePackage.resolve('sharp')
        // Package identity and resolution must agree before exercising any app-owned files.
        for (const resolvedPath of [
          app.getAppPath(),
          process.execPath,
          sharpPath,
        ]) {
          const relative = path.relative(input.bundle, resolvedPath)
          if (relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error(
              `Runtime module escaped the requested app: ${resolvedPath}`,
            )
        }
        if (!app.isPackaged || process.arch !== input.expectedArchitecture)
          throw new Error('The requested packaged architecture did not launch')
        if (app.getPath('userData') !== input.userData)
          throw new Error(
            'Packaged smoke did not receive its isolated userData',
          )
        const sharp = requirePackage('sharp')
        await sharp({
          create: {
            width: 1920,
            height: 1080,
            channels: 3,
            background: '#305976',
          },
        })
          .png()
          .toFile(input.validSource)
        await sharp({
          create: {
            width: 1919,
            height: 1080,
            channels: 3,
            background: '#305976',
          },
        })
          .png()
          .toFile(input.smallSource)
        await fileSystem.writeFile(input.corruptSource, 'This is not an image.')
        const decoded = await sharp(input.validSource)
          .raw()
          .toBuffer({ resolveWithObject: true })
        return {
          packaged: app.isPackaged,
          architecture: process.arch,
          appPath: app.getAppPath(),
          executablePath: process.execPath,
          sharpPath,
          sharpVersion: sharp.versions.sharp,
          vipsVersion: sharp.versions.vips,
          decoded: {
            width: decoded.info.width,
            height: decoded.info.height,
            bytes: decoded.data.length,
          },
        }
      },
      {
        bundle,
        expectedArchitecture,
        userData,
        validSource,
        smallSource,
        corruptSource,
      },
    )
    assert.equal(identity.packaged, true)
    assert.equal(identity.architecture, expectedArchitecture)
    assert.deepEqual(identity.decoded, {
      width: 1920,
      height: 1080,
      bytes: 6220800,
    })
    const window = await application.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    const settingsOpened = application.waitForEvent('window')
    await window.getByRole('button', { name: 'Open settings' }).click()
    const settingsWindow = await settingsOpened
    await settingsWindow.waitForLoadState('domcontentloaded')
    await settingsWindow
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    const fixturePng = await readFile(validSource)
    const csp = {
      main: await verifyRendererCsp(window, fixturePng),
      settings: await verifyRendererCsp(settingsWindow, fixturePng),
    }
    const catalog = await window.evaluate(() =>
      window.electron.backgrounds.list(),
    )
    assert.deepEqual(
      catalog.builtins.map((item) => item.source.builtinId).sort(),
      ['alpine-lake', 'misty-forest', 'pacific-coast', 'quiet-dunes'],
    )
    // Substitute only the native chooser; validation, staging, processing, IPC and settings remain real.
    picker = await application.evaluateHandle(({ dialog }, source) => {
      const originalPicker = dialog.showOpenDialog
      let selectedPath = source
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [selectedPath],
      })
      return {
        select: (nextPath) => {
          selectedPath = nextPath
        },
        restore: () => {
          dialog.showOpenDialog = originalPicker
        },
      }
    }, validSource)
    const draft = await window.evaluate(() =>
      window.electron.backgrounds.importImage(),
    )
    assert.equal(draft?.source.kind, 'upload-draft')
    assert.equal(draft.width, 1920)
    assert.equal(draft.height, 1080)
    const accepted = await window.evaluate(
      (input) => window.electron.backgrounds.apply(input),
      {
        requestId: randomUUID(),
        source: draft.source,
        crop: { x: 0, y: 0, width: 100, height: 100 },
        aspect: 'original',
      },
    )
    await window.waitForFunction(
      async (operationId) => {
        const snapshot = await window.electron.backgrounds.getSnapshot()
        return (
          snapshot.operation?.operationId === operationId &&
          snapshot.operation.status !== 'applying'
        )
      },
      accepted.operationId,
      { timeout: APPLY_TIMEOUT_MS },
    )
    const applied = await window.evaluate(() =>
      window.electron.backgrounds.getSnapshot(),
    )
    assert.equal(applied.operation?.status, 'succeeded')
    assert.equal(applied.display?.selection.source.kind, 'upload')
    const settingsPath = join(userData, 'settings.json')
    const committed = JSON.parse(await readFile(settingsPath, 'utf8'))
    assert.equal(committed.background.uploads.length, 1)
    assert.equal(committed.background.hasAppliedImage, true)
    assert.equal(committed.windowBackgroundOpacityPercent, 60)
    assert.equal(committed.background.selected.source.kind, 'upload')
    const displayPixels = await application.evaluate(
      async ({ app }, displayId) => {
        const path = process.getBuiltinModule('path')
        const requirePackage = process
          .getBuiltinModule('module')
          .createRequire(path.join(app.getAppPath(), 'package.json'))
        const sharp = requirePackage('sharp')
        const decoded = await sharp(
          path.join(
            app.getPath('userData'),
            'backgrounds',
            'displays',
            `${displayId}.webp`,
          ),
        )
          .raw()
          .toBuffer({ resolveWithObject: true })
        return {
          width: decoded.info.width,
          height: decoded.info.height,
          bytes: decoded.data.length,
        }
      },
      committed.background.selected.displayId,
    )
    assert.deepEqual(displayPixels, {
      width: 1920,
      height: 1080,
      bytes: 6220800,
    })
    await rename(validSource, join(isolatedHome, 'moved-original.png'))
    const ownedPreview = await window.evaluate(
      (source) => window.electron.backgrounds.preview(source),
      committed.background.selected.source,
    )
    assert.equal(ownedPreview.width, 1920)
    assert.equal(ownedPreview.height, 1080)
    const rejectedImages = []
    for (const source of [smallSource, corruptSource]) {
      await picker.evaluate(
        (nativePicker, path) => nativePicker.select(path),
        source,
      )
      const rejected = await window.evaluate(async () => {
        try {
          await window.electron.backgrounds.importImage()
          return { rejected: false, message: '' }
        } catch (error) {
          return {
            rejected: true,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      })
      assert.equal(rejected.rejected, true)
      assert.notEqual(rejected.message, '')
      assert.deepEqual(
        JSON.parse(await readFile(settingsPath, 'utf8')).background,
        committed.background,
      )
      rejectedImages.push({
        fixture: source === smallSource ? '1919x1080' : 'corrupt',
        rejected: true,
      })
    }
    await picker.evaluate((nativePicker) => nativePicker.restore())
    picker = undefined
    await application.close()
    application = await _electron.launch(launchOptions)
    const reopenedWindow = await application.firstWindow()
    await reopenedWindow.waitForLoadState('domcontentloaded')
    await reopenedWindow.waitForFunction(
      async () =>
        Boolean((await window.electron.backgrounds.getSnapshot()).display),
      null,
      { timeout: APPLY_TIMEOUT_MS },
    )
    const restored = await reopenedWindow.evaluate(() =>
      window.electron.backgrounds.getSnapshot(),
    )
    assert.equal(restored.operation, null)
    assert.deepEqual(restored.display?.selection, committed.background.selected)
    return {
      ...identity,
      csp,
      displayPixels,
      uploadApplied: true,
      movedOriginalPreserved: true,
      rejectedImages,
      restartRestored: true,
    }
  } finally {
    // These handles and directories belong only to this run; never discover or stop unrelated Electron processes.
    try {
      await picker
        ?.evaluate((nativePicker) => nativePicker.restore())
        .catch(() => undefined)
      await application
        ?.close()
        .catch(() => application?.process().kill('SIGTERM'))
    } finally {
      await rm(isolatedHome, { recursive: true, force: true })
    }
  }
}

/** Requires both explicit package paths and writes per-architecture evidence; this is separate from visible macOS compositor QA.
 * @returns {Promise<void>} Records all outcomes and fails the command if either architecture did not pass.
 * @example pnpm test:packaged:backgrounds -- --arm64 '/tmp/arm64.app' --x64 '/tmp/x64.app' --output '/tmp/backgrounds.json'
 */
async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--') args.shift()
  const { values } = parseArgs({
    args,
    options: {
      arm64: { type: 'string' },
      x64: { type: 'string' },
      output: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (
    process.platform !== 'darwin' ||
    !values.arm64 ||
    !values.x64 ||
    !values.output
  )
    throw new Error(
      'Run on macOS with --arm64 <app> --x64 <app> --output <evidence.json>. Both package paths are required.',
    )
  if ((await realpath(values.arm64)) === (await realpath(values.x64)))
    throw new Error('arm64 and x64 must name different packaged applications')
  const output = resolve(values.output)
  await mkdir(dirname(output), { recursive: true })
  const evidence = {
    capturedAt: new Date().toISOString(),
    hostArchitecture: process.arch,
    complete: false,
    results: [],
  }
  for (const architecture of ['arm64', 'x64']) {
    try {
      evidence.results.push({
        status: 'passed',
        ...(await verifyBundle(architecture, values[architecture])),
      })
    } catch (error) {
      evidence.results.push({
        status: 'failed',
        architecture,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
  }
  evidence.complete = evidence.results.every(
    (result) => result.status === 'passed',
  )
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  if (!evidence.complete) process.exitCode = 1
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 1
})
