import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import type {
  AgentId,
  BulkDeleteResult,
  BulkUnlinkResult,
  Skill,
  SkillName,
  SymlinkInfo,
  TombstoneId,
} from '../../../../shared/types'
import type { RootState } from '../store'

/**
 * Redux state for the Installed Skills feature area.
 * Pairs 'currently selected' entities with per-operation in-flight flags
 * so the UI can disable inputs and show spinners deterministically.
 *
 * Bulk selection fields model the user's checkbox selection, the anchor for
 * Shift+click range extension, and per-name in-flight sets that the list
 * consults to render rows at 50% opacity during an IPC round-trip. The
 * coarse `bulkDeleting` / `bulkUnlinking` booleans gate the toolbar's
 * buttons; `bulkProgress` is populated by the `skills:deleteProgress` event
 * when the batch is large enough to warrant a live counter.
 */
interface SkillsState {
  /** All skills discovered under ~/.agents/skills/. */
  items: Skill[]
  /** Skill highlighted in the list (null = no selection). */
  selectedSkill: Skill | null
  /** true while the initial `fetchSkills` is in flight. */
  loading: boolean
  /** Human-readable error from the last failed thunk. */
  error: string | null
  /** Skill + symlink queued for unlink confirmation (modal target). */
  skillToUnlink: { skill: Skill; symlink: SymlinkInfo } | null
  /** true while an unlink IPC round-trip is in flight. */
  unlinking: boolean
  /** Skill targeted by the AddSymlinkModal. */
  skillToAddSymlinks: Skill | null
  /** true while createSymlinks is in flight. */
  addingSymlinks: boolean
  /** Skill targeted by the CopyToAgentsModal. */
  skillToCopy: Skill | null
  /** true while copyToAgents is in flight. */
  copying: boolean

  /** Names of skills currently ticked in the list. Source of truth for toolbar visibility. */
  selectedSkillNames: SkillName[]
  /** Last single-click origin used for Shift+click range selection. */
  selectionAnchor: SkillName | null
  /** Names currently in-flight for bulk delete (row fades while present). */
  inFlightDeleteNames: SkillName[]
  /** Names currently in-flight for bulk unlink (row fades while present). */
  inFlightUnlinkNames: SkillName[]
  /** true while a batch delete thunk is between .pending and settled. */
  bulkDeleting: boolean
  /** true while a batch unlink thunk is between .pending and settled. */
  bulkUnlinking: boolean
  /** Progress counter emitted by main for batches with total >= 10. */
  bulkProgress: { current: number; total: number } | null
}

const initialState: SkillsState = {
  items: [],
  selectedSkill: null,
  loading: false,
  error: null,
  skillToUnlink: null,
  unlinking: false,
  skillToAddSymlinks: null,
  addingSymlinks: false,
  skillToCopy: null,
  copying: false,
  selectedSkillNames: [],
  selectionAnchor: null,
  inFlightDeleteNames: [],
  inFlightUnlinkNames: [],
  bulkDeleting: false,
  bulkUnlinking: false,
  bulkProgress: null,
}

/**
 * Intersect a dispatched-names list with the live `state.items` set so a late
 * `fetchSkills.fulfilled` landing between click and thunk dispatch cannot turn
 * a valid request into a 500 on a ghost skill. Used by the bulk-delete and
 * bulk-unlink `.pending` reducers, which both need the same reconciliation.
 *
 * @param items - Current `state.items` (source of "currently installed")
 * @param names - Names the user selected at click-time
 * @returns `names` filtered to those still present in `items`
 * @example
 * reconcileByLiveNames(state.items, action.meta.arg) // deleteSelectedSkills.pending
 */
function reconcileByLiveNames(
  items: readonly Skill[],
  names: readonly SkillName[],
): SkillName[] {
  const liveNames = new Set(items.map((skill) => skill.name))
  return names.filter((name) => liveNames.has(name))
}

/**
 * Fetch all skills from the main process
 * @returns Promise<Skill[]> - Array of skill objects from ~/.agents/skills/
 */
export const fetchSkills = createAsyncThunk('skills/fetchAll', async () => {
  return window.electron.skills.getAll()
})

/**
 * Unlink a skill from a specific agent
 * @param params - skill and symlink info
 * @returns Promise with success status
 */
export const unlinkSkillFromAgent = createAsyncThunk(
  'skills/unlinkFromAgent',
  async (params: { skill: Skill; symlink: SymlinkInfo }) => {
    const { skill, symlink } = params
    const result = await window.electron.skills.unlinkFromAgent({
      skillName: skill.name,
      agentId: symlink.agentId,
      linkPath: symlink.linkPath,
    })
    if (!result.success) {
      throw new Error(result.error || 'Failed to unlink skill')
    }
    return { skillName: skill.name, agentName: symlink.agentName }
  },
)

/**
 * Create symlinks for a skill to multiple agents
 * @param params - skill and target agent IDs
 * @returns Created count and failures
 */
export const createSymlinks = createAsyncThunk(
  'skills/createSymlinks',
  async (params: { skill: Skill; agentIds: AgentId[] }) => {
    const { skill, agentIds } = params
    const result = await window.electron.skills.createSymlinks({
      skillName: skill.name,
      skillPath: skill.path,
      agentIds,
    })
    if (!result.success && result.created === 0) {
      throw new Error('Failed to create any symlinks')
    }
    return {
      skillName: skill.name,
      created: result.created,
      failures: result.failures,
    }
  },
)

/**
 * Copy a skill from one agent to other agents
 * @param params - skill, linkPath of source, and target agent IDs
 * @returns Copied count and failures
 */
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

/**
 * Delete every selected skill in a single batch. Serial execution happens in
 * main; the renderer receives a `BulkDeleteResult` with a per-item outcome.
 *
 * The thunk does NOT narrow `selectedSkillNames` by itself — the caller is
 * expected to pass in exactly the names that should be deleted. The
 * `.pending` reducer intersects the passed list with `state.items` to
 * reconcile against any fresh `fetchSkills` that landed between the user
 * click and thunk dispatch.
 * @param selectedNames - Names to delete (already validated by caller).
 * @returns BulkDeleteResult with per-item outcome
 * @example
 * await dispatch(deleteSelectedSkills(['task', 'browse']))
 */
export const deleteSelectedSkills = createAsyncThunk<
  BulkDeleteResult,
  SkillName[]
>('skills/deleteSelected', async (selectedNames) => {
  const result = await window.electron.skills.deleteSkills({
    items: selectedNames.map((skillName) => ({ skillName })),
  })
  return result
})

/**
 * Unlink every selected skill from a single agent. No tombstone produced —
 * unlink is benign (removes one symlink/folder, keeps source intact).
 * @param params - agentId + names to unlink
 * @returns BulkUnlinkResult with per-item outcome
 * @example
 * await dispatch(unlinkSelectedFromAgent({ agentId: 'cursor', selectedNames: ['task'] }))
 */
export const unlinkSelectedFromAgent = createAsyncThunk<
  BulkUnlinkResult,
  { agentId: AgentId; selectedNames: SkillName[] }
>('skills/unlinkSelectedFromAgent', async ({ agentId, selectedNames }) => {
  const result = await window.electron.skills.unlinkManyFromAgent({
    agentId,
    items: selectedNames.map((skillName) => ({ skillName })),
  })
  return result
})

/**
 * Restore the last batch of tombstoned deletes by calling the main-process
 * trashService once per tombstone. Runs serially because each call may fail
 * independently (collision, trash already evicted). Aggregates the results
 * and surfaces the per-item outcome array to the caller so the UndoToast can
 * report partial restore counts.
 *
 * Session-scoped: if the app is restarted, the tombstoneIds referenced here
 * are gone (in-memory only, Redux is not persisted per store.ts:33 whitelist),
 * so the only entry point for calling undoLastBulkDelete is a live UndoToast.
 * @param tombstoneIds - The trash entry ids from the most recent bulk delete.
 * @returns Array of per-item restore outcomes, index-aligned with input.
 * @example
 * await dispatch(undoLastBulkDelete(['1729...-task-a1b2c3d4']))
 */
export const undoLastBulkDelete = createAsyncThunk(
  'skills/undoLastBulkDelete',
  async (tombstoneIds: TombstoneId[]) => {
    const outcomes: Array<{
      tombstoneId: TombstoneId
      result: Awaited<
        ReturnType<typeof window.electron.skills.restoreDeletedSkill>
      >
    }> = []
    // Serial: each restore is an fs op; parallelism offers no real gain and
    // makes failure attribution harder.
    for (const tombstoneId of tombstoneIds) {
      const result = await window.electron.skills.restoreDeletedSkill({
        tombstoneId,
      })
      outcomes.push({ tombstoneId, result })
    }
    return outcomes
  },
)

const skillsSlice = createSlice({
  name: 'skills',
  initialState,
  reducers: {
    selectSkill: (state, action: PayloadAction<Skill | null>) => {
      state.selectedSkill = action.payload
    },
    setSkillToUnlink: (
      state,
      action: PayloadAction<{ skill: Skill; symlink: SymlinkInfo } | null>,
    ) => {
      state.skillToUnlink = action.payload
    },
    setSkillToAddSymlinks: (state, action: PayloadAction<Skill | null>) => {
      state.skillToAddSymlinks = action.payload
    },
    setSkillToCopy: (state, action: PayloadAction<Skill | null>) => {
      state.skillToCopy = action.payload
    },
    /**
     * Toggle a single skill in `selectedSkillNames` and update the anchor.
     * Called by the checkbox onChange in SkillItem.
     */
    toggleSelection: (state, action: PayloadAction<SkillName>) => {
      const skillName = action.payload
      const existingIndex = state.selectedSkillNames.indexOf(skillName)
      if (existingIndex === -1) {
        state.selectedSkillNames.push(skillName)
      } else {
        state.selectedSkillNames.splice(existingIndex, 1)
      }
      state.selectionAnchor = skillName
    },
    /**
     * Extend `selectedSkillNames` with every visible name between the anchor
     * and the target (inclusive). Payload is precomputed by the component
     * because the slice does not know the ordered visible list.
     */
    selectRange: (state, action: PayloadAction<SkillName[]>) => {
      const namesInRange = action.payload
      const existingSet = new Set(state.selectedSkillNames)
      for (const skillName of namesInRange) {
        if (!existingSet.has(skillName)) {
          state.selectedSkillNames.push(skillName)
          existingSet.add(skillName)
        }
      }
      // Anchor advances to the most recent shift-click target
      const lastTargetName = namesInRange[namesInRange.length - 1]
      if (lastTargetName) {
        state.selectionAnchor = lastTargetName
      }
    },
    /**
     * Replace the selection with the given visible names (Cmd/Ctrl+A).
     * Passing an empty array effectively clears the selection.
     */
    selectAll: (state, action: PayloadAction<SkillName[]>) => {
      state.selectedSkillNames = [...action.payload]
      state.selectionAnchor =
        action.payload.length > 0
          ? action.payload[action.payload.length - 1]
          : null
    },
    /**
     * Clear the selection + anchor (Esc key, row deselect outside bounds, or
     * cross-context switch — agent change, tab change, sync preview start).
     */
    clearSelection: (state) => {
      state.selectedSkillNames = []
      state.selectionAnchor = null
    },
    /**
     * Update the bulk progress counter. Dispatched by the MainContent effect
     * that subscribes to `window.electron.skills.onDeleteProgress`. Pass null
     * to clear (e.g. on thunk settled).
     */
    setBulkProgress: (
      state,
      action: PayloadAction<{ current: number; total: number } | null>,
    ) => {
      state.bulkProgress = action.payload
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSkills.pending, (state) => {
        state.loading = true
        state.error = null
      })
      .addCase(fetchSkills.fulfilled, (state, action) => {
        state.items = action.payload
        state.loading = false
      })
      .addCase(fetchSkills.rejected, (state, action) => {
        state.loading = false
        state.error = action.error.message || 'Failed to fetch skills'
      })
      // Unlink skill from agent
      .addCase(unlinkSkillFromAgent.pending, (state) => {
        state.unlinking = true
      })
      .addCase(unlinkSkillFromAgent.fulfilled, (state, action) => {
        state.unlinking = false
        if (state.selectedSkill?.name === action.payload.skillName) {
          state.selectedSkill = null
        }
        state.skillToUnlink = null
      })
      .addCase(unlinkSkillFromAgent.rejected, (state, action) => {
        state.unlinking = false
        state.error = action.error.message ?? 'Failed to unlink skill'
      })
      // Create symlinks
      .addCase(createSymlinks.pending, (state) => {
        state.addingSymlinks = true
      })
      .addCase(createSymlinks.fulfilled, (state) => {
        state.addingSymlinks = false
        state.skillToAddSymlinks = null
      })
      .addCase(createSymlinks.rejected, (state, action) => {
        state.addingSymlinks = false
        state.error = action.error.message ?? 'Failed to create symlinks'
      })
      // Copy to agents
      .addCase(copyToAgents.pending, (state) => {
        state.copying = true
      })
      .addCase(copyToAgents.fulfilled, (state) => {
        state.copying = false
        state.skillToCopy = null
      })
      .addCase(copyToAgents.rejected, (state, action) => {
        state.copying = false
        state.error = action.error.message ?? 'Failed to copy skill'
      })
      .addCase(deleteSelectedSkills.pending, (state, action) => {
        state.inFlightDeleteNames = reconcileByLiveNames(
          state.items,
          action.meta.arg,
        )
        state.bulkDeleting = true
        state.error = null
      })
      .addCase(deleteSelectedSkills.fulfilled, (state) => {
        // Refetch happens via the component (thunks.ts refreshAllData); the
        // slice only clears the in-flight fade and releases the toolbar.
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        state.selectedSkillNames = []
        state.selectionAnchor = null
      })
      .addCase(deleteSelectedSkills.rejected, (state, action) => {
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        state.error = action.error.message ?? 'Bulk delete failed'
      })
      .addCase(unlinkSelectedFromAgent.pending, (state, action) => {
        state.inFlightUnlinkNames = reconcileByLiveNames(
          state.items,
          action.meta.arg.selectedNames,
        )
        state.bulkUnlinking = true
        state.error = null
      })
      .addCase(unlinkSelectedFromAgent.fulfilled, (state) => {
        state.inFlightUnlinkNames = []
        state.bulkUnlinking = false
        state.selectedSkillNames = []
        state.selectionAnchor = null
      })
      .addCase(unlinkSelectedFromAgent.rejected, (state, action) => {
        state.inFlightUnlinkNames = []
        state.bulkUnlinking = false
        state.error = action.error.message ?? 'Bulk unlink failed'
      })
      // undoLastBulkDelete.fulfilled is handled via the fetchSkills refetch
      // that follows; only the rejection path mutates slice state.
      .addCase(undoLastBulkDelete.rejected, (state, action) => {
        state.error = action.error.message ?? 'Undo failed'
      })
  },
})

export const {
  selectSkill,
  setSkillToUnlink,
  setSkillToAddSymlinks,
  setSkillToCopy,
  toggleSelection,
  selectRange,
  selectAll,
  clearSelection,
  setBulkProgress,
} = skillsSlice.actions
export default skillsSlice.reducer

// --- Named selectors ---
export const selectSkillsItems = (state: RootState): Skill[] =>
  state.skills.items
export const selectSkillsLoading = (state: RootState): boolean =>
  state.skills.loading
export const selectSkillsError = (state: RootState): string | null =>
  state.skills.error
export const selectSelectedSkill = (state: RootState): Skill | null =>
  state.skills.selectedSkill
export const selectSkillToUnlink = (
  state: RootState,
): { skill: Skill; symlink: SymlinkInfo } | null => state.skills.skillToUnlink
export const selectSkillsUnlinking = (state: RootState): boolean =>
  state.skills.unlinking
export const selectSkillToAddSymlinks = (state: RootState): Skill | null =>
  state.skills.skillToAddSymlinks
export const selectSkillsAddingSymlinks = (state: RootState): boolean =>
  state.skills.addingSymlinks
export const selectSkillToCopy = (state: RootState): Skill | null =>
  state.skills.skillToCopy
export const selectSkillsCopying = (state: RootState): boolean =>
  state.skills.copying
export const selectSelectedSkillNames = (state: RootState): SkillName[] =>
  state.skills.selectedSkillNames
export const selectSelectionAnchor = (state: RootState): SkillName | null =>
  state.skills.selectionAnchor
export const selectInFlightDeleteNames = (state: RootState): SkillName[] =>
  state.skills.inFlightDeleteNames
export const selectInFlightUnlinkNames = (state: RootState): SkillName[] =>
  state.skills.inFlightUnlinkNames
export const selectBulkDeleting = (state: RootState): boolean =>
  state.skills.bulkDeleting
export const selectBulkUnlinking = (state: RootState): boolean =>
  state.skills.bulkUnlinking
export const selectBulkProgress = (
  state: RootState,
): { current: number; total: number } | null => state.skills.bulkProgress
