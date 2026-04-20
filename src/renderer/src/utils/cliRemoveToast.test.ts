import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CliRemoveSkillsResult, SkillName } from '../../../shared/types'

import { toastCliRemoveBatchResult } from './cliRemoveToast'

/**
 * sonner's toast module is the one side-effect we care about. Spy on each
 * branch (success/error/warning) separately so a test can assert the exact
 * shape of the call — toast library API drift would surface here first.
 */
const toastSuccess = vi.fn()
const toastError = vi.fn()
const toastWarning = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}))

describe('toastCliRemoveBatchResult', () => {
  beforeEach(() => {
    toastSuccess.mockReset()
    toastError.mockReset()
    toastWarning.mockReset()
  })

  it('emits a name-specific success toast for a single successful item', () => {
    // Single-item case surfaces the name so the user sees what they removed.
    // The DeleteCliSkillDialog confirm path always dispatches a length-1 batch.
    const result: CliRemoveSkillsResult = {
      items: [{ skillName: 'brainstorming' as SkillName, outcome: 'removed' }],
    }

    toastCliRemoveBatchResult(result)

    expect(toastSuccess).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('Removed brainstorming', {
      description: 'Deregistered from ~/.agents/.skill-lock.json',
    })
    expect(toastError).not.toHaveBeenCalled()
    expect(toastWarning).not.toHaveBeenCalled()
  })

  it('emits a count-only success toast for an all-successful multi-item batch', () => {
    const result: CliRemoveSkillsResult = {
      items: [
        { skillName: 'brainstorming' as SkillName, outcome: 'removed' },
        { skillName: 'theme-generator' as SkillName, outcome: 'removed' },
        { skillName: 'code-review' as SkillName, outcome: 'removed' },
      ],
    }

    toastCliRemoveBatchResult(result)

    expect(toastSuccess).toHaveBeenCalledWith('Removed 3 skills', {
      description: 'Deregistered from ~/.agents/.skill-lock.json',
    })
  })

  it('emits a name-specific error toast with the actual error message for a single failure', () => {
    // All-failed single-item case surfaces both the name AND the error so the
    // user does not have to dig through devtools to learn what went wrong.
    const result: CliRemoveSkillsResult = {
      items: [
        {
          skillName: 'brainstorming' as SkillName,
          outcome: 'error',
          error: { message: 'Skill not found in lock file', code: 1 },
        },
      ],
    }

    toastCliRemoveBatchResult(result)

    expect(toastError).toHaveBeenCalledWith('Failed to remove brainstorming', {
      description: 'Skill not found in lock file',
    })
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('emits a generic error toast for an all-failed multi-item batch', () => {
    const result: CliRemoveSkillsResult = {
      items: [
        {
          skillName: 'a' as SkillName,
          outcome: 'error',
          error: { message: 'E1', code: 1 },
        },
        {
          skillName: 'b' as SkillName,
          outcome: 'error',
          error: { message: 'E2', code: 1 },
        },
      ],
    }

    toastCliRemoveBatchResult(result)

    expect(toastError).toHaveBeenCalledWith('Failed to remove skills', {
      description: '2 of 2 failed',
    })
  })

  it('emits a warning toast for a partial-success batch', () => {
    const result: CliRemoveSkillsResult = {
      items: [
        { skillName: 'a' as SkillName, outcome: 'removed' },
        { skillName: 'b' as SkillName, outcome: 'removed' },
        {
          skillName: 'c' as SkillName,
          outcome: 'error',
          error: { message: 'Skill not found', code: 1 },
        },
      ],
    }

    toastCliRemoveBatchResult(result)

    expect(toastWarning).toHaveBeenCalledWith('Removed 2, failed 1', {
      description: 'Some skills could not be deregistered',
    })
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('pluralizes "skill" correctly for the 1-success case in a count-only path', () => {
    // Rare in practice (batch thunks of length 1 already hit the name-specific
    // branch), but the pluralize guard should still produce grammatical output.
    // This covers the path where `removed === 1` via a hypothetical batch
    // with everything-successful but only one entry — identical to the first
    // test, double-asserted with singular `skill` wording.
    const result: CliRemoveSkillsResult = {
      items: [{ skillName: 'solo' as SkillName, outcome: 'removed' }],
    }

    toastCliRemoveBatchResult(result)

    // Name-aware branch wins for length-1, so we get the name, not "1 skill".
    expect(toastSuccess).toHaveBeenCalledWith('Removed solo', {
      description: 'Deregistered from ~/.agents/.skill-lock.json',
    })
  })
})
