import type { PayloadAction } from '@reduxjs/toolkit'
import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type {
  AbsolutePath,
  AgentId,
  BulkCopyToAgentsResult,
  BulkDeleteResult,
  BulkUnlinkResult,
  ClearOrphanSymlinksResult,
  ClearBrokenSymlinkSlotsOptions,
  ClearBrokenSymlinkSlotsResult,
  FilesystemEntryIdentity,
  RestoreDeletedSkillResult,
  Skill,
  SkillName,
  SymlinkInfo,
  TombstoneId,
} from '@/shared/types'

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
  /** Agent IDs checked in the AddSymlinkModal. */
  selectedAddAgentIds: AgentId[]
  /** true while createSymlinks is in flight. */
  addingSymlinks: boolean
  /** Skill targeted by the CopyToAgentsModal. */
  skillToCopy: Skill | null
  /** Agent IDs checked in the CopyToAgentsModal. */
  selectedCopyAgentIds: AgentId[]
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
  /** true while a batch copy-to-agents thunk is between .pending and settled. */
  bulkCopying: boolean
  /** true while the BulkCopyToAgentsModal (global-view multi-skill copy) is open. */
  bulkCopyModalOpen: boolean
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
  selectedAddAgentIds: [],
  addingSymlinks: false,
  skillToCopy: null,
  selectedCopyAgentIds: [],
  copying: false,
  selectedSkillNames: [],
  selectionAnchor: null,
  inFlightDeleteNames: [],
  inFlightUnlinkNames: [],
  bulkDeleting: false,
  bulkUnlinking: false,
  bulkCopying: false,
  bulkCopyModalOpen: false,
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

export type DeleteSelectedSkillTarget = {
  skillName: SkillName
  skillPath: AbsolutePath
  filesystemIdentity: FilesystemEntryIdentity
}

export type UnlinkSelectedSkillTarget = {
  skillName: SkillName
  linkPath: AbsolutePath
  targetPath: AbsolutePath
}

/**
 * Reviewed broken-slot target carrying the on-disk `linkName` (basename, used by
 * main for path identity) alongside the `displaySkillName` (the source skill's
 * display name) so the pending reducer can reconcile selection by the live
 * `skill.name`, which can differ from the symlink basename.
 */
type ClearBrokenSymlinkSlotTarget =
  ClearBrokenSymlinkSlotsOptions['items'][number] & {
    displaySkillName: SkillName
  }

/**
 * Read the display name from a bulk-delete target that carries reviewed path identity.
 * @param target - Reviewed delete target object.
 * @returns Display skill name used for selection reconciliation.
 * @example getDeleteTargetName({ skillName: 'metadata-title', skillPath: '/x/folder' })
 */
function getDeleteTargetName(target: DeleteSelectedSkillTarget): SkillName {
  return target.skillName
}

/**
 * Convert renderer delete targets into the IPC item shape that preserves reviewed paths.
 * @param target - Reviewed delete target object.
 * @returns IPC delete item with mandatory skillPath.
 * @example toDeleteSkillItem({ skillName: 'metadata-title', skillPath: '/x/folder' })
 */
function toDeleteSkillItem(target: DeleteSelectedSkillTarget): {
  skillName: SkillName
  skillPath: AbsolutePath
  filesystemIdentity: FilesystemEntryIdentity
} {
  return target
}

/**
 * Read the display name from a bulk-unlink target that carries reviewed path identity.
 * @param target - Reviewed unlink target object.
 * @returns Display skill name used for selection reconciliation.
 * @example getUnlinkTargetName({ skillName: 'metadata-title', linkPath: '/x/slot', targetPath: '/x/source' })
 */
function getUnlinkTargetName(target: UnlinkSelectedSkillTarget): SkillName {
  return target.skillName
}

/**
 * Convert renderer unlink targets into the IPC item shape that preserves reviewed link paths.
 * @param target - Reviewed unlink target object.
 * @returns IPC unlink item with mandatory linkPath.
 * @example toUnlinkSkillItem({ skillName: 'metadata-title', linkPath: '/x/slot', targetPath: '/x/source' })
 */
function toUnlinkSkillItem(target: UnlinkSelectedSkillTarget): {
  skillName: SkillName
  linkPath: AbsolutePath
  targetPath: AbsolutePath
} {
  return target
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
    const result = await window.electron.skills.unlinkFromAgent(
      symlink.isLocal
        ? (() => {
            if (!symlink.filesystemIdentity) {
              throw new Error(
                'Rescan before delete. The reviewed local folder identity is missing.',
              )
            }
            return {
              skillName: skill.name,
              agentId: symlink.agentId,
              linkPath: symlink.linkPath,
              confirmedLocalDirectoryDelete: true,
              reviewedDirectoryIdentity: symlink.filesystemIdentity,
            }
          })()
        : (() => {
            if (!symlink.targetPath) {
              throw new Error(
                'Rescan before unlink. The reviewed symlink target is missing.',
              )
            }
            return {
              skillName: skill.name,
              agentId: symlink.agentId,
              linkPath: symlink.linkPath,
              targetPath: symlink.targetPath,
            }
          })(),
    )
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
 * Copy a skill source into other agents.
 * @param params - skill, sourcePath, and target agent IDs
 * @returns Copied count and failures
 */
export const copyToAgents = createAsyncThunk(
  'skills/copyToAgents',
  async (params: {
    skill: Skill
    sourcePath: AbsolutePath
    agentIds: AgentId[]
  }) => {
    const { skill, sourcePath, agentIds } = params
    const result = await window.electron.skills.copyToAgents({
      skillName: skill.name,
      sourcePath,
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
 * Copy every selected skill to the chosen target agents in one batch.
 *
 * Renderer-side fan-out: loops the RAW `copyToAgents` IPC once per selected
 * skill — NOT the single `copyToAgents` thunk, which throws when a skill copies
 * to zero agents and would abort the whole batch. Each skill's per-agent result
 * is collected even when some targets fail ("Already exists", broken source),
 * so one bad skill never blocks the rest. Non-destructive: the source skills are
 * never modified or removed, so the list selection survives the operation.
 * @param params.items - selected skills as `{ skillName, sourcePath }`; sourcePath = `skill.path` in global view
 * @param params.agentIds - target agents every selected skill is copied into
 * @returns BulkCopyToAgentsResult — one PerSkillCopyOutcome per item, in dispatch order
 * @example
 * await dispatch(bulkCopyToAgents({ items: [{ skillName: 'a', sourcePath: '/Users/me/.agents/skills/a' }], agentIds: ['codex'] }))
 */
export const bulkCopyToAgents = createAsyncThunk<
  BulkCopyToAgentsResult,
  {
    items: Array<{ skillName: SkillName; sourcePath: AbsolutePath }>
    agentIds: AgentId[]
  },
  // The condition only reads `state.skills.bulkCopying`, so depend on exactly
  // that slice (indexed from RootState) rather than the whole store. This keeps
  // the thunk dispatchable from both the app store and the skills-only test
  // store, and documents the thunk's true state surface.
  { state: Pick<RootState, 'skills'> }
>(
  'skills/bulkCopyToAgents',
  async ({ items, agentIds }) => {
    const perSkill: BulkCopyToAgentsResult['perSkill'] = []
    // Serial fan-out: one IPC round-trip per skill. Each iteration is isolated so
    // a rejected copy (e.g. source path failed validation) fails only that skill.
    for (const item of items) {
      try {
        const result = await window.electron.skills.copyToAgents({
          skillName: item.skillName,
          sourcePath: item.sourcePath,
          targetAgentIds: agentIds,
        })
        perSkill.push({
          skillName: item.skillName,
          copied: result.copied,
          failures: result.failures,
        })
      } catch (error) {
        // IPC rejected outright → record every target as failed for this skill
        // and keep going; the aggregate surfaces it as a partial failure.
        perSkill.push({
          skillName: item.skillName,
          copied: 0,
          failures: agentIds.map((agentId) => ({
            agentId,
            error: error instanceof Error ? error.message : 'Copy failed',
          })),
        })
      }
    }
    return { perSkill }
  },
  {
    // Dispatch-level single-flight guard: the modal's disabled button and early
    // return both read a render-stale `bulkCopying`, so a same-frame double click
    // (or any programmatic re-dispatch) could slip a second batch through before
    // React re-renders. `bulkCopying` flips true synchronously in this thunk's
    // `pending` reducer, so cancelling when it is already set makes the re-entrant
    // dispatch a no-op — the only race-free point to enforce single-flight.
    condition: (_arg, { getState }) => {
      if (getState().skills.bulkCopying) return false
    },
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
 * @param selectedTargets - Reviewed row identities to delete.
 * @returns BulkDeleteResult with per-item outcome
 * @example
 * await dispatch(deleteSelectedSkills([{ skillName: 'task', skillPath: '/Users/me/.agents/skills/task' }]))
 */
export const deleteSelectedSkills = createAsyncThunk<
  BulkDeleteResult,
  DeleteSelectedSkillTarget[]
>('skills/deleteSelected', async (selectedTargets) => {
  const result = await window.electron.skills.deleteSkills({
    items: selectedTargets.map(toDeleteSkillItem),
  })
  return result
})

/**
 * Clear reviewed orphan symlink records without invoking source deletion.
 * @param orphanRecords - Orphan skill name plus exact agent link and target paths reviewed in the cleanup dialog.
 * @returns Per-orphan cleanup result with no tombstones.
 * @example
 * await dispatch(clearSelectedOrphanSymlinks([{ skillName: 'abandoned', agents: [{ agentId: 'codex', linkPath: '/Users/me/.codex/skills/abandoned', targetPath: '/Users/me/.agents/skills/abandoned' }] }]))
 */
export const clearSelectedOrphanSymlinks = createAsyncThunk<
  ClearOrphanSymlinksResult,
  Array<{
    skillName: SkillName
    agents: Array<{
      agentId: AgentId
      linkPath: AbsolutePath
      targetPath: AbsolutePath
    }>
  }>
>('skills/clearSelectedOrphanSymlinks', async (orphanRecords) => {
  return window.electron.skills.clearOrphanSymlinks({
    items: orphanRecords,
  })
})

/**
 * Clear reviewed broken symlink slots after main revalidates exact path and target identity.
 * @param brokenSlots - Broken agent symlinks selected in Symlink Health cleanup.
 * @returns BulkUnlinkResult with per-slot outcome.
 * @example
 * await dispatch(clearSelectedBrokenSymlinkSlots({ items: [{ agentId: 'codex', linkName: 'task', displaySkillName: 'task', linkPath: '/Users/me/.codex/skills/task', targetPath: '/Users/me/.agents/skills/task' }] }))
 */
export const clearSelectedBrokenSymlinkSlots = createAsyncThunk<
  ClearBrokenSymlinkSlotsResult,
  { items: ClearBrokenSymlinkSlotTarget[] }
>('skills/clearSelectedBrokenSymlinkSlots', async ({ items }) => {
  // Strip the renderer-only `displaySkillName` before crossing IPC — main
  // validates path identity from linkName/linkPath/targetPath only.
  return window.electron.skills.clearBrokenSymlinkSlots({
    items: items.map(({ agentId, linkName, linkPath, targetPath }) => ({
      agentId,
      linkName,
      linkPath,
      targetPath,
    })),
  })
})

/**
 * Unlink every selected skill from a single agent. No tombstone produced —
 * unlink is benign (removes one symlink/folder, keeps source intact).
 * @param params - agentId + reviewed link paths to unlink.
 * @returns BulkUnlinkResult with per-item outcome
 * @example
 * await dispatch(unlinkSelectedFromAgent({ agentId: 'cursor', selectedNames: [{ skillName: 'task', linkPath: '/Users/me/.cursor/skills/task', targetPath: '/Users/me/.agents/skills/task' }] }))
 */
export const unlinkSelectedFromAgent = createAsyncThunk<
  BulkUnlinkResult,
  { agentId: AgentId; selectedNames: UnlinkSelectedSkillTarget[] }
>('skills/unlinkSelectedFromAgent', async ({ agentId, selectedNames }) => {
  const result = await window.electron.skills.unlinkManyFromAgent({
    agentId,
    items: selectedNames.map(toUnlinkSkillItem),
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
      result: RestoreDeletedSkillResult
    }> = []
    // Serial: each restore is an fs op; parallelism offers no real gain and
    // makes failure attribution harder. Per-item try/catch ensures one IPC
    // rejection does not discard prior successful restores — the thunk still
    // fulfils with a complete outcome list and the caller surfaces the
    // "N of M restored" summary.
    for (const tombstoneId of tombstoneIds) {
      try {
        const result = await window.electron.skills.restoreDeletedSkill({
          tombstoneId,
        })
        outcomes.push({ tombstoneId, result })
      } catch (rejectedError) {
        const message =
          rejectedError instanceof Error
            ? rejectedError.message
            : String(rejectedError)
        outcomes.push({
          tombstoneId,
          result: { outcome: 'error', error: { message } },
        })
      }
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
      state.selectedAddAgentIds = []
    },
    setSkillToCopy: (state, action: PayloadAction<Skill | null>) => {
      state.skillToCopy = action.payload
      state.selectedCopyAgentIds = []
    },
    /**
     * Toggle one target agent in the CopyToAgentsModal selection.
     */
    toggleCopyAgentSelection: (state, action: PayloadAction<AgentId>) => {
      const agentId = action.payload
      const existingIndex = state.selectedCopyAgentIds.indexOf(agentId)
      if (existingIndex === -1) {
        state.selectedCopyAgentIds.push(agentId)
        return
      }
      state.selectedCopyAgentIds.splice(existingIndex, 1)
    },
    /**
     * Clear CopyToAgentsModal selection when the modal target changes or closes.
     */
    clearCopyAgentSelection: (state) => {
      state.selectedCopyAgentIds = []
    },
    /**
     * Open/close the BulkCopyToAgentsModal (global-view multi-skill copy).
     * The toolbar's "Copy to…" opens it; the modal dispatches false on
     * dismiss/Cancel/completion. List selection is untouched (non-destructive).
     */
    setBulkCopyModalOpen: (state, action: PayloadAction<boolean>) => {
      state.bulkCopyModalOpen = action.payload
    },
    /**
     * Toggle one target agent in the AddSymlinkModal selection.
     */
    toggleAddAgentSelection: (state, action: PayloadAction<AgentId>) => {
      const agentId = action.payload
      const existingIndex = state.selectedAddAgentIds.indexOf(agentId)
      if (existingIndex === -1) {
        state.selectedAddAgentIds.push(agentId)
        return
      }
      state.selectedAddAgentIds.splice(existingIndex, 1)
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
        state.selectedAddAgentIds = []
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
        state.skillToAddSymlinks = null
        state.selectedAddAgentIds = []
        state.selectedCopyAgentIds = []
      })
      .addCase(copyToAgents.rejected, (state, action) => {
        state.copying = false
        state.error = action.error.message ?? 'Failed to copy skill'
      })
      // Bulk copy to agents (renderer fan-out over the copyToAgents IPC)
      .addCase(bulkCopyToAgents.pending, (state) => {
        state.bulkCopying = true
        state.error = null
      })
      .addCase(bulkCopyToAgents.fulfilled, (state) => {
        // Selection is intentionally preserved: copy is non-destructive, so the
        // user can keep the same rows ticked to copy elsewhere. The modal closes
        // itself and refreshAllData repopulates the list.
        state.bulkCopying = false
      })
      .addCase(bulkCopyToAgents.rejected, (state, action) => {
        state.bulkCopying = false
        state.error = action.error.message ?? 'Failed to copy skills'
      })
      .addCase(deleteSelectedSkills.pending, (state, action) => {
        state.inFlightDeleteNames = reconcileByLiveNames(
          state.items,
          action.meta.arg.map(getDeleteTargetName),
        )
        state.bulkDeleting = true
        state.error = null
      })
      .addCase(deleteSelectedSkills.fulfilled, (state, action) => {
        // Refetch happens via the component (thunks.ts refreshAllData); the
        // slice only clears the in-flight fade and releases the toolbar.
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        // Narrow clearSelection to the items that actually disappeared from
        // the list — keep failed ones selected so the user can retry without
        // re-ticking them.
        const removedNames = new Set(
          action.payload.items
            .filter(
              (item) =>
                item.outcome === 'deleted' || item.outcome === 'orphan-cleared',
            )
            .map((item) => item.skillName),
        )
        state.selectedSkillNames = state.selectedSkillNames.filter(
          (name) => !removedNames.has(name),
        )
        // Reconcile anchor: drop if selection emptied or if anchor itself was
        // deleted. Otherwise leave it so Shift+click continues from the same
        // origin.
        const anchorWasDeleted =
          state.selectionAnchor !== null &&
          removedNames.has(state.selectionAnchor)
        if (state.selectedSkillNames.length === 0 || anchorWasDeleted) {
          state.selectionAnchor = null
        }
      })
      .addCase(deleteSelectedSkills.rejected, (state, action) => {
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        state.error = action.error.message ?? 'Bulk delete failed'
      })
      .addCase(clearSelectedOrphanSymlinks.pending, (state, action) => {
        state.inFlightDeleteNames = reconcileByLiveNames(
          state.items,
          action.meta.arg.map((record) => record.skillName),
        )
        state.bulkDeleting = true
        state.error = null
      })
      .addCase(clearSelectedOrphanSymlinks.fulfilled, (state, action) => {
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        const removedNames = new Set(
          action.payload.items
            .filter((item) => item.outcome === 'orphan-cleared')
            .map((item) => item.skillName),
        )
        state.selectedSkillNames = state.selectedSkillNames.filter(
          (name) => !removedNames.has(name),
        )
        const anchorWasRemoved =
          state.selectionAnchor !== null &&
          removedNames.has(state.selectionAnchor)
        if (state.selectedSkillNames.length === 0 || anchorWasRemoved) {
          state.selectionAnchor = null
        }
      })
      .addCase(clearSelectedOrphanSymlinks.rejected, (state, action) => {
        state.inFlightDeleteNames = []
        state.bulkDeleting = false
        state.bulkProgress = null
        state.error = action.error.message ?? 'Orphan cleanup failed'
      })
      .addCase(clearSelectedBrokenSymlinkSlots.pending, (state, action) => {
        state.inFlightUnlinkNames = reconcileByLiveNames(
          state.items,
          // Reconcile by display name (`skill.name`), not the symlink basename —
          // the two can differ, and reconcileByLiveNames matches `skill.name`.
          action.meta.arg.items.map((item) => item.displaySkillName),
        )
        state.bulkUnlinking = true
        state.error = null
      })
      .addCase(clearSelectedBrokenSymlinkSlots.fulfilled, (state) => {
        state.inFlightUnlinkNames = []
        state.bulkUnlinking = false
      })
      .addCase(clearSelectedBrokenSymlinkSlots.rejected, (state, action) => {
        state.inFlightUnlinkNames = []
        state.bulkUnlinking = false
        state.error = action.error.message ?? 'Broken symlink cleanup failed'
      })
      .addCase(unlinkSelectedFromAgent.pending, (state, action) => {
        state.inFlightUnlinkNames = reconcileByLiveNames(
          state.items,
          action.meta.arg.selectedNames.map(getUnlinkTargetName),
        )
        state.bulkUnlinking = true
        state.error = null
      })
      .addCase(unlinkSelectedFromAgent.fulfilled, (state, action) => {
        state.inFlightUnlinkNames = []
        state.bulkUnlinking = false
        // Keep failed items selected so the user can retry without re-ticking.
        const unlinkedNames = new Set(
          action.payload.items
            .filter((item) => item.outcome === 'unlinked')
            .map((item) => item.skillName),
        )
        state.selectedSkillNames = state.selectedSkillNames.filter(
          (name) => !unlinkedNames.has(name),
        )
        // Mirror the delete path: clear anchor when selection empties or when
        // the anchor itself was unlinked; keep it otherwise.
        const anchorWasUnlinked =
          state.selectionAnchor !== null &&
          unlinkedNames.has(state.selectionAnchor)
        if (state.selectedSkillNames.length === 0 || anchorWasUnlinked) {
          state.selectionAnchor = null
        }
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
  toggleCopyAgentSelection,
  clearCopyAgentSelection,
  toggleAddAgentSelection,
  toggleSelection,
  selectRange,
  selectAll,
  clearSelection,
  setBulkProgress,
  setBulkCopyModalOpen,
} = skillsSlice.actions
export default skillsSlice.reducer

// --- Named selectors ---
export const selectSkillsItems = (state: RootState): Skill[] =>
  state.skills.items
export const selectSkillsLoading = (state: RootState): boolean =>
  state.skills.loading
export const selectSkillsError = (state: RootState): string | null =>
  state.skills.error
export const selectSelectedSkillNames = (state: RootState): SkillName[] =>
  state.skills.selectedSkillNames
export const selectSelectedCopyAgentIds = (state: RootState): AgentId[] =>
  state.skills.selectedCopyAgentIds
export const selectSelectionAnchor = (state: RootState): SkillName | null =>
  state.skills.selectionAnchor
export const selectInFlightDeleteNames = (state: RootState): SkillName[] =>
  state.skills.inFlightDeleteNames
export const selectBulkDeleting = (state: RootState): boolean =>
  state.skills.bulkDeleting
export const selectBulkUnlinking = (state: RootState): boolean =>
  state.skills.bulkUnlinking
export const selectBulkCopying = (state: RootState): boolean =>
  state.skills.bulkCopying
export const selectBulkCopyModalOpen = (state: RootState): boolean =>
  state.skills.bulkCopyModalOpen
export const selectBulkProgress = (
  state: RootState,
): { current: number; total: number } | null => state.skills.bulkProgress
