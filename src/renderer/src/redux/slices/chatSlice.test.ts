import { configureStore } from '@reduxjs/toolkit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', {
  electron: {
    chat: {
      detectClaude: vi.fn(),
      send: vi.fn(),
      abort: vi.fn(),
      createSandbox: vi.fn(),
      cleanupSandbox: vi.fn(),
      onChunk: vi.fn(),
    },
  },
})

async function createTestStore() {
  const { default: chatReducer } = await import('./chatSlice')
  return configureStore({ reducer: { chat: chatReducer } })
}

describe('chatSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct initial state', async () => {
    const store = await createTestStore()
    const state = store.getState().chat
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
    expect(state.claudeAvailable).toBeNull()
    expect(state.sandboxPath).toBeNull()
  })

  it('setClaudeStatus updates detection state', async () => {
    const { setClaudeStatus } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(
      setClaudeStatus({
        available: true,
        path: '/usr/local/bin/claude',
        version: '2.1.0',
      }),
    )
    const state = store.getState().chat
    expect(state.claudeAvailable).toBe(true)
    expect(state.claudePath).toBe('/usr/local/bin/claude')
    expect(state.claudeVersion).toBe('2.1.0')
  })

  it('addUserMessage creates a new user message', async () => {
    const { addUserMessage } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(addUserMessage('Hello'))
    const state = store.getState().chat
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('user')
    expect(state.messages[0].content).toBe('Hello')
  })

  it('startStreaming adds empty assistant message', async () => {
    const { startStreaming } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(startStreaming())
    const state = store.getState().chat
    expect(state.isStreaming).toBe(true)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe('assistant')
    expect(state.messages[0].content).toBe('')
  })

  it('appendTextDelta appends to last assistant message', async () => {
    const { startStreaming, appendTextDelta } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(startStreaming())
    store.dispatch(appendTextDelta('Hello '))
    store.dispatch(appendTextDelta('world'))
    const state = store.getState().chat
    expect(state.messages[0].content).toBe('Hello world')
  })

  it('finishStreaming sets isStreaming to false', async () => {
    const { startStreaming, finishStreaming } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(startStreaming())
    store.dispatch(finishStreaming())
    expect(store.getState().chat.isStreaming).toBe(false)
  })

  it('clearMessages resets messages array', async () => {
    const { addUserMessage, clearMessages } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(addUserMessage('test'))
    store.dispatch(clearMessages())
    expect(store.getState().chat.messages).toEqual([])
  })

  it('setSandbox and clearSandbox manage sandbox state', async () => {
    const { setSandbox, clearSandbox } = await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(setSandbox({ path: '/tmp/sandbox/123', skillName: 'task' }))
    expect(store.getState().chat.sandboxPath).toBe('/tmp/sandbox/123')
    expect(store.getState().chat.sandboxSkillName).toBe('task')

    store.dispatch(clearSandbox())
    expect(store.getState().chat.sandboxPath).toBeNull()
    expect(store.getState().chat.sandboxSkillName).toBeNull()
  })

  it('addToolCall and updateToolResult track tool execution', async () => {
    const { startStreaming, addToolCall, updateToolResult } =
      await import('./chatSlice')
    const store = await createTestStore()
    store.dispatch(startStreaming())
    store.dispatch(addToolCall({ toolCallId: 'tc_1', toolName: 'Read' }))

    let msg = store.getState().chat.messages[0]
    expect(msg.toolCalls).toHaveLength(1)
    expect(msg.toolCalls[0].toolName).toBe('Read')
    expect(msg.toolCalls[0].status).toBe('running')

    store.dispatch(
      updateToolResult({ toolCallId: 'tc_1', output: 'file content' }),
    )
    msg = store.getState().chat.messages[0]
    expect(msg.toolCalls[0].status).toBe('done')
    expect(msg.toolCalls[0].output).toBe('file content')
  })
})
