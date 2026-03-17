import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { ClaudeStatus } from '../../../../shared/chat-types'

interface ToolCallInfo {
  toolCallId: string
  toolName: string
  input: string
  output: string | null
  status: 'running' | 'done' | 'error'
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: ToolCallInfo[]
  timestamp: number
}

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  claudeAvailable: boolean | null
  claudePath: string | null
  claudeVersion: string | null
  sandboxPath: string | null
  sandboxSkillName: string | null
  error: string | null
}

const initialState: ChatState = {
  messages: [],
  isStreaming: false,
  claudeAvailable: null,
  claudePath: null,
  claudeVersion: null,
  sandboxPath: null,
  sandboxSkillName: null,
  error: null,
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setClaudeStatus: (state, action: PayloadAction<ClaudeStatus>) => {
      state.claudeAvailable = action.payload.available
      state.claudePath = action.payload.path
      state.claudeVersion = action.payload.version
    },
    addUserMessage: (state, action: PayloadAction<string>) => {
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'user',
        content: action.payload,
        toolCalls: [],
        timestamp: Date.now(),
      })
    },
    startStreaming: (state) => {
      state.isStreaming = true
      state.error = null
      state.messages.push({
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now(),
      })
    },
    appendTextDelta: (state, action: PayloadAction<string>) => {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant') {
        last.content += action.payload
      }
    },
    addToolCall: (
      state,
      action: PayloadAction<{ toolCallId: string; toolName: string }>,
    ) => {
      const last = state.messages[state.messages.length - 1]
      if (last?.role === 'assistant') {
        last.toolCalls.push({
          toolCallId: action.payload.toolCallId,
          toolName: action.payload.toolName,
          input: '',
          output: null,
          status: 'running',
        })
      }
    },
    updateToolInput: (
      state,
      action: PayloadAction<{ toolCallId: string; delta: string }>,
    ) => {
      const last = state.messages[state.messages.length - 1]
      const tool = last?.toolCalls.find(
        (t) => t.toolCallId === action.payload.toolCallId,
      )
      if (tool) {
        tool.input += action.payload.delta
      }
    },
    updateToolResult: (
      state,
      action: PayloadAction<{ toolCallId: string; output: string }>,
    ) => {
      const last = state.messages[state.messages.length - 1]
      const tool = last?.toolCalls.find(
        (t) => t.toolCallId === action.payload.toolCallId,
      )
      if (tool) {
        tool.output = action.payload.output
        tool.status = 'done'
      }
    },
    finishStreaming: (state) => {
      state.isStreaming = false
    },
    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload
      state.isStreaming = false
    },
    setSandbox: (
      state,
      action: PayloadAction<{ path: string; skillName: string | null }>,
    ) => {
      state.sandboxPath = action.payload.path
      state.sandboxSkillName = action.payload.skillName ?? null
    },
    clearSandbox: (state) => {
      state.sandboxPath = null
      state.sandboxSkillName = null
    },
    clearMessages: (state) => {
      state.messages = []
      state.error = null
    },
  },
})

export const {
  setClaudeStatus,
  addUserMessage,
  startStreaming,
  appendTextDelta,
  addToolCall,
  updateToolInput,
  updateToolResult,
  finishStreaming,
  setError,
  setSandbox,
  clearSandbox,
  clearMessages,
} = chatSlice.actions

export default chatSlice.reducer
