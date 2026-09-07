import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Locator, Page } from '@playwright/test'

import { test, expect } from '../fixtures/electron-app'
import {
  readSettingsFile,
  settingsFilePath,
  writeSettingsFile,
} from '../helpers/settings-file'

const opacityTest = test.extend<{
  initialSettings: Record<string, unknown>
  settingsWindow: Page
}>({
  initialSettings: [{ windowBackgroundBlurRadius: 24 }, { option: true }],
  isolatedHome: async ({ initialSettings }, use) => {
    const isolatedHome = realpathSync.native(
      mkdtempSync(join(tmpdir(), 'skills-desktop-e2e-opacity-')),
    )
    try {
      writeSettingsFile(isolatedHome, initialSettings)
      mkdirSync(join(isolatedHome, '.claude/skills'), { recursive: true })
      const source = join(isolatedHome, '.agents/skills/opacity-example')
      mkdirSync(source, { recursive: true })
      writeFileSync(
        join(source, 'SKILL.md'),
        '---\nname: opacity-example\ndescription: Background transparency fixture\n---\n# Clear text\n\nReadable through a transparent inspector.\n\nInline `code` stays solid.\n\n```sh\necho readable\n```\n',
      )
      symlinkSync(source, join(isolatedHome, '.claude/skills/opacity-example'))
      await use(isolatedHome)
    } finally {
      rmSync(isolatedHome, { recursive: true, force: true })
    }
  },
  settingsWindow: async ({ electronApp, appWindow }, use) => {
    const opened = electronApp.waitForEvent('window')
    await appWindow.getByRole('button', { name: 'Open settings' }).click()
    const settingsWindow = await opened
    await settingsWindow.waitForLoadState('domcontentloaded')
    await settingsWindow
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    await use(settingsWindow)
  },
})

opacityTest(
  'keeps code opaque and reveals the desktop at 45% and 0% without fading Reading text',
  async ({ appWindow, settingsWindow, electronApp }) => {
    // Arrange
    await appWindow
      .getByRole('heading', { name: 'opacity-example', exact: true })
      .click()
    const slider = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    const code = appWindow.locator('[data-file-preview-scroll]')
    await expect(code.locator('.shiki')).toBeVisible()
    const codePaints = []
    // Compare compiled Electron CSS at both endpoints, including sticky gutters.
    for (const endpoint of [
      { key: 'End', alpha: '1' },
      { key: 'Home', alpha: '0' },
    ]) {
      // Act
      await slider.press(endpoint.key)
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        endpoint.alpha,
      )
      codePaints.push(
        await code.evaluate((element) => {
          const lineNumber = element.querySelector('.line-number')
          if (!lineNumber) throw new Error('Missing highlighted line number')
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          // Resolve actual paint alpha; an inherited custom property alone is insufficient.
          const backgrounds = [element, lineNumber].map((node) => {
            const style = getComputedStyle(node)
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = style.backgroundColor
            context.fillRect(0, 0, 1, 1)
            return {
              color: style.backgroundColor,
              alpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
              opacity: style.opacity,
            }
          })
          const colors = Array.from(
            element.querySelectorAll('.shiki span'),
            (node) => getComputedStyle(node).color,
          )
          return { backgrounds, colors }
        }),
      )
    }
    // Assert: host/gutter remain solid and all syntax colors survive clear panes.
    expect(codePaints[0].backgrounds).toMatchObject([
      { alpha: 1, opacity: '1' },
      { alpha: 1, opacity: '1' },
    ])
    expect(codePaints[0].colors.length).toBeGreaterThan(0)
    expect(codePaints[1]).toEqual(codePaints[0])
    await appWindow
      .getByRole('radio', { name: 'Show rendered Markdown' })
      .click()
    const reading = appWindow.locator('[data-markdown-reading-scroll]')
    const markdownCodePaints = []
    // Reading code keeps its own opaque paint at both ends of the pane range.
    for (const endpoint of [
      { key: 'End', alpha: '1' },
      { key: 'Home', alpha: '0' },
    ]) {
      await slider.press(endpoint.key)
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        endpoint.alpha,
      )
      markdownCodePaints.push(
        await reading.locator('code').evaluateAll((elements) => {
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          return elements.map((element) => {
            const style = getComputedStyle(element)
            context.clearRect(0, 0, 1, 1)
            context.fillStyle = style.backgroundColor
            context.fillRect(0, 0, 1, 1)
            return {
              alpha: context.getImageData(0, 0, 1, 1).data[3] / 255,
              color: style.color,
              opacity: style.opacity,
            }
          })
        }),
      )
    }
    expect(markdownCodePaints[0]).toMatchObject([
      { alpha: 1, opacity: '1' },
      { alpha: 1, opacity: '1' },
    ])
    expect(markdownCodePaints[1]).toEqual(markdownCodePaints[0])
    // Act
    await slider.fill('45')
    await slider.dispatchEvent('pointerup')
    await expectSurface(
      appWindow.locator('[data-window-section="right"]'),
      '0.45',
    )
    const paints = await reading.evaluate((element) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      const backgrounds: number[] = []
      const opacities: string[] = []
      // Walk the real ancestors: two 45% fills would conceal 70% of the desktop.
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node)
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = style.backgroundColor
        context.fillRect(0, 0, 1, 1)
        const alpha = context.getImageData(0, 0, 1, 1).data[3] / 255
        if (alpha > 0) backgrounds.push(alpha)
        opacities.push(style.opacity)
      }
      return { backgrounds, opacities }
    })
    // Assert
    expect(paints.backgrounds).toHaveLength(1)
    expect(paints.backgrounds[0]).toBeCloseTo(0.45, 2)
    expect(new Set(paints.opacities)).toEqual(new Set(['1']))
    const text = reading.getByText('Readable through a transparent inspector.')
    const color = await text.evaluate((node) => getComputedStyle(node).color)
    // Act — Home reaches a clear background, while every foreground stays visible.
    await slider.press('Home')
    // Assert
    await expect(slider).toHaveValue('0')
    await expect(slider).toHaveAttribute('aria-valuetext', '0%')
    for (const side of ['left', 'center', 'right']) {
      await expectSurface(
        appWindow.locator(`[data-window-section="${side}"]`),
        '0',
      )
    }
    await expect(text).toHaveCSS('color', color)
    await expect(text).toHaveCSS('opacity', '1')
    const main = await electronApp.browserWindow(appWindow)
    expect(await main.evaluate((window) => window.getOpacity())).toBe(1)
  },
)

opacityTest(
  'migrates old settings on launch and paints only translucent backgrounds',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    // Arrange / Act
    const main = await electronApp.browserWindow(appWindow)
    const entire = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    // Assert
    await expect(entire).toHaveValue('72')
    await expect(entire).toHaveAttribute('aria-valuetext', '72%')
    await expect(entire).toHaveAttribute('min', '0')
    await expect(entire).toHaveAttribute('max', '100')
    expect(readSettingsFile(isolatedHome)).toMatchObject({
      windowBackgroundOpacityPercent: 72,
      windowOpacityMode: 'entire',
    })
    expect(readSettingsFile(isolatedHome)).not.toHaveProperty(
      'windowBackgroundBlurRadius',
    )
    await expect
      .poll(async () => main.evaluate((window) => window.getOpacity()))
      .toBe(1)
    for (const side of ['left', 'center', 'right']) {
      await expectSurface(
        appWindow.locator(`[data-window-section="${side}"]`),
        '0.72',
      )
    }
    await expect(settingsWindow.locator('.opaque-surface').first()).toHaveCSS(
      '--window-surface-opacity',
      '1',
    )
    expect(
      await (
        await electronApp.browserWindow(settingsWindow)
      ).evaluate((window) => window.getOpacity()),
    ).toBe(1)
  },
)

opacityTest(
  'saves completed gestures immediately and retains mode values and individual resets',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    // Arrange
    const entire = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    await entire.fill('92')
    await entire.press('ArrowRight')
    await expect(entire).toHaveValue('93')
    // Act
    await settingsWindow
      .getByRole('radio', { name: 'Section', exact: true })
      .click()
    const left = settingsWindow.getByRole('slider', { name: 'Left opacity' })
    await left.fill('85')
    await left.press('ArrowRight')
    const center = settingsWindow.getByRole('slider', {
      name: 'Center opacity',
    })
    await center.fill('90')
    await center.dispatchEvent('pointerup')
    const right = settingsWindow.getByRole('slider', { name: 'Right opacity' })
    await right.fill('95')
    await right.dispatchEvent('blur')
    // Assert
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({
        windowBackgroundOpacityPercent: 93,
        leftSectionOpacityPercent: 86,
        centerSectionOpacityPercent: 90,
        rightSectionOpacityPercent: 95,
      })
    await expectSurface(
      appWindow.locator('[data-window-section="left"]'),
      '0.86',
    )
    await expectSurface(
      appWindow.locator('[data-window-section="center"]'),
      '0.9',
    )
    await expectSurface(
      appWindow.locator('[data-window-section="right"]'),
      '0.95',
    )
    // Act — a section reset must not discard other mode values.
    await settingsWindow
      .getByRole('button', { name: 'Reset to default: Right opacity' })
      .click()
    await settingsWindow
      .getByRole('radio', { name: 'Entire', exact: true })
      .click()
    await expect(entire).toHaveValue('93')
    await expectSurface(
      appWindow.locator('[data-window-section="left"]'),
      '0.93',
    )
    await settingsWindow
      .getByRole('radio', { name: 'Section', exact: true })
      .click()
    // Assert
    await expect(left).toHaveValue('86')
    await expect(center).toHaveValue('90')
    await expect(right).toHaveValue('100')
    expect(
      await (
        await electronApp.browserWindow(appWindow)
      ).evaluate((window) => window.getOpacity()),
    ).toBe(1)
  },
)

opacityTest(
  'keeps completed keyboard edits through navigation, window closure and reopening',
  async ({ settingsWindow, appWindow, electronApp, isolatedHome }) => {
    // Arrange
    const slider = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    // Act — no debounce wait between the completed key gesture and navigation/close.
    await slider.press('End')
    await slider.press('ArrowLeft')
    await settingsWindow
      .getByRole('button', { name: 'General', exact: true })
      .click()
    await settingsWindow.close()
    // Assert
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({ windowBackgroundOpacityPercent: 99 })
    const opened = electronApp.waitForEvent('window')
    await appWindow.getByRole('button', { name: 'Open settings' }).click()
    const reopened = await opened
    await reopened
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    await expect(
      reopened.getByRole('slider', { name: 'Background opacity' }),
    ).toHaveValue('99')
  },
)

opacityTest(
  'saves without a main window and recreates it with native opacity one',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    opacityTest.skip(
      process.platform !== 'darwin',
      'macOS keeps the app alive after closing its main window',
    )
    // Arrange
    await appWindow.close()
    // Act
    const slider = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    await slider.press('End')
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({ windowBackgroundOpacityPercent: 100 })
    const opened = electronApp.waitForEvent('window')
    await electronApp.evaluate(({ app }) => app.emit('activate'))
    const recreated = await opened
    // Assert
    await expectSurface(recreated.locator('[data-window-section="left"]'), '1')
    expect(
      await (
        await electronApp.browserWindow(recreated)
      ).evaluate((window) => window.getOpacity()),
    ).toBe(1)
  },
)

opacityTest(
  'shows an actual Settings toast for disk failure and recovers on the next edit',
  async ({ settingsWindow, isolatedHome }) => {
    // Arrange — a directory at the temporary file path safely forces a real write failure.
    const temporaryPath = `${settingsFilePath(isolatedHome)}.tmp`
    mkdirSync(temporaryPath)
    const slider = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    // Act
    await slider.press('End')
    // Assert
    await expect(
      settingsWindow.getByText('Settings could not be saved', { exact: true }),
    ).toBeVisible()
    await expect(slider).toHaveValue('72')
    expect(readSettingsFile(isolatedHome)).toMatchObject({
      windowBackgroundOpacityPercent: 72,
    })
    // Act
    rmSync(temporaryPath, { recursive: true })
    await slider.press('End')
    // Assert
    await expect
      .poll(() => readSettingsFile(isolatedHome))
      .toMatchObject({ windowBackgroundOpacityPercent: 100 })
  },
)

opacityTest.describe('legacy Section settings', () => {
  opacityTest.use({
    initialSettings: {
      windowOpacityMode: 'section',
      windowBackgroundBlurRadius: 0,
      leftSectionOpacityPercent: 45,
      centerSectionOpacityPercent: 90,
      rightSectionOpacityPercent: 100,
    },
  })
  opacityTest(
    'preserves old section strengths, mode and the opaque Entire setting',
    async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
      // Arrange / Act
      const main = await electronApp.browserWindow(appWindow)
      // Assert
      await expect(
        settingsWindow.getByRole('radio', { name: 'Section' }),
      ).toBeChecked()
      await expectSurface(
        appWindow.locator('[data-window-section="left"]'),
        '0.45',
      )
      await expectSurface(
        appWindow.locator('[data-window-section="center"]'),
        '0.9',
      )
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        '1',
      )
      expect(readSettingsFile(isolatedHome)).toMatchObject({
        windowBackgroundOpacityPercent: 100,
        leftSectionOpacityPercent: 45,
        centerSectionOpacityPercent: 90,
        rightSectionOpacityPercent: 100,
      })
      expect(
        await main.evaluate((window) => ({
          opacity: window.getOpacity(),
          background: window.getBackgroundColor(),
        })),
      ).toEqual({ opacity: 1, background: '#000000' })
    },
  )
})

/** Checks pane-wide opacity independently from the registered background property after real IPC updates.
 * @returns Resolves once the renderer has applied the expected alpha.
 * @example await expectSurface(leftPane, '0.85')
 */
async function expectSurface(section: Locator, alpha: string): Promise<void> {
  await expect(section).toHaveCSS('opacity', '1')
  await expect(section).toHaveCSS('--window-surface-opacity', alpha)
}

opacityTest(
  'shows save failures in the main window and keeps its context menu opaque',
  async ({ appWindow, isolatedHome }) => {
    // Arrange
    const temporaryPath = `${settingsFilePath(isolatedHome)}.tmp`
    mkdirSync(temporaryPath)
    const agent = appWindow.getByRole('button', {
      name: /Filter skills by Claude Code/,
    })
    // Act
    await agent.click({ button: 'right' })
    // Assert
    await expect(appWindow.getByRole('menu')).toHaveCSS(
      '--window-surface-opacity',
      '1',
    )
    // Act
    await appWindow.getByRole('menuitem', { name: 'Hide from sidebar' }).click()
    // Assert
    await expect(
      appWindow.getByText('Settings could not be saved', { exact: true }),
    ).toBeVisible()
    await expect(agent).toBeVisible()
    expect(readSettingsFile(isolatedHome)).toMatchObject({ hiddenAgentIds: [] })
    rmSync(temporaryPath, { recursive: true })
  },
)

opacityTest(
  'keeps rapid edits and both windows consistent through slow or failed saves',
  async ({ appWindow, settingsWindow, electronApp, isolatedHome }) => {
    // Arrange — hold the debounce clock and real disk renames independently.
    const slider = settingsWindow.getByRole('slider', {
      name: 'Background opacity',
    })
    await expect(slider).toHaveValue('72')
    await settingsWindow.clock.install({
      time: new Date('2026-09-07T00:00:00Z'),
    })
    await settingsWindow.clock.pauseAt(new Date('2026-09-07T00:00:01Z'))
    const delayedWrite = await electronApp.evaluateHandle(
      (_electron, filePath) => {
        const fileSystem = process.getBuiltinModule('fs').promises
        const originalRename = fileSystem.rename
        const pendingWrites: Array<{
          resolve: () => void
          reject: (error: Error) => void
        }> = []
        fileSystem.rename = async (...args) => {
          // Delay only this isolated profile, preserving every unrelated filesystem operation.
          if (args[1] === filePath) {
            await new Promise<void>((resolve, reject) =>
              pendingWrites.push({ resolve, reject }),
            )
          }
          await originalRename(...args)
        }
        return {
          hasPending: () => pendingWrites.length > 0,
          settleNext: (fail: boolean) => {
            const pending = pendingWrites.shift()
            // Reject before rename so the previously durable JSON stays intact.
            if (fail) {
              pending?.reject(new Error('Simulated settings rename failure'))
            } else {
              pending?.resolve()
            }
          },
          restore: () => {
            fileSystem.rename = originalRename
            for (const pending of pendingWrites.splice(0)) pending.resolve()
          },
        }
      },
      settingsFilePath(isolatedHome),
    )
    /** Settles one real queued save when this regression chooses its acknowledgement or disk failure.
     * @returns Resolves after releasing or rejecting the oldest paused rename.
     * @example await settleNextSave('save') // The next queued preference becomes durable.
     */
    const settleNextSave = async (outcome: 'save' | 'fail'): Promise<void> => {
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      await delayedWrite.evaluate(
        (write, fail) => write.settleNext(fail),
        outcome === 'fail',
      )
    }
    const settingsNativeWindow = await electronApp.browserWindow(settingsWindow)
    const delayedSelfNotification = await settingsNativeWindow.evaluateHandle(
      (window) => {
        const originalSend = window.webContents.send.bind(window.webContents)
        let pauseNext = false
        let pending: (() => void) | undefined
        window.webContents.send = (channel: string, ...args: unknown[]) => {
          // Delay delivery after main already decided this was the sender's latest request.
          if (channel === 'settings:changed' && pauseNext) {
            pauseNext = false
            pending = () => originalSend(channel, ...args)
            return
          }
          originalSend(channel, ...args)
        }
        return {
          pauseNext: () => {
            pauseNext = true
          },
          hasPending: () => Boolean(pending),
          release: () => {
            const send = pending
            pending = undefined
            send?.()
          },
          restore: () => {
            window.webContents.send = originalSend
            pending?.()
          },
        }
      },
    )

    try {
      // Act — finish two gestures while disk is slow, then begin the newest draft.
      await slider.fill('85')
      await slider.dispatchEvent('pointerup')
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      await slider.fill('90')
      await slider.dispatchEvent('pointerup')
      await slider.fill('95')
      await settleNextSave('save')
      await settleNextSave('save')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({
          windowBackgroundOpacityPercent: 90,
        })
      // Clock control is shared by both windows; read the target before advancing its transition.
      await expect
        .poll(async () =>
          appWindow
            .locator('[data-window-section="right"]')
            .evaluate((element) =>
              element.style.getPropertyValue('--window-surface-opacity'),
            ),
        )
        .toBe('0.9')

      // Assert — acknowledgements for 85 and 90 must not replace the unfinished 95 draft.
      await expect(slider).toHaveValue('95')
      // Act
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      // Assert — the completed newest gesture reaches disk and the other window.
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({
          windowBackgroundOpacityPercent: 95,
        })
      await settingsWindow.clock.runFor(200)
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        '0.95',
      )

      // Act — an already-sent acknowledgement arrives after a newer request and draft.
      await delayedSelfNotification.evaluate((notification) =>
        notification.pauseNext(),
      )
      await slider.fill('85')
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      await expect
        .poll(async () =>
          delayedSelfNotification.evaluate((notification) =>
            notification.hasPending(),
          ),
        )
        .toBe(true)
      await slider.fill('90')
      await slider.dispatchEvent('pointerup')
      await slider.fill('95')
      await delayedSelfNotification.evaluate((notification) =>
        notification.release(),
      )
      // A same-renderer round trip drains the delayed notification before asserting its draft.
      await settingsWindow.evaluate(async () => window.electron.settings.get())
      await expect(slider).toHaveValue('95')
      await settleNextSave('save')
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({
          windowBackgroundOpacityPercent: 95,
        })

      // Act — a genuinely external change still cancels an unfinished local draft.
      await slider.fill('96')
      const externalSave = appWindow.evaluate(async () =>
        window.electron.settings.set({ windowBackgroundOpacityPercent: 85 }),
      )
      await settleNextSave('save')
      await externalSave
      await expect(slider).toHaveValue('85')
      await slider.dispatchEvent('pointerup')
      await settingsWindow.clock.runFor(200)
      // Assert
      expect(readSettingsFile(isolatedHome)).toMatchObject({
        windowBackgroundOpacityPercent: 85,
      })

      // Act — the other window starts first, then this window queues its own newer edit.
      const earlierExternalSave = appWindow.evaluate(async () =>
        window.electron.settings.set({ windowBackgroundOpacityPercent: 90 }),
      )
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      await slider.fill('95')
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      await earlierExternalSave
      await expect(slider).toHaveValue('90')
      await settleNextSave('save')
      // Assert — the latest own broadcast restores convergence after the other window's update.
      await expect(slider).toHaveValue('95')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({ windowBackgroundOpacityPercent: 95 })
      await settingsWindow.clock.runFor(200)
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        '0.95',
      )

      // Arrange — an unrelated external save can replace the optimistic snapshot before a failure.
      await slider.fill('100')
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({ windowBackgroundOpacityPercent: 100 })
      const unrelatedExternalSave = appWindow.evaluate(async () =>
        window.electron.settings.set({ defaultSkillTab: 'info' }),
      )
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      // Act — the external write succeeds, 85 succeeds silently, and the latest 90 save fails.
      await slider.fill('85')
      await slider.dispatchEvent('pointerup')
      await slider.fill('90')
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      await unrelatedExternalSave
      await expect(slider).toHaveValue('100')
      await settleNextSave('save')
      await settleNextSave('fail')
      // Assert — failure recovery adopts durable 85 even after the external snapshot displaced 90.
      await expect(slider).toHaveValue('85')
      // Sonner schedules its visible toast on a timer; advance it after canonical recovery.
      await settingsWindow.clock.runFor(200)
      await expect(
        settingsWindow.getByText('Settings could not be saved', {
          exact: true,
        }),
      ).toBeVisible()
      expect(readSettingsFile(isolatedHome)).toMatchObject({
        windowBackgroundOpacityPercent: 85,
        defaultSkillTab: 'info',
      })
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        '0.85',
      )

      // Act — an older failed save must not reset an already newer local request or draft.
      await slider.fill('90')
      await slider.dispatchEvent('pointerup')
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      await slider.fill('95')
      await slider.dispatchEvent('pointerup')
      await slider.fill('96')
      await settleNextSave('fail')
      await expect
        .poll(async () => delayedWrite.evaluate((write) => write.hasPending()))
        .toBe(true)
      // A same-renderer IPC round trip observes the prior failure notification before checking its draft.
      expect(
        await settingsWindow.evaluate(async () =>
          window.electron.settings.get(),
        ),
      ).toMatchObject({ windowBackgroundOpacityPercent: 85 })
      // Assert
      await expect(slider).toHaveValue('96')
      // Act
      await settleNextSave('save')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({ windowBackgroundOpacityPercent: 95 })
      await slider.dispatchEvent('pointerup')
      await settleNextSave('save')
      // Assert — the new draft remains saveable after the earlier failure.
      await expect(slider).toHaveValue('96')
      await expect
        .poll(() => readSettingsFile(isolatedHome))
        .toMatchObject({ windowBackgroundOpacityPercent: 96 })
      await settingsWindow.clock.runFor(200)
      await expectSurface(
        appWindow.locator('[data-window-section="right"]'),
        '0.96',
      )
    } finally {
      await delayedSelfNotification.evaluate((notification) =>
        notification.restore(),
      )
      await delayedSelfNotification.dispose()
      await delayedWrite.evaluate((write) => write.restore())
      await delayedWrite.dispose()
      await settingsWindow.clock.resume()
    }
  },
)

opacityTest(
  'keeps the native canvas clear when overlapping edits restore full background opacity',
  async ({ appWindow, electronApp }) => {
    // Arrange
    await appWindow.evaluate(async () =>
      window.electron.settings.set({ windowBackgroundOpacityPercent: 100 }),
    )
    // Act — both handlers can observe 100 before the serialized disk writes finish.
    await appWindow.evaluate(async () =>
      Promise.all([
        window.electron.settings.set({ windowBackgroundOpacityPercent: 85 }),
        window.electron.settings.set({ windowBackgroundOpacityPercent: 100 }),
      ]),
    )
    // Assert
    const main = await electronApp.browserWindow(appWindow)
    await expect
      .poll(async () =>
        main.evaluate((window) => ({
          opacity: window.getOpacity(),
          background: window.getBackgroundColor(),
        })),
      )
      .toEqual({ opacity: 1, background: '#000000' })
    await expectSurface(appWindow.locator('[data-window-section="left"]'), '1')
  },
)
