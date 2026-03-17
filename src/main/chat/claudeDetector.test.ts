import * as childProcess from 'child_process'

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('child_process')

const mockExecSync = vi.mocked(childProcess.execSync)

// Dynamic import to allow per-test mock setup
async function getDetector() {
  // Clear module cache for fresh import
  vi.resetModules()
  return import('./claudeDetector')
}

describe('detectClaude', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns available with path and version when claude is found', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(true)
    expect(result.path).toBe('/usr/local/bin/claude')
    expect(result.version).toBe('2.1.0')
  })

  it('returns unavailable when claude is not found', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found')
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(false)
    expect(result.path).toBeNull()
    expect(result.version).toBeNull()
  })

  it('caches result after first detection', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude } = await getDetector()
    await detectClaude()
    await detectClaude() // Second call should use cache
    // execSync should only be called from the first detection
    expect(mockExecSync).toHaveBeenCalledTimes(2) // which + --version
  })

  it('clearClaudeCache resets cached result', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude, clearClaudeCache } = await getDetector()
    await detectClaude()
    clearClaudeCache()
    await detectClaude() // Should call execSync again after cache clear
    expect(mockExecSync).toHaveBeenCalledTimes(4) // 2 per detection × 2
  })

  it('returns available with null version when version command fails', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      throw new Error('version failed')
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(true)
    expect(result.path).toBe('/usr/local/bin/claude')
    expect(result.version).toBeNull()
  })
})
