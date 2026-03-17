/**
 * Chat chunk types streamed from main → renderer via IPC events
 * @example
 * // Text streaming:
 * { type: 'text-delta', delta: 'Hello' }
 * // Tool execution:
 * { type: 'tool-start', toolName: 'Read', toolCallId: 'tc_123' }
 */
export type ChatChunk =
  | { type: 'start' }
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; toolName: string; toolCallId: string }
  | { type: 'tool-input-delta'; toolCallId: string; delta: string }
  | { type: 'tool-result'; toolCallId: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'finish' }

/**
 * Parameters for chat:send IPC invoke
 * @example
 * { message: "How do I use /task?", sandboxPath: null, skillContext: [...], activeSkillContent: "..." }
 */
export interface ChatSendParams {
  message: string
  sandboxPath: string | null
  skillContext: { name: string; description: string }[]
  activeSkillContent: string | null
}

/**
 * Result from chat:detectClaude IPC invoke
 * @example
 * { available: true, path: '/usr/local/bin/claude', version: '2.1.0' }
 */
export interface ClaudeStatus {
  available: boolean
  path: string | null
  version: string | null
}

/**
 * Parameters for chat:createSandbox IPC invoke
 * @example
 * { skillName: 'task' }
 */
export interface CreateSandboxParams {
  skillName: string | null
}

/**
 * Result from chat:createSandbox IPC invoke
 * @example
 * { path: '/Users/me/skills-desktop-sandbox/1773746342' }
 */
export interface SandboxResult {
  path: string
}
