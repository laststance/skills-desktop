import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Dirent } from 'fs'
import * as fs from 'fs/promises'
import * as os from 'os'

vi.mock('fs/promises')
vi.mock('os')

const mockFs = vi.mocked(fs)
const mockOs = vi.mocked(os)

async function getSandboxManager() {
  vi.resetModules()
  return import('./sandboxManager')
}

describe('sandboxManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOs.homedir.mockReturnValue('/Users/test')
  })

  describe('createSandbox', () => {
    it('creates directory and writes CLAUDE.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)

      const { createSandbox } = await getSandboxManager()
      const result = await createSandbox({ skillName: 'task' })

      expect(result.path).toMatch(/^\/Users\/test\/skills-desktop-sandbox\//)
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('skills-desktop-sandbox'),
        { recursive: true },
      )
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('task'),
        'utf-8',
      )
    })

    it('creates sandbox without skill name', async () => {
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)

      const { createSandbox } = await getSandboxManager()
      const result = await createSandbox({ skillName: null })

      expect(result.path).toBeDefined()
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('Skills Sandbox'),
        'utf-8',
      )
    })
  })

  describe('cleanupSandbox', () => {
    it('removes directory when path is under sandbox root', async () => {
      mockFs.rm.mockResolvedValue(undefined)

      const { cleanupSandbox } = await getSandboxManager()
      await cleanupSandbox('/Users/test/skills-desktop-sandbox/12345')

      expect(mockFs.rm).toHaveBeenCalledWith(
        '/Users/test/skills-desktop-sandbox/12345',
        { recursive: true, force: true },
      )
    })

    it('throws when path is outside sandbox root', async () => {
      const { cleanupSandbox } = await getSandboxManager()

      await expect(cleanupSandbox('/Users/test/Documents')).rejects.toThrow(
        'Invalid sandbox path',
      )
      expect(mockFs.rm).not.toHaveBeenCalled()
    })

    it('throws when path attempts traversal', async () => {
      const { cleanupSandbox } = await getSandboxManager()

      await expect(
        cleanupSandbox('/Users/test/skills-desktop-sandbox/../Documents'),
      ).rejects.toThrow('Invalid sandbox path')
    })
  })

  describe('cleanupStaleSandboxes', () => {
    it('removes directories older than 24 hours', async () => {
      const staleTimestamp = String(Date.now() - 25 * 60 * 60 * 1000) // 25h ago
      const freshTimestamp = String(Date.now() - 1 * 60 * 60 * 1000) // 1h ago
      mockFs.readdir.mockResolvedValue([
        staleTimestamp,
        freshTimestamp,
      ] as unknown as Dirent[])
      mockFs.rm.mockResolvedValue(undefined)

      const { cleanupStaleSandboxes } = await getSandboxManager()
      await cleanupStaleSandboxes()

      expect(mockFs.rm).toHaveBeenCalledTimes(1)
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining(staleTimestamp),
        { recursive: true, force: true },
      )
    })

    it('handles missing sandbox root gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'))

      const { cleanupStaleSandboxes } = await getSandboxManager()
      await expect(cleanupStaleSandboxes()).resolves.toBeUndefined()
    })
  })
})
