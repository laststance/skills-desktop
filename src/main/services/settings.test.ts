import { mkdtempSync, realpathSync, promises as fs } from 'fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'
import { toPixelHeight, toPixelWidth } from '@/shared/types'

import type * as SettingsModule from './settings'
import { areSettingsEqual } from './settings'

// Mutable userData dir handed to `app.getPath('userData')`. Each disk test
// points it at a fresh tmpdir so reads/writes never collide and the real
// fs read/write/rename/mkdir paths in settings.ts are exercised end-to-end.
const electronUserData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected getPath(${name})`)
      }
      return electronUserData.dir
    },
  },
}))

/**
 * Re-imports settings.ts with its module-level `cache` reset to `null` so a
 * test that relies on "never loaded yet" or "loaded once" state starts clean.
 * @returns Fresh settings module exports.
 * @example
 * const { getSettings } = await importFreshSettings()
 */
async function importFreshSettings(): Promise<typeof SettingsModule> {
  vi.resetModules()
  return import('./settings')
}

/**
 * Unit tests for the `areSettingsEqual` no-op guard. The motivation is
 * that Zod's `SettingsSchema.parse` always returns a fresh object — so a
 * naive `===` comparison on `windowSize` would always say "changed",
 * causing `saveSettings` to write `settings.json` and broadcast
 * `settings:changed` on every "Use current window size" click even when
 * the saved dimensions are identical.
 */
describe('areSettingsEqual', () => {
  const baseSettings: Settings = DEFAULT_SETTINGS

  test('treats two settings with identical primitive fields as unchanged so no redundant save fires', () => {
    // Arrange
    const saved = baseSettings
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('detects a changed primitive field so the new value gets persisted', () => {
    // Arrange
    const saved = baseSettings
    const incoming: Settings = { ...baseSettings, defaultSkillTab: 'info' }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  test('treats two settings with no window size on either side as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: undefined }
    const incoming = { ...baseSettings, windowSize: undefined }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('treats matching window dimensions as unchanged even when Zod produced a fresh object reference', () => {
    // Arrange: Zod parse produces a fresh object on every call, so the
    // references differ even when the width/height values match.
    const saved = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }
    const incoming = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('detects a changed window width so the resized dimensions get persisted', () => {
    // Arrange
    const saved = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }
    const incoming = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1201), height: toPixelHeight(800) },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  test('detects a changed window height so the resized dimensions get persisted', () => {
    // Arrange
    const saved = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }
    const incoming = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(801) },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  test('detects a change when one side has a window size and the other has none, in either direction', () => {
    // Arrange
    const withSize = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }
    const withoutSize = { ...baseSettings, windowSize: undefined }

    // Act
    const sizeThenNone = areSettingsEqual(withSize, withoutSize)
    const noneThenSize = areSettingsEqual(withoutSize, withSize)

    // Assert
    expect(sizeThenNone).toBe(false)
    expect(noneThenSize).toBe(false)
  })

  test('detects a change when the windowSize key exists on only one side, not falsely matching', () => {
    // Arrange: the asymmetric-shape bug — `Object.keys(a)` alone would skip
    // a key that lives only on `b`, so an absent-vs-defined comparison would
    // wrongly return `true`. Iterating the union of both keys surfaces it.
    const withoutKey = { ...baseSettings }
    const withKey = {
      ...baseSettings,
      windowSize: { width: toPixelWidth(1200), height: toPixelHeight(800) },
    }

    // Act
    const missingThenPresent = areSettingsEqual(withoutKey, withKey)
    const presentThenMissing = areSettingsEqual(withKey, withoutKey)

    // Assert
    expect(missingThenPresent).toBe(false)
    expect(presentThenMissing).toBe(false)
  })

  test('treats two settings that both omit window size as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings }
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('treats identical hidden-agent lists in the same order as unchanged', () => {
    // Arrange
    const saved: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('treats hidden-agent lists with the same members in different order as unchanged (set semantics)', () => {
    // Arrange: renderer treats hiddenAgentIds as a set; equality must match
    // that semantic so an order-only drift between disk and renderer doesn't
    // trigger a redundant atomic write + settings:changed broadcast.
    const saved: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['cursor', 'claude-code'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  test('detects a change when the hidden-agent list gains or loses an entry', () => {
    // Arrange
    const saved: Settings = { ...baseSettings, hiddenAgentIds: ['claude-code'] }
    const incoming: Settings = {
      ...baseSettings,
      hiddenAgentIds: ['claude-code', 'cursor'],
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  test('detects a change when the hidden-agent list swaps a member for a different one', () => {
    // Arrange
    const saved: Settings = { ...baseSettings, hiddenAgentIds: ['claude-code'] }
    const incoming: Settings = { ...baseSettings, hiddenAgentIds: ['cursor'] }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })
})

/**
 * Disk-backed tests for loadSettings/getSettings/saveSettings. They run
 * against a real tmpdir aliased to `app.getPath('userData')` so the actual
 * read → JSON.parse → Zod validate → atomic write → rename pipeline is
 * exercised, not a mock of it.
 */
describe('settings persistence', () => {
  let userDataDir: string

  beforeEach(() => {
    // Arrange a clean userData dir for each test, then point the mocked
    // electron app at it.
    userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'settings-svc-')))
    electronUserData.dir = userDataDir
  })

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true })
  })

  afterAll(() => {
    vi.clearAllMocks()
  })

  describe('loadSettings', () => {
    test('returns the validated on-disk settings when settings.json exists and is valid', async () => {
      // Arrange
      const { loadSettings } = await importFreshSettings()
      await writeFile(
        join(userDataDir, 'settings.json'),
        JSON.stringify({
          defaultSkillTab: 'info',
          preferredTerminal: 'terminal',
          windowBackgroundOpacityPercent: 100,
          installedSearchCountDisplay: 'tab',
          hiddenAgentIds: ['cursor'],
          autoDownloadUpdates: true,
        }),
        'utf8',
      )

      // Act
      const loaded = await loadSettings()

      // Assert — the newer appearance fields are absent from this
      // legacy on-disk file, so the schema backfills their defaults.
      expect(loaded).toEqual({
        defaultSkillTab: 'info',
        preferredTerminal: 'terminal',
        windowBackgroundOpacityPercent: 100,
        windowOpacityMode: 'entire',
        leftSectionOpacityPercent: 100,
        centerSectionOpacityPercent: 100,
        rightSectionOpacityPercent: 100,
        markdownFontSizePx: 14,
        codeFontSizePx: 13,
        codeThemeId: 'github',
        installedSearchCountDisplay: 'tab',
        hiddenAgentIds: ['cursor'],
        autoDownloadUpdates: true,
      })
    })

    test('caches the loaded settings so a later getSettings returns the disk values without re-reading', async () => {
      // Arrange
      const { loadSettings, getSettings } = await importFreshSettings()
      await writeFile(
        join(userDataDir, 'settings.json'),
        JSON.stringify({ defaultSkillTab: 'info' }),
        'utf8',
      )
      await loadSettings()

      // Act
      const snapshot = getSettings()

      // Assert
      expect(snapshot.defaultSkillTab).toBe('info')
    })

    test('falls back to defaults silently on first launch when settings.json is absent', async () => {
      // Arrange: a fresh userData dir with no settings.json — the ENOENT path
      // must NOT log a warning because a missing file is expected on boot.
      const { loadSettings } = await importFreshSettings()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Act
      const loaded = await loadSettings()

      // Assert
      expect(loaded).toEqual(DEFAULT_SETTINGS)
      expect(warnSpy).not.toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    test('falls back to defaults and warns when settings.json holds malformed JSON', async () => {
      // Arrange: a syntactically broken file triggers a non-ENOENT error,
      // which must be logged so a corrupt file is visible in the dev console.
      const { loadSettings } = await importFreshSettings()
      await writeFile(join(userDataDir, 'settings.json'), '{ not json', 'utf8')
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Act
      const loaded = await loadSettings()

      // Assert
      expect(loaded).toEqual(DEFAULT_SETTINGS)
      expect(warnSpy).toHaveBeenCalledWith(
        '[settings] failed to load, using defaults:',
        expect.anything(),
      )
      warnSpy.mockRestore()
    })
  })

  describe('background opacity migration', () => {
    test.each([
      { radius: 0, percent: 100 },
      { radius: 7, percent: 92 },
      { radius: 24, percent: 72 },
      { radius: 48, percent: 45 },
    ])(
      'migrates legacy radius $radius to $percent% without resetting other preferences',
      async ({ radius, percent }) => {
        // Arrange
        const { loadSettings } = await importFreshSettings()
        await writeFile(
          join(userDataDir, 'settings.json'),
          JSON.stringify({
            windowBackgroundBlurRadius: radius,
            windowOpacityMode: 'section',
            leftSectionOpacityPercent: 45,
            centerSectionOpacityPercent: 90,
            rightSectionOpacityPercent: 100,
            defaultSkillTab: 'info',
            preferredTerminal: 'warp',
            markdownFontSizePx: 18,
            hiddenAgentIds: ['cursor'],
          }),
        )
        // Act
        const settings = await loadSettings()
        // Assert
        expect(settings).toMatchObject({
          windowBackgroundOpacityPercent: percent,
          windowOpacityMode: 'section',
          leftSectionOpacityPercent: 45,
          centerSectionOpacityPercent: 90,
          rightSectionOpacityPercent: 100,
          defaultSkillTab: 'info',
          preferredTerminal: 'warp',
          markdownFontSizePx: 18,
          hiddenAgentIds: ['cursor'],
        })
        const saved = JSON.parse(
          await readFile(join(userDataDir, 'settings.json'), 'utf8'),
        )
        expect(saved.windowBackgroundOpacityPercent).toBe(percent)
        expect(saved.windowBackgroundBlurRadius).toBeUndefined()
        expect(saved.leftSectionOpacityPercent).toBe(45)
      },
    )

    test('writes the migration marker even when an old profile has only default values, then leaves it unchanged on restart', async () => {
      // Arrange
      const file = join(userDataDir, 'settings.json')
      await writeFile(file, '{}')
      const first = await importFreshSettings()
      // Act
      await first.loadSettings()
      const migrated = await readFile(file, 'utf8')
      const writeSpy = vi.spyOn(fs, 'writeFile')
      const restarted = await importFreshSettings()
      await restarted.loadSettings()
      // Assert
      expect(JSON.parse(migrated).windowBackgroundOpacityPercent).toBe(100)
      expect(await readFile(file, 'utf8')).toBe(migrated)
      expect(writeSpy).not.toHaveBeenCalled()
      writeSpy.mockRestore()
    })

    test('prefers a modern percentage over a leftover legacy radius without rewriting the profile', async () => {
      // Arrange
      const file = join(userDataDir, 'settings.json')
      const original = JSON.stringify({
        windowBackgroundOpacityPercent: 97,
        windowBackgroundBlurRadius: 48,
        defaultSkillTab: 'info',
      })
      await writeFile(file, original)
      const { loadSettings } = await importFreshSettings()
      // Act
      const settings = await loadSettings()
      // Assert
      expect(settings.windowBackgroundOpacityPercent).toBe(97)
      expect(settings.defaultSkillTab).toBe('info')
      expect(await readFile(file, 'utf8')).toBe(original)
    })

    test.each(['writeFile', 'rename'] as const)(
      'preserves the original file and preferences after migration %s fails, then retries even an unchanged save',
      async (operation) => {
        // Arrange
        const file = join(userDataDir, 'settings.json')
        const original = JSON.stringify({
          windowBackgroundBlurRadius: 48,
          leftSectionOpacityPercent: 45,
          preferredTerminal: 'warp',
        })
        await writeFile(file, original)
        const { loadSettings, getSettings, saveSettings } =
          await importFreshSettings()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const failure = vi
          .spyOn(fs, operation)
          .mockRejectedValueOnce(new Error('disk unavailable'))
        // Act
        const loaded = await loadSettings()
        // Assert — valid preferences survive a failed write; the old file remains restart-safe.
        expect(loaded).toMatchObject({
          windowBackgroundOpacityPercent: 45,
          leftSectionOpacityPercent: 45,
          preferredTerminal: 'warp',
        })
        expect(getSettings()).toBe(loaded)
        expect(await readFile(file, 'utf8')).toBe(original)
        expect(warn).toHaveBeenCalledOnce()
        // Act — an empty patch must still retry the unsaved migration.
        await saveSettings({})
        // Assert
        expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
          windowBackgroundOpacityPercent: 45,
          preferredTerminal: 'warp',
        })
        failure.mockRestore()
        warn.mockRestore()
      },
    )

    test('merges a slider edit after the startup migration rather than overwriting it with an older snapshot', async () => {
      // Arrange
      const file = join(userDataDir, 'settings.json')
      await writeFile(
        file,
        JSON.stringify({
          windowBackgroundBlurRadius: 24,
          leftSectionOpacityPercent: 45,
          preferredTerminal: 'warp',
        }),
      )
      const { loadSettings, saveSettings } = await importFreshSettings()
      let markStarted!: () => void
      let releaseRename!: () => void
      const started = new Promise<void>((resolve) => {
        markStarted = resolve
      })
      const release = new Promise<void>((resolve) => {
        releaseRename = resolve
      })
      const rename = fs.rename
      const delayedRename = vi
        .spyOn(fs, 'rename')
        .mockImplementationOnce(async (...args) => {
          markStarted()
          await release
          return rename(...args)
        })
      // Act
      const startup = loadSettings()
      await started
      const edit = saveSettings({ rightSectionOpacityPercent: 90 })
      releaseRename()
      await Promise.all([startup, edit])
      // Assert
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
        windowBackgroundOpacityPercent: 72,
        leftSectionOpacityPercent: 45,
        rightSectionOpacityPercent: 90,
        preferredTerminal: 'warp',
      })
      delayedRename.mockRestore()
    })

    test.each([
      { windowBackgroundBlurRadius: -1 },
      { windowBackgroundBlurRadius: 49 },
      { windowBackgroundBlurRadius: 12.5 },
      { windowBackgroundBlurRadius: '24' },
      { leftSectionOpacityPercent: 44 },
      { windowBackgroundOpacityPercent: -1 },
      null,
    ])(
      'does not rewrite an invalid stored opacity value: %j',
      async (invalid) => {
        // Arrange
        const file = join(userDataDir, 'settings.json')
        const original = JSON.stringify(invalid)
        await writeFile(file, original)
        const { loadSettings } = await importFreshSettings()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        // Act
        const loaded = await loadSettings()
        // Assert
        expect(loaded.windowBackgroundOpacityPercent).toBe(100)
        expect(await readFile(file, 'utf8')).toBe(original)
        expect(warn).toHaveBeenCalledOnce()
        warn.mockRestore()
      },
    )

    test('retains the last saved cache after a normal write fails and accepts the next valid edit', async () => {
      // Arrange
      const { saveSettings, getSettings } = await importFreshSettings()
      await saveSettings({ leftSectionOpacityPercent: 85 })
      const failedWrite = vi
        .spyOn(fs, 'writeFile')
        .mockRejectedValueOnce(new Error('disk full'))
      // Act / Assert
      await expect(
        saveSettings({ leftSectionOpacityPercent: 90 }),
      ).rejects.toThrow('disk full')
      expect(getSettings().leftSectionOpacityPercent).toBe(85)
      await saveSettings({ rightSectionOpacityPercent: 95 })
      expect(getSettings()).toMatchObject({
        leftSectionOpacityPercent: 85,
        rightSectionOpacityPercent: 95,
      })
      failedWrite.mockRestore()
    })
  })

  describe('getSettings', () => {
    test('returns the defaults when loadSettings has never run so IPC handlers can read without awaiting', async () => {
      // Arrange: a freshly imported module has a null cache.
      const { getSettings } = await importFreshSettings()

      // Act
      const snapshot = getSettings()

      // Assert
      expect(snapshot).toEqual(DEFAULT_SETTINGS)
    })

    test('returns the already-cached snapshot on repeated calls without re-seeding defaults', async () => {
      // Arrange
      const { getSettings } = await importFreshSettings()
      const first = getSettings()

      // Act
      const second = getSettings()

      // Assert: same cached reference, proving the null-cache branch ran once.
      expect(second).toBe(first)
    })
  })

  describe('saveSettings', () => {
    test('keeps every section opacity when multiple sliders save concurrently', async () => {
      // Arrange
      const { saveSettings, getSettings } = await importFreshSettings()

      // Act — overlap the independent slider commits before any file write finishes.
      const results = await Promise.allSettled([
        saveSettings({ leftSectionOpacityPercent: 85 }),
        saveSettings({ centerSectionOpacityPercent: 90 }),
        saveSettings({ rightSectionOpacityPercent: 95 }),
      ])

      // Assert — both the cache and the persisted file retain all three changes.
      expect(results.map((result) => result.status)).toEqual([
        'fulfilled',
        'fulfilled',
        'fulfilled',
      ])
      expect(getSettings()).toMatchObject({
        leftSectionOpacityPercent: 85,
        centerSectionOpacityPercent: 90,
        rightSectionOpacityPercent: 95,
      })
      expect(
        JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8')),
      ).toMatchObject({
        leftSectionOpacityPercent: 85,
        centerSectionOpacityPercent: 90,
        rightSectionOpacityPercent: 95,
      })
    })

    test('keeps a reset made while the previous opacity change is still being saved', async () => {
      // Arrange
      const { saveSettings, getSettings } = await importFreshSettings()

      // Act — the reset matches the old cache but must follow the pending change.
      await Promise.all([
        saveSettings({ leftSectionOpacityPercent: 85 }),
        saveSettings({ leftSectionOpacityPercent: 100 }),
      ])

      // Assert
      expect(getSettings().leftSectionOpacityPercent).toBe(100)
      expect(
        JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8'))
          .leftSectionOpacityPercent,
      ).toBe(100)
    })

    test('continues saving valid settings after a queued update fails validation', async () => {
      // Arrange
      const { saveSettings, getSettings } = await importFreshSettings()

      // Act
      const results = await Promise.allSettled([
        saveSettings({ leftSectionOpacityPercent: -1 }),
        saveSettings({ rightSectionOpacityPercent: 90 }),
      ])

      // Assert — one rejected patch cannot prevent later preferences from saving.
      expect(results[0]?.status).toBe('rejected')
      expect(results[1]?.status).toBe('fulfilled')
      expect(getSettings()).toMatchObject({
        leftSectionOpacityPercent: 100,
        rightSectionOpacityPercent: 90,
      })
      expect(
        JSON.parse(await readFile(join(userDataDir, 'settings.json'), 'utf8'))
          .rightSectionOpacityPercent,
      ).toBe(90)
    })

    test('writes the merged settings to disk and returns the new full settings object', async () => {
      // Arrange
      const { saveSettings } = await importFreshSettings()

      // Act
      const saved = await saveSettings({ defaultSkillTab: 'info' })

      // Assert
      expect(saved.defaultSkillTab).toBe('info')
      const onDisk = JSON.parse(
        await readFile(join(userDataDir, 'settings.json'), 'utf8'),
      )
      expect(onDisk.defaultSkillTab).toBe('info')
    })

    test('creates the userData directory on a fresh profile before writing settings.json', async () => {
      // Arrange: point at a not-yet-created nested userData dir so the
      // mkdir(recursive) guard is the only thing that lets the write succeed.
      const nestedUserData = join(userDataDir, 'fresh', 'profile')
      electronUserData.dir = nestedUserData
      const { saveSettings } = await importFreshSettings()

      // Act
      const saved = await saveSettings({ preferredTerminal: 'iterm' })

      // Assert
      expect(saved.preferredTerminal).toBe('iterm')
      const onDisk = JSON.parse(
        await readFile(join(nestedUserData, 'settings.json'), 'utf8'),
      )
      expect(onDisk.preferredTerminal).toBe('iterm')
    })

    test('short-circuits without writing settings.json when the patch changes nothing', async () => {
      // Arrange: an empty patch merges to the current defaults, so the no-op
      // guard must return the existing settings before any disk write.
      const { saveSettings } = await importFreshSettings()

      // Act
      const saved = await saveSettings({})

      // Assert
      expect(saved).toEqual(DEFAULT_SETTINGS)
      await expect(
        readFile(join(userDataDir, 'settings.json'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    test('rejects the whole call when the merged settings fail Zod validation', async () => {
      // Arrange: a window width below the 400px floor is schema-invalid.
      const { saveSettings } = await importFreshSettings()

      // Act / Assert
      await expect(
        saveSettings({
          windowSize: { width: toPixelWidth(10), height: toPixelHeight(800) },
        }),
      ).rejects.toThrow()
    })
  })
})
