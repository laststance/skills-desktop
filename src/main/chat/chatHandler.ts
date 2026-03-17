import { BrowserWindow } from 'electron'

import type {
  ChatSendParams,
  ClaudeStatus,
  CreateSandboxParams,
  SandboxResult,
} from '../../shared/chat-types'
import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { typedHandle } from '../ipc/typedHandle'

import { buildSystemPrompt, transformMessage } from './chatHelpers'
import { clearClaudeCache, detectClaude } from './claudeDetector'
import { cleanupSandbox, createSandbox } from './sandboxManager'

/** Active AbortController for cancellation */
let abortController: AbortController | null = null

/**
 * Send a chat chunk event to all renderer windows
 * @param chunk - ChatChunk to broadcast
 */
function sendChatChunk(chunk: unknown): void {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    win.webContents.send(IPC_CHANNELS.CHAT_CHUNK, chunk)
  }
}

/**
 * Handle chat:send — run Claude Agent SDK query and stream results
 * @param params - Message, sandbox path, skill context
 */
async function handleChatSend(params: ChatSendParams): Promise<void> {
  const claudeInfo = await detectClaude()
  if (!claudeInfo.available || !claudeInfo.path) {
    sendChatChunk({
      type: 'error',
      message:
        'Claude Code not found. Install with: npm install -g @anthropic-ai/claude-code',
    })
    sendChatChunk({ type: 'finish' })
    return
  }

  abortController = new AbortController()
  sendChatChunk({ type: 'start' })

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const systemPrompt = buildSystemPrompt(
      params.skillContext,
      params.activeSkillContent,
    )

    const cwd = params.sandboxPath ?? process.env.HOME ?? '/tmp'

    const stream = query({
      prompt: params.message,
      options: {
        cwd,
        systemPrompt,
        pathToClaudeCodeExecutable: claudeInfo.path,
        abortController,
        permissionMode: 'default',
      },
    })

    for await (const message of stream) {
      if (abortController?.signal.aborted) break
      const chunk = transformMessage(message)
      if (chunk) {
        sendChatChunk(chunk)
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    sendChatChunk({ type: 'error', message: errorMsg })
  } finally {
    sendChatChunk({ type: 'finish' })
    abortController = null
  }
}

/**
 * Register all chat-related IPC handlers
 * Called once during app initialization
 */
export function registerChatHandlers(): void {
  typedHandle('chat:detectClaude', async (_event): Promise<ClaudeStatus> => {
    return detectClaude()
  })

  typedHandle(
    'chat:send',
    async (_event, params: ChatSendParams): Promise<void> => {
      await handleChatSend(params)
    },
  )

  typedHandle('chat:abort', async (_event): Promise<void> => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  })

  typedHandle(
    'chat:createSandbox',
    async (_event, params: CreateSandboxParams): Promise<SandboxResult> => {
      return createSandbox(params)
    },
  )

  typedHandle(
    'chat:cleanupSandbox',
    async (_event, sandboxPath: string): Promise<void> => {
      await cleanupSandbox(sandboxPath)
    },
  )
}

/**
 * Abort any active chat session (called on app quit)
 */
export function abortActiveChat(): void {
  if (abortController) {
    abortController.abort()
    abortController = null
  }
}
