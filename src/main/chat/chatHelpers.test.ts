import { describe, expect, it } from 'vitest'

import { buildSystemPrompt, transformMessage } from './chatHelpers'

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

describe('transformMessage', () => {
  it('returns text-delta for assistant message with text content', () => {
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Hello world' }],
      },
    }
    expect(transformMessage(msg)).toEqual({
      type: 'text-delta',
      delta: 'Hello world',
    })
  })

  it('returns null for assistant message with non-text content block', () => {
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'image', source: 'data:...' }],
      },
    }
    expect(transformMessage(msg)).toBeNull()
  })

  it('returns null for assistant message with empty content array', () => {
    const msg = { type: 'assistant', message: { content: [] } }
    expect(transformMessage(msg)).toBeNull()
  })

  it('returns null for assistant message with missing content', () => {
    const msg = { type: 'assistant', message: {} }
    expect(transformMessage(msg)).toBeNull()
  })

  it('returns tool-start for tool_use message', () => {
    const msg = { type: 'tool_use', name: 'read_file', id: 'call-123' }
    expect(transformMessage(msg)).toEqual({
      type: 'tool-start',
      toolName: 'read_file',
      toolCallId: 'call-123',
    })
  })

  it('uses "unknown" toolName when name is missing', () => {
    const msg = { type: 'tool_use', id: 'call-456' }
    const result = transformMessage(msg)
    expect(result).toMatchObject({ type: 'tool-start', toolName: 'unknown' })
  })

  it('returns tool-result with string content', () => {
    const msg = {
      type: 'tool_result',
      tool_use_id: 'call-123',
      content: 'file content',
    }
    expect(transformMessage(msg)).toEqual({
      type: 'tool-result',
      toolCallId: 'call-123',
      output: 'file content',
    })
  })

  it('returns tool-result with JSON-stringified object content', () => {
    const msg = {
      type: 'tool_result',
      tool_use_id: 'call-789',
      content: { lines: 10 },
    }
    const result = transformMessage(msg)
    expect(result).toMatchObject({
      type: 'tool-result',
      toolCallId: 'call-789',
    })
    expect(JSON.parse((result as { output: string }).output)).toEqual({
      lines: 10,
    })
  })

  it('returns error chunk for error message with error field', () => {
    const msg = { type: 'error', error: 'Something failed' }
    expect(transformMessage(msg)).toEqual({
      type: 'error',
      message: 'Something failed',
    })
  })

  it('returns error chunk for error message with message field fallback', () => {
    const msg = { type: 'error', message: 'Fallback error' }
    expect(transformMessage(msg)).toEqual({
      type: 'error',
      message: 'Fallback error',
    })
  })

  it('returns error with Unknown error when neither field present', () => {
    const msg = { type: 'error' }
    expect(transformMessage(msg)).toEqual({
      type: 'error',
      message: 'Unknown error',
    })
  })

  it('returns null for unknown message type', () => {
    expect(transformMessage({ type: 'system', content: 'hello' })).toBeNull()
  })

  it('returns null for null input', () => {
    expect(transformMessage(null)).toBeNull()
  })

  it('returns null for string input', () => {
    expect(transformMessage('plain string')).toBeNull()
  })

  it('returns null for number input', () => {
    expect(transformMessage(42)).toBeNull()
  })
})
