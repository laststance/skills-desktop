# Agent Chat Panel Design

Date: 2026-03-17

## Overview

Add a right-panel Agent chat interface to Skills Desktop, powered by Claude Agent SDK. Users can ask about skill usage, manage skills, and test skills in a full sandbox environment.

## Decisions

| Item           | Decision                                                           |
| -------------- | ------------------------------------------------------------------ |
| AI Integration | Claude Agent SDK, system Claude Code binary                        |
| Panel          | Independent 4th panel (320px default, resizable, collapsible)      |
| Sandbox        | Full sandbox (`~/skills-desktop-sandbox/<timestamp>/` + CLAUDE.md) |
| Context        | Dynamic hybrid (skill list summary + full content on demand)       |
| Template       | Empty directory + CLAUDE.md only (Claude Code handles setup)       |
| Session        | Single session (in-memory, no DB)                                  |
| Binary         | Detect system Claude Code (`which claude`)                         |

## IPC Contract

### Invoke Channels (renderer → main)

```typescript
'chat:detectClaude': () => Promise<{ available: boolean; path: string | null; version: string | null }>
'chat:send': (params: {
  message: string
  sandboxPath: string | null
  skillContext: { name: string; description: string }[]
  activeSkillContent: string | null
}) => Promise<void>
'chat:abort': () => Promise<void>
'chat:createSandbox': (params: { skillName: string | null }) => Promise<{ path: string }>
'chat:cleanupSandbox': (path: string) => Promise<void>
```

### Event Channels (main → renderer)

```typescript
'chat:chunk': (chunk: ChatChunk) => void
```

### ChatChunk Type (src/shared/)

```typescript
type ChatChunk =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-start'; toolName: string; toolCallId: string }
  | { type: 'tool-input-delta'; toolCallId: string; delta: string }
  | { type: 'tool-result'; toolCallId: string; output: string }
  | { type: 'error'; message: string }
  | { type: 'finish' }
  | { type: 'start' }
```

## Main Process — `src/main/chat/`

### claudeDetector.ts

- `detectClaude()` — `which claude` / `command -v claude` via login shell
- Cache result for app lifetime
- Return `{ available, path, version }`

### sandboxManager.ts

- `createSandbox({ skillName })` — Create `~/skills-desktop-sandbox/<timestamp>/`
- Write CLAUDE.md with skill context
- `cleanupSandbox(path)` — `fs.rm` recursive, validate path is under sandbox root
- Stale sandbox detection on app startup

### chatHandler.ts

- `registerChatHandlers(mainWindow)` — Register all 5 IPC handlers via typedHandle
- `handleChatSend()` — Core logic:
  1. Detect Claude Code
  2. Build system prompt (skill list + active skill content)
  3. `sdk.query({ prompt, options: { cwd, systemPrompt, pathToClaudeCodeExecutable, permissionMode, abortController } })`
  4. `for await (message of stream)` → transform → `mainWindow.send('chat:chunk', chunk)`
- `AbortController` for cancellation
- System prompt includes available skills list and active skill full content

## Renderer

### Redux — chatSlice.ts

```typescript
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
```

Reducers: `setClaudeStatus`, `addUserMessage`, `appendTextDelta`, `addToolCall`, `updateToolCall`, `finishAssistantMessage`, `setError`, `setSandbox`, `clearSandbox`, `clearMessages`

### Components — `src/renderer/src/components/chat/`

| Component              | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| ChatPanel.tsx          | Panel container (header, sandbox bar, messages, input) |
| ChatMessageList.tsx    | Scrollable message list                                |
| ChatMessageItem.tsx    | Individual message (user/assistant)                    |
| ChatToolCall.tsx       | Collapsible tool execution display                     |
| ChatInput.tsx          | Text input + send/abort buttons                        |
| SandboxBar.tsx         | Sandbox status bar (create/close)                      |
| ClaudeStatusBanner.tsx | Claude not found banner with retry                     |

### Layout Integration

```
<Sidebar /> | <MainContent /> | <DetailPanel /> | <ChatPanel />
```

- CSS Grid / flex 4-column layout
- Resize handle on left border
- Default: 320px, min: 240px, max: 480px
- Collapse toggle button

### IPC Event Listener (listener.ts)

Subscribe to `chat:chunk` events, dispatch corresponding Redux actions based on chunk type.

## Data Flows

### Chat Flow

1. User types message in ChatInput
2. `dispatch(addUserMessage)` + `invoke('chat:send', { message, sandboxPath, skillContext, activeSkillContent })`
3. Main: detectClaude → buildSystemPrompt → sdk.query() → stream
4. Main: `for await` → transform → `send('chat:chunk', chunk)`
5. Renderer: listener dispatches `appendTextDelta` / `addToolCall` / `finishAssistantMessage`

### Sandbox Flow

1. User clicks [Create Sandbox] in SandboxBar
2. `invoke('chat:createSandbox', { skillName })` → mkdir + write CLAUDE.md
3. `dispatch(setSandbox({ path, skillName }))`
4. Subsequent `chat:send` includes `sandboxPath` → Claude Code uses it as cwd
5. User clicks [Close Sandbox] → confirm dialog → `invoke('chat:cleanupSandbox')` → `dispatch(clearSandbox())`

### Claude Detection Flow

1. App startup: `invoke('chat:detectClaude')`
2. Found: `dispatch(setClaudeStatus({ available: true, path, version }))`
3. Not found: Show `ClaudeStatusBanner` with install instructions + [Retry] button

## Security

- Sandbox path limited to `~/skills-desktop-sandbox/` — no arbitrary paths
- `cleanupSandbox` validates path prefix before deletion
- `permissionMode: 'default'` — Claude Code asks for confirmation on dangerous ops
- No direct `fs` access from renderer (context isolation maintained)
- `app.on('before-quit')` aborts active streams

## Testing

| File                   | Target                              | Pattern              |
| ---------------------- | ----------------------------------- | -------------------- |
| chatSlice.test.ts      | Redux reducers                      | window.electron stub |
| sandboxManager.test.ts | Sandbox CRUD + validation           | fs mock              |
| claudeDetector.test.ts | Claude detection logic              | execSync mock        |
| chatHelpers.test.ts    | buildSystemPrompt, transformMessage | Pure function        |

## New Dependencies

- `@anthropic-ai/claude-agent-sdk` (main process only)

## Out of Scope (Future)

- Session history persistence (requires SQLite)
- Project templates (Claude Code handles setup)
- MCP server integration
- Multi-model support (Ollama, etc.)
