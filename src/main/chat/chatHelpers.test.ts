import { describe, expect, it } from 'vitest'

import { buildSystemPrompt } from './chatHelpers'

describe('buildSystemPrompt', () => {
  it('includes skill list', () => {
    const result = buildSystemPrompt(
      [
        { name: 'task', description: 'Standard impl workflow' },
        { name: 'git', description: 'Git operations' },
      ],
      null,
    )
    expect(result).toContain('**task**')
    expect(result).toContain('Standard impl workflow')
    expect(result).toContain('**git**')
    expect(result).toContain('Git operations')
  })

  it('includes active skill content when provided', () => {
    const result = buildSystemPrompt(
      [{ name: 'task', description: 'Standard impl workflow' }],
      '---\nname: task\n---\nDo the task',
    )
    expect(result).toContain('Currently Selected Skill')
    expect(result).toContain('Do the task')
  })

  it('omits active skill section when null', () => {
    const result = buildSystemPrompt(
      [{ name: 'task', description: 'desc' }],
      null,
    )
    expect(result).not.toContain('Currently Selected Skill')
  })

  it('handles empty skill list', () => {
    const result = buildSystemPrompt([], null)
    expect(result).toContain('Skills assistant')
    expect(result).toContain('Available Skills')
  })
})
