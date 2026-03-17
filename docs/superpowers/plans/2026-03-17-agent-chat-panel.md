# Agent Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-panel Agent chat interface powered by Claude Agent SDK for skill Q&A, management, and sandbox testing.

**Architecture:** New `src/main/chat/` module handles Claude Code detection, sandbox lifecycle, and SDK streaming. New `chatSlice` in Redux manages in-memory chat state. New `ChatPanel` component as 4th column in the `react-resizable-panels` layout. IPC events stream chat chunks from main → renderer following the existing `update:*` event pattern.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, React 19, Redux Toolkit, react-resizable-panels, Radix UI, Tailwind CSS, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-agent-chat-panel-design.md`

---

## File Structure

### New Files

| File                                                      | Responsibility                                                             |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/shared/chat-types.ts`                                | `ChatChunk`, `ChatSendParams`, `ClaudeStatus`, `CreateSandboxParams` types |
| `src/main/chat/claudeDetector.ts`                         | Detect system Claude Code binary (path + version)                          |
| `src/main/chat/sandboxManager.ts`                         | Create/cleanup sandbox directories with CLAUDE.md                          |
| `src/main/chat/chatHelpers.ts`                            | `buildSystemPrompt()`, `transformMessage()` pure functions                 |
| `src/main/chat/chatHandler.ts`                            | IPC handlers: send, abort, detect, sandbox CRUD                            |
| `src/main/chat/index.ts`                                  | `registerChatHandlers()` export                                            |
| `src/renderer/src/redux/slices/chatSlice.ts`              | Redux state for chat messages, streaming, sandbox                          |
| `src/renderer/src/hooks/useChatNotification.ts`           | Subscribe to `chat:chunk` IPC events → dispatch Redux actions              |
| `src/renderer/src/components/chat/ChatPanel.tsx`          | Panel container (header, messages, input)                                  |
| `src/renderer/src/components/chat/ChatMessageList.tsx`    | Scrollable message list                                                    |
| `src/renderer/src/components/chat/ChatMessageItem.tsx`    | Individual user/assistant message                                          |
| `src/renderer/src/components/chat/ChatToolCall.tsx`       | Collapsible tool execution display                                         |
| `src/renderer/src/components/chat/ChatInput.tsx`          | Text input + send/abort/sandbox/clear buttons                              |
| `src/renderer/src/components/chat/SandboxBar.tsx`         | Sandbox status bar                                                         |
| `src/renderer/src/components/chat/ClaudeStatusBanner.tsx` | Claude not found banner                                                    |
| `src/main/chat/claudeDetector.test.ts`                    | Tests for Claude detection                                                 |
| `src/main/chat/sandboxManager.test.ts`                    | Tests for sandbox CRUD                                                     |
| `src/main/chat/chatHelpers.test.ts`                       | Tests for pure helper functions                                            |
| `src/renderer/src/redux/slices/chatSlice.test.ts`         | Tests for Redux reducers                                                   |

### Modified Files

| File                                   | Change                                                         |
| -------------------------------------- | -------------------------------------------------------------- |
| `src/shared/ipc-channels.ts`           | Add 6 chat channel constants                                   |
| `src/shared/ipc-contract.ts`           | Add 5 invoke + 1 event channel to contracts                    |
| `src/preload/index.ts`                 | Add `chat` API namespace to `exposeInMainWorld`                |
| `src/renderer/src/types/electron.d.ts` | Add `chat` type declarations                                   |
| `src/main/ipc/handlers.ts`             | Add `registerChatHandlers()` to `registerAllHandlers()`        |
| `src/main/index.ts`                    | Pass `mainWindow` to chat handler registration                 |
| `src/renderer/src/redux/store.ts`      | Add `chatReducer`                                              |
| `src/renderer/src/App.tsx`             | Add `ChatPanel` as 4th resizable panel + `useChatNotification` |
| `package.json`                         | Add `@anthropic-ai/claude-agent-sdk` dependency                |

---

## Task 1: Shared Types + IPC Contract

**Files:**

- Create: `src/shared/chat-types.ts`
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Create `src/shared/chat-types.ts`**

```typescript
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
```

- [ ] **Step 2: Add chat channels to `src/shared/ipc-channels.ts`**

Add after the `// Update` section:

```typescript
  // Chat (Agent Chat Panel)
  CHAT_DETECT_CLAUDE: 'chat:detectClaude',
  CHAT_SEND: 'chat:send',
  CHAT_ABORT: 'chat:abort',
  CHAT_CREATE_SANDBOX: 'chat:createSandbox',
  CHAT_CLEANUP_SANDBOX: 'chat:cleanupSandbox',
  CHAT_CHUNK: 'chat:chunk',
```

- [ ] **Step 3: Add chat channels to `src/shared/ipc-contract.ts`**

Add imports at top:

```typescript
import type {
  ChatChunk,
  ChatSendParams,
  ClaudeStatus,
  CreateSandboxParams,
  SandboxResult,
} from './chat-types'
```

Add to `IpcInvokeContract`:

```typescript
  'chat:detectClaude': { args: []; result: ClaudeStatus }
  'chat:send': { args: [ChatSendParams]; result: void }
  'chat:abort': { args: []; result: void }
  'chat:createSandbox': { args: [CreateSandboxParams]; result: SandboxResult }
  'chat:cleanupSandbox': { args: [string]; result: void }
```

Add to `IpcEventContract`:

```typescript
  'chat:chunk': ChatChunk
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no consumers of new channels yet)

- [ ] **Step 5: Commit**

```bash
git add src/shared/chat-types.ts src/shared/ipc-channels.ts src/shared/ipc-contract.ts
git commit -m "feat(shared): add chat IPC contract and types"
```

---

## Task 2: Claude Detector (Main Process)

**Files:**

- Create: `src/main/chat/claudeDetector.ts`
- Test: `src/main/chat/claudeDetector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/chat/claudeDetector.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as childProcess from 'child_process'

vi.mock('child_process')

const mockExecSync = vi.mocked(childProcess.execSync)

// Dynamic import to allow per-test mock setup
async function getDetector() {
  // Clear module cache for fresh import
  vi.resetModules()
  return import('./claudeDetector')
}

describe('detectClaude', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns available with path and version when claude is found', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(true)
    expect(result.path).toBe('/usr/local/bin/claude')
    expect(result.version).toBe('2.1.0')
  })

  it('returns unavailable when claude is not found', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not found')
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(false)
    expect(result.path).toBeNull()
    expect(result.version).toBeNull()
  })

  it('caches result after first detection', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude } = await getDetector()
    await detectClaude()
    await detectClaude() // Second call should use cache
    // execSync should only be called from the first detection
    expect(mockExecSync).toHaveBeenCalledTimes(2) // which + --version
  })

  it('clearClaudeCache resets cached result', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      if (typeof cmd === 'string' && cmd.includes('--version')) {
        return 'claude 2.1.0\n'
      }
      return ''
    })

    const { detectClaude, clearClaudeCache } = await getDetector()
    await detectClaude()
    clearClaudeCache()
    await detectClaude() // Should call execSync again after cache clear
    expect(mockExecSync).toHaveBeenCalledTimes(4) // 2 per detection × 2
  })

  it('returns available with null version when version command fails', async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('which claude')) {
        return '/usr/local/bin/claude\n'
      }
      throw new Error('version failed')
    })

    const { detectClaude } = await getDetector()
    const result = await detectClaude()
    expect(result.available).toBe(true)
    expect(result.path).toBe('/usr/local/bin/claude')
    expect(result.version).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/main/chat/claudeDetector.test.ts`
Expected: FAIL — module `./claudeDetector` not found

- [ ] **Step 3: Write implementation**

Create `src/main/chat/claudeDetector.ts`:

```typescript
import { execSync } from 'child_process'
import * as os from 'os'

import type { ClaudeStatus } from '../../shared/chat-types'

/** Cached detection result (stable for app lifetime) */
let cachedResult: ClaudeStatus | null = null

/**
 * Detect system-installed Claude Code binary
 * Searches PATH via login shell to find claude executable
 * Results are cached for app lifetime
 * @returns Detection result with availability, path, and version
 * @example
 * const status = await detectClaude()
 * // => { available: true, path: '/usr/local/bin/claude', version: '2.1.0' }
 */
export async function detectClaude(): Promise<ClaudeStatus> {
  if (cachedResult) return cachedResult

  let claudePath: string | null = null
  let version: string | null = null

  try {
    // Use login shell to pick up PATH from user's shell profile (nvm, homebrew, etc.)
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'which claude'`, {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        HOME: os.homedir(),
        USER: os.userInfo().username,
        SHELL: shell,
        DISABLE_AUTO_UPDATE: 'true',
      },
    })
    claudePath = result.trim()
  } catch {
    cachedResult = { available: false, path: null, version: null }
    return cachedResult
  }

  if (!claudePath) {
    cachedResult = { available: false, path: null, version: null }
    return cachedResult
  }

  try {
    const versionOutput = execSync(`${claudePath} --version`, {
      encoding: 'utf8',
      timeout: 5000,
    })
    // Parse "claude X.Y.Z" or just "X.Y.Z"
    const match = versionOutput.trim().match(/(\d+\.\d+\.\d+)/)
    version = match ? match[1] : null
  } catch {
    // Version detection failed, but claude binary exists
  }

  cachedResult = { available: true, path: claudePath, version }
  return cachedResult
}

/**
 * Clear cached detection result (for retry)
 */
export function clearClaudeCache(): void {
  cachedResult = null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/main/chat/claudeDetector.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/claudeDetector.ts src/main/chat/claudeDetector.test.ts
git commit -m "feat(main): add Claude Code binary detector"
```

---

## Task 3: Sandbox Manager (Main Process)

**Files:**

- Create: `src/main/chat/sandboxManager.ts`
- Test: `src/main/chat/sandboxManager.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/chat/sandboxManager.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

vi.mock('fs/promises')
vi.mock('os')

const mockFs = vi.mocked(fs)
const mockOs = vi.mocked(os)

async function getSandboxManager() {
  vi.resetModules()
  return import('./sandboxManager')
}

describe('sandboxManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOs.homedir.mockReturnValue('/Users/test')
  })

  describe('createSandbox', () => {
    it('creates directory and writes CLAUDE.md', async () => {
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)

      const { createSandbox } = await getSandboxManager()
      const result = await createSandbox({ skillName: 'task' })

      expect(result.path).toMatch(/^\/Users\/test\/skills-desktop-sandbox\//)
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('skills-desktop-sandbox'),
        { recursive: true },
      )
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('task'),
        'utf-8',
      )
    })

    it('creates sandbox without skill name', async () => {
      mockFs.mkdir.mockResolvedValue(undefined)
      mockFs.writeFile.mockResolvedValue(undefined)

      const { createSandbox } = await getSandboxManager()
      const result = await createSandbox({ skillName: null })

      expect(result.path).toBeDefined()
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('CLAUDE.md'),
        expect.stringContaining('Skills Sandbox'),
        'utf-8',
      )
    })
  })

  describe('cleanupSandbox', () => {
    it('removes directory when path is under sandbox root', async () => {
      mockFs.rm.mockResolvedValue(undefined)

      const { cleanupSandbox } = await getSandboxManager()
      await cleanupSandbox('/Users/test/skills-desktop-sandbox/12345')

      expect(mockFs.rm).toHaveBeenCalledWith(
        '/Users/test/skills-desktop-sandbox/12345',
        { recursive: true, force: true },
      )
    })

    it('throws when path is outside sandbox root', async () => {
      const { cleanupSandbox } = await getSandboxManager()

      await expect(cleanupSandbox('/Users/test/Documents')).rejects.toThrow(
        'Invalid sandbox path',
      )
      expect(mockFs.rm).not.toHaveBeenCalled()
    })

    it('throws when path attempts traversal', async () => {
      const { cleanupSandbox } = await getSandboxManager()

      await expect(
        cleanupSandbox('/Users/test/skills-desktop-sandbox/../Documents'),
      ).rejects.toThrow('Invalid sandbox path')
    })
  })

  describe('cleanupStaleSandboxes', () => {
    it('removes directories older than 24 hours', async () => {
      const staleTimestamp = String(Date.now() - 25 * 60 * 60 * 1000) // 25h ago
      const freshTimestamp = String(Date.now() - 1 * 60 * 60 * 1000) // 1h ago
      mockFs.readdir.mockResolvedValue([
        staleTimestamp,
        freshTimestamp,
      ] as unknown as Dirent[])
      mockFs.rm.mockResolvedValue(undefined)

      const { cleanupStaleSandboxes } = await getSandboxManager()
      await cleanupStaleSandboxes()

      expect(mockFs.rm).toHaveBeenCalledTimes(1)
      expect(mockFs.rm).toHaveBeenCalledWith(
        expect.stringContaining(staleTimestamp),
        { recursive: true, force: true },
      )
    })

    it('handles missing sandbox root gracefully', async () => {
      mockFs.readdir.mockRejectedValue(new Error('ENOENT'))

      const { cleanupStaleSandboxes } = await getSandboxManager()
      await expect(cleanupStaleSandboxes()).resolves.toBeUndefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/main/chat/sandboxManager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/main/chat/sandboxManager.ts`:

```typescript
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type {
  CreateSandboxParams,
  SandboxResult,
} from '../../shared/chat-types'

const SANDBOX_DIR_NAME = 'skills-desktop-sandbox'

/**
 * Get the root sandbox directory path
 * @returns Absolute path to ~/skills-desktop-sandbox/
 */
function getSandboxRoot(): string {
  return path.join(os.homedir(), SANDBOX_DIR_NAME)
}

/**
 * Create a sandbox directory with CLAUDE.md for skill testing
 * @param params - Skill name to include in CLAUDE.md context
 * @returns Path to created sandbox directory
 * @example
 * const result = await createSandbox({ skillName: 'task' })
 * // => { path: '/Users/me/skills-desktop-sandbox/1773746342' }
 */
export async function createSandbox(
  params: CreateSandboxParams,
): Promise<SandboxResult> {
  const sandboxPath = path.join(getSandboxRoot(), String(Date.now()))
  await fs.mkdir(sandboxPath, { recursive: true })

  const claudeMd = buildClaudeMd(params.skillName)
  await fs.writeFile(path.join(sandboxPath, 'CLAUDE.md'), claudeMd, 'utf-8')

  return { path: sandboxPath }
}

/**
 * Remove a sandbox directory (validates path is under sandbox root)
 * @param sandboxPath - Absolute path to sandbox to remove
 * @throws Error if path is outside sandbox root or uses traversal
 * @example
 * await cleanupSandbox('/Users/me/skills-desktop-sandbox/1773746342')
 */
export async function cleanupSandbox(sandboxPath: string): Promise<void> {
  const root = getSandboxRoot()
  const resolved = path.resolve(sandboxPath)

  // Security: only allow deletion under sandbox root
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`Invalid sandbox path: ${sandboxPath} is not under ${root}`)
  }

  await fs.rm(resolved, { recursive: true, force: true })
}

/**
 * Cleanup stale sandbox directories on app startup
 * Removes any directories older than 24 hours
 */
export async function cleanupStaleSandboxes(): Promise<void> {
  const root = getSandboxRoot()
  try {
    const entries = await fs.readdir(root)
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const entry of entries) {
      const timestamp = Number(entry)
      if (!Number.isNaN(timestamp) && now - timestamp > maxAge) {
        await fs.rm(path.join(root, entry), { recursive: true, force: true })
      }
    }
  } catch {
    // Sandbox root doesn't exist yet — nothing to clean up
  }
}

/**
 * Build CLAUDE.md content for sandbox
 * @param skillName - Optional skill name to reference
 * @returns CLAUDE.md content string
 */
function buildClaudeMd(skillName: string | null): string {
  let content = `# Skills Sandbox

This is a sandbox project for testing skills.
Feel free to create files, install packages, and experiment.
This directory will be cleaned up when the sandbox is closed.
`

  if (skillName) {
    content += `\n## Active Skill: ${skillName}

Test the "${skillName}" skill by invoking it with /\`${skillName}\`.
`
  }

  return content
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/main/chat/sandboxManager.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/sandboxManager.ts src/main/chat/sandboxManager.test.ts
git commit -m "feat(main): add sandbox manager for skill testing"
```

---

## Task 4: Chat Helpers (Pure Functions)

**Files:**

- Create: `src/main/chat/chatHelpers.ts`
- Test: `src/main/chat/chatHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/chat/chatHelpers.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/main/chat/chatHelpers.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/main/chat/chatHelpers.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/main/chat/chatHelpers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/chat/chatHelpers.ts src/main/chat/chatHelpers.test.ts
git commit -m "feat(main): add chat helper functions (system prompt, message transform)"
```

---

## Task 5: Install SDK Dependency

**Files:**

- Modify: `package.json`

> **Prerequisite:** Must install before Task 6, which imports from `@anthropic-ai/claude-agent-sdk`.

- [ ] **Step 1: Install `@anthropic-ai/claude-agent-sdk`**

Run: `pnpm add @anthropic-ai/claude-agent-sdk`

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add @anthropic-ai/claude-agent-sdk dependency"
```

---

## Task 6: Chat Handler + IPC Registration (Main Process)

**Files:**

- Create: `src/main/chat/chatHandler.ts`
- Create: `src/main/chat/index.ts`
- Modify: `src/main/ipc/handlers.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Create `src/main/chat/chatHandler.ts`**

```typescript
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
```

- [ ] **Step 2: Create `src/main/chat/index.ts`**

```typescript
export { registerChatHandlers, abortActiveChat } from './chatHandler'
```

- [ ] **Step 3: Modify `src/main/ipc/handlers.ts`**

Add import and registration call:

```typescript
import { registerChatHandlers } from '../chat'
```

Add to `registerAllHandlers()`:

```typescript
registerChatHandlers()
```

- [ ] **Step 4: Modify `src/main/index.ts`**

Add imports:

```typescript
import { abortActiveChat } from './chat'
import { cleanupStaleSandboxes } from './chat/sandboxManager'
```

Add after `app.whenReady()` block (stale sandbox cleanup on startup):

```typescript
cleanupStaleSandboxes().catch(() => {})
```

Add before `app.on('window-all-closed')`:

```typescript
app.on('before-quit', () => {
  abortActiveChat()
})
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (SDK was installed in Task 5)

- [ ] **Step 6: Commit**

```bash
git add src/main/chat/chatHandler.ts src/main/chat/index.ts src/main/ipc/handlers.ts src/main/index.ts
git commit -m "feat(main): add chat IPC handlers with Claude Agent SDK integration"
```

---

## Task 7: Preload Bridge Extension

**Files:**

- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/electron.d.ts`

- [ ] **Step 1: Add chat API to `src/preload/index.ts`**

Add import:

```typescript
import type {
  ChatChunk,
  ChatSendParams,
  ClaudeStatus,
  CreateSandboxParams,
  SandboxResult,
} from '../shared/chat-types'
```

Add inside `contextBridge.exposeInMainWorld('electron', {` after the `sync` section:

```typescript
  // Chat API (Agent Chat Panel)
  chat: {
    detectClaude: async (): Promise<ClaudeStatus> =>
      typedInvoke('chat:detectClaude'),
    send: async (params: ChatSendParams): Promise<void> =>
      typedInvoke('chat:send', params),
    abort: async (): Promise<void> => typedInvoke('chat:abort'),
    createSandbox: async (params: CreateSandboxParams): Promise<SandboxResult> =>
      typedInvoke('chat:createSandbox', params),
    cleanupSandbox: async (sandboxPath: string): Promise<void> =>
      typedInvoke('chat:cleanupSandbox', sandboxPath),
    onChunk: (callback: (chunk: ChatChunk) => void) => {
      const handler = (_: Electron.IpcRendererEvent, chunk: ChatChunk) =>
        callback(chunk)
      ipcRenderer.on(IPC_CHANNELS.CHAT_CHUNK, handler)
      return () =>
        ipcRenderer.removeListener(IPC_CHANNELS.CHAT_CHUNK, handler)
    },
  },
```

- [ ] **Step 2: Add chat types to `src/renderer/src/types/electron.d.ts`**

Add import:

```typescript
import type {
  ChatChunk,
  ChatSendParams,
  ClaudeStatus,
  CreateSandboxParams,
  SandboxResult,
} from '../../../shared/chat-types'
```

Add inside `Window.electron` declaration after `sync`:

```typescript
      chat: {
        detectClaude: () => Promise<ClaudeStatus>
        send: (params: ChatSendParams) => Promise<void>
        abort: () => Promise<void>
        createSandbox: (params: CreateSandboxParams) => Promise<SandboxResult>
        cleanupSandbox: (sandboxPath: string) => Promise<void>
        onChunk: (callback: (chunk: ChatChunk) => void) => () => void
      }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (or note SDK import issue for Task 8)

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/src/types/electron.d.ts
git commit -m "feat(preload): expose chat API to renderer via context bridge"
```

---

## Task 8: Redux Chat Slice

**Files:**

- Create: `src/renderer/src/redux/slices/chatSlice.ts`
- Test: `src/renderer/src/redux/slices/chatSlice.test.ts`
- Modify: `src/renderer/src/redux/store.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/redux/slices/chatSlice.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/renderer/src/redux/slices/chatSlice.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

Create `src/renderer/src/redux/slices/chatSlice.ts`:

```typescript
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
```

- [ ] **Step 4: Add to store**

Modify `src/renderer/src/redux/store.ts`:

Add import:

```typescript
import chatReducer from './slices/chatSlice'
```

Add to `combineReducers`:

```typescript
  chat: chatReducer,
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- src/renderer/src/redux/slices/chatSlice.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/redux/slices/chatSlice.ts src/renderer/src/redux/slices/chatSlice.test.ts src/renderer/src/redux/store.ts
git commit -m "feat(renderer): add chatSlice Redux state management"
```

---

## Task 9: Chat Event Hook

**Files:**

- Create: `src/renderer/src/hooks/useChatNotification.ts`

- [ ] **Step 1: Create `src/renderer/src/hooks/useChatNotification.ts`**

Follow the exact pattern from `useUpdateNotification.ts`:

```typescript
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
 */
export function useChatNotification(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
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
  }, [dispatch])
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/hooks/useChatNotification.ts
git commit -m "feat(renderer): add useChatNotification hook for chat IPC events"
```

---

## Task 10: Chat UI Components

**Files:**

- Create: `src/renderer/src/components/chat/ClaudeStatusBanner.tsx`
- Create: `src/renderer/src/components/chat/SandboxBar.tsx`
- Create: `src/renderer/src/components/chat/ChatToolCall.tsx`
- Create: `src/renderer/src/components/chat/ChatMessageItem.tsx`
- Create: `src/renderer/src/components/chat/ChatMessageList.tsx`
- Create: `src/renderer/src/components/chat/ChatInput.tsx`
- Create: `src/renderer/src/components/chat/ChatPanel.tsx`

Build bottom-up: smallest components first, then compose.

- [ ] **Step 1: Create `ClaudeStatusBanner.tsx`**

```typescript
import { AlertCircle, RefreshCw } from 'lucide-react'

import { Button } from '../ui/button'

interface ClaudeStatusBannerProps {
  onRetry: () => void
}

/**
 * Banner shown when Claude Code is not detected on the system
 * Provides install instructions and retry button
 */
export function ClaudeStatusBanner({
  onRetry,
}: ClaudeStatusBannerProps): React.ReactElement {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertCircle className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">
          Claude Code not found
        </p>
        <p className="text-xs text-muted-foreground">
          Install with: npm install -g @anthropic-ai/claude-code
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-3 w-3 mr-1" />
        Retry Detection
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Create `SandboxBar.tsx`**

```typescript
import { FlaskConical, X } from 'lucide-react'

import { Button } from '../ui/button'

interface SandboxBarProps {
  sandboxPath: string
  skillName: string | null
  onClose: () => void
}

/**
 * Status bar showing active sandbox environment
 * Displays sandbox path and skill name with close button
 */
export function SandboxBar({
  sandboxPath,
  skillName,
  onClose,
}: SandboxBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border-b border-emerald-500/20">
      <FlaskConical className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-emerald-400 truncate">
          Sandbox{skillName ? `: ${skillName}` : ''}
        </p>
        <p className="text-[10px] text-muted-foreground truncate">
          {sandboxPath}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 hover:bg-emerald-500/20"
        onClick={onClose}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Create `ChatToolCall.tsx`**

```typescript
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface ChatToolCallProps {
  toolName: string
  input: string
  output: string | null
  status: 'running' | 'done' | 'error'
}

/**
 * Collapsible tool call display within an assistant message
 * Shows tool name, status indicator, and expandable input/output
 */
export function ChatToolCall({
  toolName,
  input,
  output,
  status,
}: ChatToolCallProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="my-1 rounded border border-border/50 bg-muted/30 text-xs">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-mono text-muted-foreground">{toolName}</span>
        {status === 'running' && (
          <Loader2 className="h-3 w-3 animate-spin text-blue-400 ml-auto" />
        )}
        {status === 'done' && (
          <span className="text-emerald-400 ml-auto">✓</span>
        )}
        {status === 'error' && (
          <span className="text-red-400 ml-auto">✗</span>
        )}
      </button>
      {isOpen && (
        <div className="px-2 pb-2 space-y-1">
          {input && (
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {input}
            </pre>
          )}
          {output && (
            <pre className="text-[10px] text-foreground/70 whitespace-pre-wrap break-all max-h-32 overflow-y-auto border-t border-border/30 pt-1">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `ChatMessageItem.tsx`**

```typescript
import { Bot, User } from 'lucide-react'

import { ChatToolCall } from './ChatToolCall'

interface ToolCallInfo {
  toolCallId: string
  toolName: string
  input: string
  output: string | null
  status: 'running' | 'done' | 'error'
}

interface ChatMessageItemProps {
  role: 'user' | 'assistant'
  content: string
  toolCalls: ToolCallInfo[]
}

/**
 * Single chat message bubble (user or assistant)
 * Assistant messages include tool call displays
 */
export function ChatMessageItem({
  role,
  content,
  toolCalls,
}: ChatMessageItemProps): React.ReactElement {
  const isUser = role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center ${
          isUser ? 'bg-primary/20' : 'bg-muted'
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div
        className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}
      >
        <div
          className={`inline-block text-sm rounded-lg px-3 py-2 max-w-full ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
        {toolCalls.map((tc) => (
          <ChatToolCall
            key={tc.toolCallId}
            toolName={tc.toolName}
            input={tc.input}
            output={tc.output}
            status={tc.status}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `ChatMessageList.tsx`**

```typescript
import { useEffect, useRef } from 'react'

import { ScrollArea } from '../ui/scroll-area'

import { ChatMessageItem } from './ChatMessageItem'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: {
    toolCallId: string
    toolName: string
    input: string
    output: string | null
    status: 'running' | 'done' | 'error'
  }[]
}

interface ChatMessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
}

/**
 * Scrollable list of chat messages with auto-scroll on new content
 */
export function ChatMessageList({
  messages,
  isStreaming,
}: ChatMessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">
          Ask about skills, get help managing them, or test them in a sandbox.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-3">
        {messages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            role={msg.role}
            content={msg.content}
            toolCalls={msg.toolCalls}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
```

- [ ] **Step 6: Create `ChatInput.tsx`**

```typescript
import { FlaskConical, Send, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../ui/button'

interface ChatInputProps {
  isStreaming: boolean
  sandboxActive: boolean
  onSend: (message: string) => void
  onAbort: () => void
  onCreateSandbox: () => void
  onClear: () => void
}

/**
 * Chat input with send/abort and action buttons (sandbox, clear)
 */
export function ChatInput({
  isStreaming,
  sandboxActive,
  onSend,
  onAbort,
  onCreateSandbox,
  onClear,
}: ChatInputProps): React.ReactElement {
  const [input, setInput] = useState('')

  const handleSubmit = (): void => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <div className="flex gap-2">
        <textarea
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={2}
          placeholder="Ask about skills..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button
            variant="destructive"
            size="icon"
            className="shrink-0 self-end"
            onClick={onAbort}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            className="shrink-0 self-end"
            onClick={handleSubmit}
            disabled={!input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex gap-1">
        {!sandboxActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onCreateSandbox}
            disabled={isStreaming}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Sandbox
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onClear}
          disabled={isStreaming}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Create `ChatPanel.tsx`**

```typescript
import { Bot } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addUserMessage,
  clearMessages,
  clearSandbox,
  setClaudeStatus,
  setSandbox,
} from '../../redux/slices/chatSlice'

import { ChatInput } from './ChatInput'
import { ChatMessageList } from './ChatMessageList'
import { ClaudeStatusBanner } from './ClaudeStatusBanner'
import { SandboxBar } from './SandboxBar'

/**
 * Agent Chat Panel — 4th column in Skills Desktop layout
 * Provides skill Q&A, management assistance, and sandbox testing
 */
export function ChatPanel(): React.ReactElement {
  const dispatch = useAppDispatch()
  const {
    messages,
    isStreaming,
    claudeAvailable,
    claudeVersion,
    sandboxPath,
    sandboxSkillName,
    error,
  } = useAppSelector((state) => state.chat)
  const { selectedSkill, items: skills } = useAppSelector((state) => state.skills)

  // Detect Claude on mount
  useEffect(() => {
    window.electron.chat.detectClaude().then((status) => {
      dispatch(setClaudeStatus(status))
    })
  }, [dispatch])

  const handleRetryDetection = useCallback(() => {
    window.electron.chat.detectClaude().then((status) => {
      dispatch(setClaudeStatus(status))
    })
  }, [dispatch])

  const handleSend = useCallback(
    async (message: string) => {
      dispatch(addUserMessage(message))

      const skillContext = skills.map((s) => ({
        name: s.name,
        description: s.description,
      }))

      // Read full SKILL.md content for the selected skill
      // files.read() returns SkillFileContent | null, extract .content
      let activeSkillContent: string | null = null
      if (selectedSkill) {
        try {
          const skillMdPath = `${selectedSkill.path}/SKILL.md`
          const fileResult = await window.electron.files.read(skillMdPath)
          activeSkillContent = fileResult?.content ?? null
        } catch {
          // Fallback to description if SKILL.md read fails
          activeSkillContent = selectedSkill.description ?? null
        }
      }

      window.electron.chat.send({
        message,
        sandboxPath,
        skillContext,
        activeSkillContent,
      })
    },
    [dispatch, skills, sandboxPath, selectedSkill],
  )

  const handleAbort = useCallback(() => {
    window.electron.chat.abort()
  }, [])

  const handleCreateSandbox = useCallback(() => {
    const skillName = selectedSkill?.name ?? null
    window.electron.chat.createSandbox({ skillName }).then((result) => {
      dispatch(setSandbox({ path: result.path, skillName }))
    })
  }, [dispatch, selectedSkill])

  const handleCloseSandbox = useCallback(() => {
    if (sandboxPath) {
      window.electron.chat.cleanupSandbox(sandboxPath).then(() => {
        dispatch(clearSandbox())
      })
    }
  }, [dispatch, sandboxPath])

  const handleClear = useCallback(() => {
    dispatch(clearMessages())
  }, [dispatch])

  return (
    <aside className="h-full border-l border-border bg-card flex flex-col overflow-hidden">
      {/* Draggable title bar area */}
      <div className="h-8 drag-region shrink-0" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Skills Assistant</span>
        {claudeVersion && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            v{claudeVersion}
          </span>
        )}
      </div>

      {/* Sandbox bar */}
      {sandboxPath && (
        <SandboxBar
          sandboxPath={sandboxPath}
          skillName={sandboxSkillName}
          onClose={handleCloseSandbox}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Main content */}
      {claudeAvailable === false ? (
        <ClaudeStatusBanner onRetry={handleRetryDetection} />
      ) : (
        <ChatMessageList messages={messages} isStreaming={isStreaming} />
      )}

      {/* Input */}
      {claudeAvailable !== false && (
        <ChatInput
          isStreaming={isStreaming}
          sandboxActive={!!sandboxPath}
          onSend={handleSend}
          onAbort={handleAbort}
          onCreateSandbox={handleCreateSandbox}
          onClear={handleClear}
        />
      )}
    </aside>
  )
}
```

- [ ] **Step 8: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/chat/
git commit -m "feat(ui): add ChatPanel components (messages, input, sandbox, tools)"
```

---

## Task 11: Layout Integration (App.tsx)

**Files:**

- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add ChatPanel to layout**

Update `src/renderer/src/App.tsx`:

```typescript
import { Panel, Group, Separator } from 'react-resizable-panels'
import { Toaster } from 'sonner'

import { ChatPanel } from './components/chat/ChatPanel'
import { DetailPanel } from './components/layout/DetailPanel'
import { MainContent } from './components/layout/MainContent'
import { Sidebar } from './components/layout/Sidebar'
import { TooltipProvider } from './components/ui/tooltip'
import { UpdateToast } from './components/UpdateToast'
import { useChatNotification } from './hooks/useChatNotification'
import { useUpdateNotification } from './hooks/useUpdateNotification'

/**
 * Skills Desktop main application component
 * Four-column layout: Sidebar (240px) | Main (resizable) | Detail (resizable) | Chat (resizable)
 * Theme application is handled by Redux listener middleware
 */
export default function App(): React.ReactElement {
  // Subscribe to auto-update IPC events
  useUpdateNotification()
  // Subscribe to chat chunk IPC events
  useChatNotification()

  return (
    <TooltipProvider delayDuration={200}>
      {/* Window glow effect - subtle inner shadow for depth */}
      <div className="flex h-screen bg-background text-foreground window-glow">
        <Sidebar />
        <Group orientation="horizontal" className="flex-1 h-full">
          <Panel defaultSize={35} minSize={15}>
            <MainContent />
          </Panel>
          <Separator className="bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize" />
          <Panel defaultSize={35} minSize={20}>
            <DetailPanel />
          </Panel>
          <Separator className="bg-border hover:bg-primary/50 active:bg-primary transition-colors cursor-col-resize" />
          {/* react-resizable-panels uses %, not px. 30% ≈ 320px on 1280px window */}
          <Panel defaultSize={30} minSize={15} maxSize={35}>
            <ChatPanel />
          </Panel>
        </Group>
      </div>
      {/* Auto-update toast notification */}
      <UpdateToast />
      {/* Sonner toast notifications */}
      <Toaster
        position="bottom-right"
        theme="dark"
        toastOptions={{
          className: 'bg-slate-800 border-slate-700 text-white',
        }}
      />
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: Run typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS — all existing + new tests pass

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat(ui): integrate ChatPanel as 4th column in layout"
```

---

## Task 12: Verification + Final Typecheck

- [ ] **Step 1: Run full verification suite**

Run (all four in sequence):

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: All PASS

- [ ] **Step 2: Start dev and verify UI via Electron MCP**

Run: `pnpm dev`

Verify with `mcp__electron__take_screenshot`:

- 4-column layout visible (Sidebar | Main | Detail | Chat)
- Chat panel shows "Skills Assistant" header
- Chat input area is visible
- If Claude Code is installed: version number shows in header
- If Claude Code is not installed: "Claude Code not found" banner shows

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address any issues from verification"
```

---

## Summary

| Task      | Component                       | Tests            | Est. Steps   |
| --------- | ------------------------------- | ---------------- | ------------ |
| 1         | Shared types + IPC contract     | — (compile-time) | 5            |
| 2         | Claude detector                 | 5 tests          | 5            |
| 3         | Sandbox manager                 | 7 tests          | 5            |
| 4         | Chat helpers                    | 4 tests          | 5            |
| 5         | SDK dependency                  | —                | 2            |
| 6         | Chat handler + IPC registration | — (integration)  | 6            |
| 7         | Preload bridge                  | — (compile-time) | 4            |
| 8         | Redux chatSlice                 | 10 tests         | 6            |
| 9         | Chat event hook                 | —                | 3            |
| 10        | Chat UI components (7 files)    | — (visual)       | 9            |
| 11        | Layout integration              | —                | 4            |
| 12        | Verification                    | —                | 3            |
| **Total** | **19 new files, 9 modified**    | **26 tests**     | **57 steps** |
