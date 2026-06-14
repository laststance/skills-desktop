import { mkdtempSync, realpathSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { DEFAULT_SETTINGS, type Settings } from '@/shared/settings'

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

  it('treats two settings with identical primitive fields as unchanged so no redundant save fires', () => {
    // Arrange
    const saved = baseSettings
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('detects a changed primitive field so the new value gets persisted', () => {
    // Arrange
    const saved = baseSettings
    const incoming: Settings = { ...baseSettings, defaultSkillTab: 'info' }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('treats two settings with no window size on either side as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: undefined }
    const incoming = { ...baseSettings, windowSize: undefined }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('treats matching window dimensions as unchanged even when Zod produced a fresh object reference', () => {
    // Arrange: Zod parse produces a fresh object on every call, so the
    // references differ even when the width/height values match.
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('detects a changed window width so the resized dimensions get persisted', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1201, height: 800 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('detects a changed window height so the resized dimensions get persisted', () => {
    // Arrange
    const saved = { ...baseSettings, windowSize: { width: 1200, height: 800 } }
    const incoming = {
      ...baseSettings,
      windowSize: { width: 1200, height: 801 },
    }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(false)
  })

  it('detects a change when one side has a window size and the other has none, in either direction', () => {
    // Arrange
    const withSize = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }
    const withoutSize = { ...baseSettings, windowSize: undefined }

    // Act
    const sizeThenNone = areSettingsEqual(withSize, withoutSize)
    const noneThenSize = areSettingsEqual(withoutSize, withSize)

    // Assert
    expect(sizeThenNone).toBe(false)
    expect(noneThenSize).toBe(false)
  })

  it('detects a change when the windowSize key exists on only one side, not falsely matching', () => {
    // Arrange: the asymmetric-shape bug — `Object.keys(a)` alone would skip
    // a key that lives only on `b`, so an absent-vs-defined comparison would
    // wrongly return `true`. Iterating the union of both keys surfaces it.
    const withoutKey = { ...baseSettings }
    const withKey = {
      ...baseSettings,
      windowSize: { width: 1200, height: 800 },
    }

    // Act
    const missingThenPresent = areSettingsEqual(withoutKey, withKey)
    const presentThenMissing = areSettingsEqual(withKey, withoutKey)

    // Assert
    expect(missingThenPresent).toBe(false)
    expect(presentThenMissing).toBe(false)
  })

  it('treats two settings that both omit window size as unchanged', () => {
    // Arrange
    const saved = { ...baseSettings }
    const incoming = { ...baseSettings }

    // Act
    const result = areSettingsEqual(saved, incoming)

    // Assert
    expect(result).toBe(true)
  })

  it('treats identical hidden-agent lists in the same order as unchanged', () => {
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

  it('treats hidden-agent lists with the same members in different order as unchanged (set semantics)', () => {
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

  it('detects a change when the hidden-agent list gains or loses an entry', () => {
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

  it('detects a change when the hidden-agent list swaps a member for a different one', () => {
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
    it('returns the validated on-disk settings when settings.json exists and is valid', async () => {
      // Arrange
      const { loadSettings } = await importFreshSettings()
      await writeFile(
        join(userDataDir, 'settings.json'),
        JSON.stringify({
          defaultSkillTab: 'info',
          preferredTerminal: 'terminal',
          windowBackgroundBlurRadius: 0,
          installedSearchCountDisplay: 'tab',
          hiddenAgentIds: ['cursor'],
          autoDownloadUpdates: true,
        }),
        'utf8',
      )

      // Act
      const loaded = await loadSettings()

      // Assert — the three preview-typography fields are absent from this
      // legacy on-disk file, so the schema backfills their defaults.
      expect(loaded).toEqual({
        defaultSkillTab: 'info',
        preferredTerminal: 'terminal',
        windowBackgroundBlurRadius: 0,
        markdownFontSizePx: 14,
        codeFontSizePx: 13,
        codeThemeId: 'github',
        installedSearchCountDisplay: 'tab',
        hiddenAgentIds: ['cursor'],
        autoDownloadUpdates: true,
      })
    })

    it('caches the loaded settings so a later getSettings returns the disk values without re-reading', async () => {
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

    it('falls back to defaults silently on first launch when settings.json is absent', async () => {
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

    it('falls back to defaults and warns when settings.json holds malformed JSON', async () => {
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

  describe('getSettings', () => {
    it('returns the defaults when loadSettings has never run so IPC handlers can read without awaiting', async () => {
      // Arrange: a freshly imported module has a null cache.
      const { getSettings } = await importFreshSettings()

      // Act
      const snapshot = getSettings()

      // Assert
      expect(snapshot).toEqual(DEFAULT_SETTINGS)
    })

    it('returns the already-cached snapshot on repeated calls without re-seeding defaults', async () => {
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
    it('writes the merged settings to disk and returns the new full settings object', async () => {
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

    it('creates the userData directory on a fresh profile before writing settings.json', async () => {
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

    it('short-circuits without writing settings.json when the patch changes nothing', async () => {
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

    it('rejects the whole call when the merged settings fail Zod validation', async () => {
      // Arrange: a window width below the 400px floor is schema-invalid.
      const { saveSettings } = await importFreshSettings()

      // Act / Assert
      await expect(
        saveSettings({ windowSize: { width: 10, height: 800 } }),
      ).rejects.toThrow()
    })
  })
})
