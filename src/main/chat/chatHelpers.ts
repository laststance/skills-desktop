import type { ChatChunk } from '../../shared/chat-types'

/**
 * Build system prompt for Claude Code with skills context
 * @param skillContext - List of all installed skills (name + description)
 * @param activeSkillContent - Full SKILL.md content of the selected skill (or null)
 * @returns System prompt string
 * @example
 * buildSystemPrompt([{ name: 'task', description: 'impl workflow' }], null)
 * // => "You are a Skills assistant..."
 */
export function buildSystemPrompt(
  skillContext: { name: string; description: string }[],
  activeSkillContent: string | null,
): string {
  const skillList =
    skillContext.length > 0
      ? skillContext.map((s) => `- **${s.name}**: ${s.description}`).join('\n')
      : '(No skills installed)'

  let prompt = `You are a Skills assistant for the Skills Desktop app.
You help users understand, manage, and test their AI agent skills.
You can read skill files, explain how skills work, and help create or modify skills.

## Available Skills
${skillList}
`

  if (activeSkillContent) {
    prompt += `
## Currently Selected Skill (Full Content)
${activeSkillContent}
`
  }

  return prompt
}

/**
 * Transform a Claude Agent SDK message into a ChatChunk for IPC streaming
 * Filters and maps SDK message types to the simplified ChatChunk union
 * @param message - Raw message from claude-agent-sdk query() AsyncIterable
 * @returns ChatChunk to send to renderer, or null to skip
 * @example
 * transformMessage({ type: 'assistant', message: { ... } })
 * // => { type: 'text-delta', delta: 'Hello' } (or null if not relevant)
 */
export function transformMessage(message: unknown): ChatChunk | null {
  if (!message || typeof message !== 'object') return null

  const msg = message as Record<string, unknown>

  switch (msg.type) {
    case 'assistant': {
      // Extract text content from assistant message
      const assistantMsg = msg.message as Record<string, unknown> | undefined
      if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
        for (const block of assistantMsg.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            return { type: 'text-delta', delta: block.text }
          }
        }
      }
      return null
    }

    case 'tool_use': {
      return {
        type: 'tool-start',
        toolName: String(msg.name ?? 'unknown'),
        toolCallId: String(msg.id ?? ''),
      }
    }

    case 'tool_result': {
      return {
        type: 'tool-result',
        toolCallId: String(msg.tool_use_id ?? ''),
        output:
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content ?? ''),
      }
    }

    case 'error': {
      return {
        type: 'error',
        message: String(
          (msg as Record<string, unknown>).error ??
            (msg as Record<string, unknown>).message ??
            'Unknown error',
        ),
      }
    }

    default:
      return null
  }
}
