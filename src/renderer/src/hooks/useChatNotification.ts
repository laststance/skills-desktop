import { useEffect } from 'react'

import type { ChatChunk } from '../../../shared/chat-types'
import { useAppDispatch } from '../redux/hooks'
import {
  startStreaming,
  appendTextDelta,
  addToolCall,
  updateToolInput,
  updateToolResult,
  finishStreaming,
  setError,
} from '../redux/slices/chatSlice'

interface ChatAPI {
  onChunk: (callback: (chunk: ChatChunk) => void) => () => void
}

interface ElectronAPIWithChat {
  chat?: ChatAPI
}

/**
 * Get chat API from window.electron if available
 */
function getChatAPI(): ChatAPI | undefined {
  const electron = window.electron as ElectronAPIWithChat
  return electron?.chat
}

/**
 * Hook to subscribe to chat:chunk IPC events
 * Dispatches Redux actions based on chunk type
 * Sets up listener on mount, cleans up on unmount
 * @param options.enabled - Skip subscription when false (feature flag)
 */
export function useChatNotification(options: { enabled?: boolean } = {}): void {
  const { enabled = true } = options
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (!enabled) return

    const chatAPI = getChatAPI()
    if (!chatAPI) return

    const cleanup = chatAPI.onChunk((chunk: ChatChunk) => {
      switch (chunk.type) {
        case 'start':
          dispatch(startStreaming())
          break
        case 'text-delta':
          dispatch(appendTextDelta(chunk.delta))
          break
        case 'tool-start':
          dispatch(
            addToolCall({
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
            }),
          )
          break
        case 'tool-input-delta':
          dispatch(
            updateToolInput({
              toolCallId: chunk.toolCallId,
              delta: chunk.delta,
            }),
          )
          break
        case 'tool-result':
          dispatch(
            updateToolResult({
              toolCallId: chunk.toolCallId,
              output: chunk.output,
            }),
          )
          break
        case 'error':
          dispatch(setError(chunk.message))
          break
        case 'finish':
          dispatch(finishStreaming())
          break
      }
    })

    return cleanup
  }, [dispatch, enabled])
}
