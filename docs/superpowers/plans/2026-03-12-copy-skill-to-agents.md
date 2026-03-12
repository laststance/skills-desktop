# Copy Skill to Agents — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable copying a skill from one agent to another via right-click context menu in Agent View.

**Architecture:** New IPC channel `skills:copyToAgents` with smart type detection (symlink → create symlink, local → fs.cp). Right-click DropdownMenu on SkillItem in agent view triggers a multi-select modal (CopyToAgentsModal) following existing AddSymlinkModal patterns.

**Tech Stack:** Electron IPC, React, Redux Toolkit, Radix DropdownMenu + Dialog, Vitest

---

## File Structure

| Action | File                                                       | Responsibility                                  |
| ------ | ---------------------------------------------------------- | ----------------------------------------------- |
| Modify | `src/shared/types.ts`                                      | Add `CopyToAgentsOptions`, `CopyToAgentsResult` |
| Modify | `src/shared/ipc-channels.ts`                               | Add `SKILLS_COPY_TO_AGENTS` channel             |
| Modify | `src/shared/ipc-contract.ts`                               | Add contract entry for `skills:copyToAgents`    |
| Modify | `src/shared/ipc-contract.test.ts`                          | Update invoke channel count (18 → 19)           |
| Modify | `src/main/ipc/skills.ts`                                   | Add `skills:copyToAgents` handler               |
| Modify | `src/preload/index.ts`                                     | Expose `copyToAgents` in context bridge         |
| Modify | `src/renderer/src/types/electron.d.ts`                     | Add `copyToAgents` to `Window.electron.skills`  |
| Modify | `src/renderer/src/redux/slices/skillsSlice.ts`             | Add `skillToCopy` state, `copyToAgents` thunk   |
| Modify | `src/renderer/src/components/skills/SkillItem.tsx`         | Add right-click DropdownMenu (agent view only)  |
| Create | `src/renderer/src/components/skills/CopyToAgentsModal.tsx` | Agent multi-select modal for copy target        |
| Modify | `src/renderer/src/components/layout/MainContent.tsx`       | Render `CopyToAgentsModal`                      |

---

## Chunk 1: Shared Types + IPC Contract

### Task 1: Add shared types

**Files:**

- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `CopyToAgentsOptions` and `CopyToAgentsResult` types**

Add after `CreateSymlinksResult` (around line 78):

```ts
/**
 * Options for copying a skill from one agent to other agents
 * @param skillName - Name of the skill to copy
 * @param linkPath - Full path to the skill in the source agent's directory
 * @param targetAgentIds - IDs of agents to copy the skill to
 * @example
 * { skillName: 'my-skill', linkPath: '/Users/me/.claude/skills/my-skill', targetAgentIds: ['cursor', 'windsurf'] }
 */
export interface CopyToAgentsOptions {
  skillName: string
  linkPath: string
  targetAgentIds: AgentId[]
}

/**
 * Result of copying a skill to multiple agents
 * @param success - true if all copies succeeded
 * @param copied - Number of agents successfully copied to
 * @param failures - Per-agent error details
 * @example
 * { success: true, copied: 2, failures: [] }
 * { success: false, copied: 1, failures: [{ agentId: 'codex', error: 'Already exists' }] }
 */
export interface CopyToAgentsResult {
  success: boolean
  copied: number
  failures: Array<{ agentId: AgentId; error: string }>
}
```

Note: `AgentId` is already defined in this file as a derived union type from `AGENT_DEFINITIONS`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (types only added, no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(shared): add CopyToAgentsOptions and CopyToAgentsResult types"
```

### Task 2: Add IPC channel constant

**Files:**

- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add `SKILLS_COPY_TO_AGENTS` to `IPC_CHANNELS`**

Add in the "Skills management" section (after `SKILLS_CREATE_SYMLINKS` around line 29):

```ts
  SKILLS_COPY_TO_AGENTS: 'skills:copyToAgents',
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat(shared): add SKILLS_COPY_TO_AGENTS IPC channel"
```

### Task 3: Add IPC contract entry

**Files:**

- Modify: `src/shared/ipc-contract.ts`

- [ ] **Step 1: Add contract entry for `skills:copyToAgents`**

Add after the `skills:createSymlinks` entry in `IpcInvokeContract`:

```ts
  'skills:copyToAgents': {
    args: [CopyToAgentsOptions]
    result: CopyToAgentsResult
  }
```

Also add `CopyToAgentsOptions` and `CopyToAgentsResult` to the import from `./types`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-contract.ts
git commit -m "feat(shared): add skills:copyToAgents to IPC invoke contract"
```

### Task 4: Update IPC contract test

**Files:**

- Modify: `src/shared/ipc-contract.test.ts`

- [ ] **Step 1: Add `SKILLS_COPY_TO_AGENTS` to the invoke channels array**

Add `IPC_CHANNELS.SKILLS_COPY_TO_AGENTS,` after `IPC_CHANNELS.SKILLS_CREATE_SYMLINKS,` (line 14).

Update the `toHaveLength` assertion from `18` to `19`.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm test -- src/shared/ipc-contract.test.ts`
Expected: PASS (2 tests, both passing)

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-contract.test.ts
git commit -m "test(shared): update IPC contract test for skills:copyToAgents (19 channels)"
```

---

## Chunk 2: Main Process Handler

### Task 5: Add `skills:copyToAgents` IPC handler

**Files:**

- Modify: `src/main/ipc/skills.ts`

- [ ] **Step 1: Write the handler**

Add inside `registerSkillsHandlers()`, after the `SKILLS_CREATE_SYMLINKS` handler:

```ts
/**
 * Copy a skill from one agent to other agents.
 * Symlinked skills → create symlink pointing to same source.
 * Local skills → physical copy (fs.cp recursive).
 * @param options - skillName, linkPath (source), targetAgentIds
 * @returns CopyToAgentsResult with copied count and per-agent failures
 * @example
 * // Symlink: creates symlink in target agent pointing to same source
 * // Local: copies folder recursively to target agent
 */
typedHandle(IPC_CHANNELS.SKILLS_COPY_TO_AGENTS, async (_, options) => {
  const { skillName, linkPath, targetAgentIds } = options
  let copied = 0
  const failures: Array<{
    agentId: (typeof targetAgentIds)[number]
    error: string
  }> = []

  // Detect source type
  let isSymlink = false
  let symlinkTarget = ''
  try {
    const stats = await fs.lstat(linkPath)
    if (stats.isSymbolicLink()) {
      isSymlink = true
      symlinkTarget = await fs.readlink(linkPath)
    } else if (!stats.isDirectory()) {
      return {
        success: false,
        copied: 0,
        failures: targetAgentIds.map((id) => ({
          agentId: id,
          error: 'Source is neither a symlink nor a directory',
        })),
      }
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Cannot access source skill'
    return {
      success: false,
      copied: 0,
      failures: targetAgentIds.map((id) => ({
        agentId: id,
        error: message,
      })),
    }
  }

  for (const agentId of targetAgentIds) {
    const agent = AGENTS.find((a) => a.id === agentId)
    if (!agent) {
      failures.push({ agentId, error: 'Agent not found' })
      continue
    }

    const destPath = join(agent.path, skillName)

    try {
      // Ensure agent skills directory exists
      await fs.mkdir(agent.path, { recursive: true })

      // Check if something already exists at the destination
      try {
        await fs.lstat(destPath)
        failures.push({ agentId, error: 'Already exists' })
        continue
      } catch {
        // Nothing exists, proceed
      }

      if (isSymlink) {
        await fs.symlink(symlinkTarget, destPath)
      } else {
        await fs.cp(linkPath, destPath, { recursive: true })
      }
      copied++
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error occurred'
      failures.push({ agentId, error: message })
    }
  }

  return { success: failures.length === 0, copied, failures }
})
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All existing tests pass (no behavior change to existing code)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/skills.ts
git commit -m "feat(main): add skills:copyToAgents IPC handler with symlink/copy detection"
```

---

## Chunk 3: Preload + Type Declarations

### Task 6: Expose `copyToAgents` in preload context bridge

**Files:**

- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add `copyToAgents` to the `skills` section**

Add after `createSymlinks` (around line 32):

```ts
    copyToAgents: async (
      options: Parameters<typeof typedInvoke<'skills:copyToAgents'>>[1],
    ) => typedInvoke('skills:copyToAgents', options),
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose skills:copyToAgents via context bridge"
```

### Task 7: Update renderer type declarations

**Files:**

- Modify: `src/renderer/src/types/electron.d.ts`

- [ ] **Step 1: Add import for new types**

Add `CopyToAgentsOptions` and `CopyToAgentsResult` to the import from `'../../../shared/types'`.

- [ ] **Step 2: Add `copyToAgents` method to `Window.electron.skills`**

Add after `createSymlinks` (around line 46):

```ts
copyToAgents: (options: CopyToAgentsOptions) => Promise<CopyToAgentsResult>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/types/electron.d.ts
git commit -m "feat(renderer): add copyToAgents to electron type declarations"
```

---

## Chunk 4: Redux State + Async Thunk

### Task 8: Add `skillToCopy` state and `copyToAgents` thunk to skillsSlice

**Files:**

- Modify: `src/renderer/src/redux/slices/skillsSlice.ts`

- [ ] **Step 1: Add state fields to `SkillsState` interface**

Add after `addingSymlinks: boolean`:

```ts
/** Skill to copy to other agents (opens CopyToAgentsModal) */
skillToCopy: Skill | null
/** Whether copy operation is in progress */
copying: boolean
```

- [ ] **Step 2: Add initial state values**

Add to `initialState` after `addingSymlinks: false`:

```ts
  skillToCopy: null,
  copying: false,
```

- [ ] **Step 3: Add `copyToAgents` async thunk**

Add after the `createSymlinks` thunk definition:

```ts
export const copyToAgents = createAsyncThunk(
  'skills/copyToAgents',
  async (params: { skill: Skill; linkPath: string; agentIds: AgentId[] }) => {
    const { skill, linkPath, agentIds } = params
    const result = await window.electron.skills.copyToAgents({
      skillName: skill.name,
      linkPath,
      targetAgentIds: agentIds,
    })
    if (!result.success && result.copied === 0) {
      throw new Error('Failed to copy to any agent')
    }
    return {
      skillName: skill.name,
      copied: result.copied,
      failures: result.failures,
    }
  },
)
```

- [ ] **Step 4: Add reducers**

Add in `reducers` section:

```ts
    setSkillToCopy: (state, action: PayloadAction<Skill | null>) => {
      state.skillToCopy = action.payload
    },
```

- [ ] **Step 5: Add extraReducers for `copyToAgents` thunk**

Add in the `extraReducers` builder chain:

```ts
      .addCase(copyToAgents.pending, (state) => {
        state.copying = true
      })
      .addCase(copyToAgents.fulfilled, (state) => {
        state.copying = false
        state.skillToCopy = null
      })
      .addCase(copyToAgents.rejected, (state) => {
        state.copying = false
      })
```

- [ ] **Step 6: Export the new action**

Add `setSkillToCopy` to the destructured exports from `skillsSlice.actions`.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/redux/slices/skillsSlice.ts
git commit -m "feat(redux): add skillToCopy state and copyToAgents async thunk"
```

---

## Chunk 5: CopyToAgentsModal Component

### Task 9: Create CopyToAgentsModal

**Files:**

- Create: `src/renderer/src/components/skills/CopyToAgentsModal.tsx`

Reference: Follow `AddSymlinkModal.tsx` patterns exactly.

- [ ] **Step 1: Write the component**

```tsx
import { Copy, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { AgentId } from '../../../../shared/types'
import { UNIVERSAL_FILTER_ID } from '../../../../shared/constants'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  copyToAgents,
  setSkillToCopy,
  fetchSkills,
} from '../../redux/slices/skillsSlice'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import { fetchSourceStats } from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'

/**
 * Modal for selecting target agents when copying a skill from one agent to others.
 * Triggered by right-click "Copy to..." on a skill card in Agent View.
 * @example
 * // Rendered in MainContent.tsx alongside other dialogs
 * <CopyToAgentsModal />
 */
export function CopyToAgentsModal(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { skillToCopy, copying } = useAppSelector((state) => state.skills)
  const { selectedAgentId } = useAppSelector((state) => state.ui)
  const { items: agents } = useAppSelector((state) => state.agents)

  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>([])

  const existingAgents = useMemo(() => agents.filter((a) => a.exists), [agents])

  /** Agent IDs where this skill already exists (valid symlink or local) */
  const alreadyExistsAgentIds = useMemo(() => {
    if (!skillToCopy) return new Set<AgentId>()
    return new Set(
      skillToCopy.symlinks
        .filter((s) => s.status === 'valid' || s.isLocal)
        .map((s) => s.agentId),
    )
  }, [skillToCopy])

  /** The linkPath of the skill in the source agent */
  const sourceLinkPath = useMemo(() => {
    if (!skillToCopy || !selectedAgentId) return null
    const symlink = skillToCopy.symlinks.find(
      (s) => s.agentId === selectedAgentId,
    )
    return symlink?.linkPath ?? null
  }, [skillToCopy, selectedAgentId])

  const handleClose = (): void => {
    if (!copying) {
      dispatch(setSkillToCopy(null))
      setSelectedAgents([])
    }
  }

  const handleAgentToggle = (agentId: AgentId): void => {
    if (alreadyExistsAgentIds.has(agentId)) return
    setSelectedAgents((prev) =>
      prev.includes(agentId)
        ? prev.filter((id) => id !== agentId)
        : [...prev, agentId],
    )
  }

  const handleCopy = async (): Promise<void> => {
    if (!skillToCopy || !sourceLinkPath || selectedAgents.length === 0) return

    const result = await dispatch(
      copyToAgents({
        skill: skillToCopy,
        linkPath: sourceLinkPath,
        agentIds: selectedAgents,
      }),
    )

    if (copyToAgents.fulfilled.match(result)) {
      if (result.payload.failures.length > 0) {
        toast.warning(
          `Copied to ${result.payload.copied} agent(s), ${result.payload.failures.length} failed`,
          {
            description: result.payload.failures
              .map((f) => `${f.agentId}: ${f.error}`)
              .join(', '),
          },
        )
      } else {
        toast.success(`Copied to ${result.payload.copied} agent(s)`, {
          description: `${skillToCopy.name} copied successfully`,
        })
      }
      dispatch(fetchSkills())
      dispatch(fetchAgents())
      dispatch(fetchSourceStats())
    } else {
      toast.error('Failed to copy skill', {
        description: result.error?.message || 'An unexpected error occurred',
      })
    }
  }

  const hasNewSelections = selectedAgents.length > 0

  return (
    <Dialog
      open={!!skillToCopy}
      onOpenChange={(open) => !open && handleClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Copy to Agents
          </DialogTitle>
          <DialogDescription>
            Select agents to copy <strong>{skillToCopy?.name}</strong> to.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 overflow-y-auto space-y-2 py-2">
          {existingAgents
            .filter(
              (agent) =>
                agent.id !== selectedAgentId &&
                agent.id !== UNIVERSAL_FILTER_ID,
            )
            .map((agent) => {
              const alreadyExists = alreadyExistsAgentIds.has(agent.id)
              return (
                <label
                  key={agent.id}
                  className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                    alreadyExists
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-accent cursor-pointer'
                  }`}
                >
                  <Checkbox
                    checked={alreadyExists || selectedAgents.includes(agent.id)}
                    disabled={alreadyExists || copying}
                    onCheckedChange={() => handleAgentToggle(agent.id)}
                  />
                  <span className="text-sm">
                    {agent.name}
                    {alreadyExists && (
                      <span className="text-xs text-muted-foreground ml-2">
                        already exists
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={copying}>
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={!hasNewSelections || copying}>
            {copying && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {copying
              ? 'Copying...'
              : `Copy to ${selectedAgents.length} agent(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/skills/CopyToAgentsModal.tsx
git commit -m "feat(renderer): add CopyToAgentsModal component"
```

### Task 10: Render CopyToAgentsModal in MainContent

**Files:**

- Modify: `src/renderer/src/components/layout/MainContent.tsx`

- [ ] **Step 1: Import and render the modal**

Add import:

```ts
import { CopyToAgentsModal } from '../skills/CopyToAgentsModal'
```

Add `<CopyToAgentsModal />` in the `{/* Dialogs */}` section after `<AddSymlinkModal />` (line 123).

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/layout/MainContent.tsx
git commit -m "feat(renderer): render CopyToAgentsModal in MainContent"
```

---

## Chunk 6: SkillItem Right-click Context Menu

### Task 11: Add right-click DropdownMenu to SkillItem

**Files:**

- Modify: `src/renderer/src/components/skills/SkillItem.tsx`

This follows the exact same pattern as `AgentItem.tsx`: Radix DropdownMenu with `onOpenChange` guarded to only allow close, opened via `handleContextMenu`.

- [ ] **Step 1: Add imports**

Add to existing imports:

```ts
import { useState } from 'react'
import { Copy } from 'lucide-react'
import { setSkillToCopy } from '../../redux/slices/skillsSlice'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { UNIVERSAL_FILTER_ID } from '../../../../shared/constants'
```

- [ ] **Step 2: Add context menu state and handlers**

Inside `SkillItem` function, add after the existing handler functions:

```ts
const [contextOpen, setContextOpen] = useState(false)

// Show context menu only in agent view (not global, not universal)
const showContextMenu =
  !!selectedAgentId && selectedAgentId !== UNIVERSAL_FILTER_ID

const handleContextMenu = (e: React.MouseEvent): void => {
  e.preventDefault()
  if (!showContextMenu) return
  setContextOpen(true)
}

const handleCopyClick = (): void => {
  dispatch(setSkillToCopy(skill))
  setContextOpen(false)
}
```

- [ ] **Step 3: Wrap the Card JSX with conditional DropdownMenu**

Replace the `<Card ...>` wrapper. If `showContextMenu` is true, wrap with DropdownMenu. Otherwise, render Card directly.

The cleanest approach: always wrap with DropdownMenu but only open via right-click in agent view. The Card becomes the DropdownMenuTrigger:

```tsx
return (
  <DropdownMenu
    open={contextOpen}
    onOpenChange={(open) => {
      if (!open) setContextOpen(false)
    }}
  >
    <DropdownMenuTrigger asChild disabled={!showContextMenu}>
      <Card
        className={cn(
          'group cursor-pointer transition-colors hover:border-primary/50 relative',
          isSelected && 'border-primary bg-primary/5',
          isLinked && 'border-l-2 border-l-cyan-400/40',
          isLocalSkill && 'border-l-2 border-l-emerald-400/40',
        )}
        onClick={() => dispatch(selectSkill(skill))}
        onContextMenu={handleContextMenu}
      >
        {/* ... existing Card content unchanged ... */}
      </Card>
    </DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem onClick={handleCopyClick}>
        <Copy className="h-4 w-4 mr-2" />
        Copy to...
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Run lint**

Run: `pnpm lint`
Expected: PASS (or fix any lint issues)

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: All tests pass (66+ tests)

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/skills/SkillItem.tsx
git commit -m "feat(renderer): add right-click context menu with 'Copy to...' on SkillItem"
```

---

## Chunk 7: skillItemHelpers Test Update

### Task 12: Add `showCopyButton` to skillItemHelpers

The `getSkillItemVisibility` function should also return whether the "Copy to..." context menu is available. This keeps the logic testable as a pure function.

**Files:**

- Modify: `src/renderer/src/components/skills/skillItemHelpers.ts`
- Modify: `src/renderer/src/components/skills/skillItemHelpers.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `skillItemHelpers.test.ts`:

```ts
describe('showCopyButton', () => {
  it('returns false when no agent is selected (global view)', () => {
    const result = getSkillItemVisibility(null, [validSymlink])
    expect(result.showCopyButton).toBe(false)
  })

  it('returns false when universal filter is selected', () => {
    const result = getSkillItemVisibility('universal', [validSymlink])
    expect(result.showCopyButton).toBe(false)
  })

  it('returns true when a specific agent is selected with a valid symlink', () => {
    const result = getSkillItemVisibility('claude', [validSymlink])
    expect(result.showCopyButton).toBe(true)
  })

  it('returns true when a specific agent is selected with a local skill', () => {
    const localSkill = {
      ...validSymlink,
      isLocal: true,
      status: 'valid' as const,
    }
    const result = getSkillItemVisibility('claude', [localSkill])
    expect(result.showCopyButton).toBe(true)
  })
})
```

Note: Use existing test fixtures (`validSymlink` etc.) already defined in the test file. Adjust fixture references to match existing patterns.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/renderer/src/components/skills/skillItemHelpers.test.ts`
Expected: FAIL — `showCopyButton` not in result

- [ ] **Step 3: Add `showCopyButton` to `SkillItemVisibility` and `getSkillItemVisibility`**

In `skillItemHelpers.ts`, add `showCopyButton: boolean` to the `SkillItemVisibility` interface.

In the `getSkillItemVisibility` return object, add:

```ts
    showCopyButton:
      !!selectedAgentId &&
      selectedAgentId !== UNIVERSAL_FILTER_ID &&
      (!!selectedAgentSymlink || isLocalSkill),
```

Add import for `UNIVERSAL_FILTER_ID` from `'../../../../shared/constants'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/renderer/src/components/skills/skillItemHelpers.test.ts`
Expected: PASS

- [ ] **Step 5: Update SkillItem to use `showCopyButton` from helper**

In `SkillItem.tsx`, replace the inline `showContextMenu` computation with:

```ts
const { showCopyButton, ... } = getSkillItemVisibility(selectedAgentId, skill.symlinks)
```

Use `showCopyButton` instead of `showContextMenu` for the DropdownMenu visibility.

- [ ] **Step 6: Run typecheck and all tests**

Run: `pnpm typecheck && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/skills/skillItemHelpers.ts src/renderer/src/components/skills/skillItemHelpers.test.ts src/renderer/src/components/skills/SkillItem.tsx
git commit -m "feat: add showCopyButton to skillItemHelpers with tests"
```

---

## Chunk 8: Verification

### Task 13: Full verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Manual UI verification**

Start the app and verify with Electron MCP:

```bash
pnpm dev
```

1. Click an agent in sidebar (e.g., Claude Code)
2. Right-click a skill card → "Copy to..." menu appears
3. Click "Copy to..." → CopyToAgentsModal opens with agent checkboxes
4. Source agent is hidden, already-linked agents are disabled
5. Select target agents → click "Copy" → toast notification
6. Verify skill appears in target agent's view
7. Verify right-click does NOT appear in global view or universal view

- [ ] **Step 5: Commit any fixes from verification**

```bash
git add -A
git commit -m "fix: address UI issues found during verification"
```
