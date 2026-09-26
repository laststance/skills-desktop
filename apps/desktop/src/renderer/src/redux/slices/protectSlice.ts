import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/renderer/src/redux/store'
import type { FilesystemEntryIdentity, SkillName } from '@/shared/types'

import { fetchSkills } from './skillsSlice'

/**
 * A locked skill, remembered by the name on screen AND by the directory that
 * name pointed at, so an out-of-app rename does not silently unlock it.
 * @example { name: 'task', identity: { dev: 16777233, ino: 12345 } }
 */
export interface ProtectedSkill {
  /** Name currently shown in the list — `SKILL.md` frontmatter `name:`, else the directory name. */
  name: SkillName
  /**
   * Deliberately narrower than {@link FilesystemEntryIdentity}: only `dev` +
   * `ino` survive a rename. `ctimeMs`, which the destructive-delete guards
   * compare to reject reused-inode replacements, is bumped by `rename(2)`
   * itself, so including it would reject exactly the case this field exists
   * to catch. The residual cost is a recycled inode moving a lock onto a
   * different skill — over-protection, never a silent unlock.
   * Absent for locks persisted before v5 and for rows the scan has no
   * identity for (agent-only links, orphans); backfilled on the next scan.
   */
  identity?: Pick<FilesystemEntryIdentity, 'dev' | 'ino'>
}

/**
 * Redux state for the per-skill protection feature.
 * Persisted to localStorage via `@laststance/redux-storage-middleware` so
 * locked skills survive app restarts. Protection is a fat-finger guard only —
 * it lives in the renderer and can be bypassed by clearing app data. Do not
 * treat it as a security control.
 */
interface ProtectState {
  /** Skills the user has locked (insertion order, no duplicate names). */
  items: ProtectedSkill[]
}

const initialState: ProtectState = {
  items: [],
}

/** Map key that pairs `dev` with `ino` — neither alone identifies a directory. */
function inodeKey(
  identity: Pick<FilesystemEntryIdentity, 'dev' | 'ino'>,
): string {
  return `${identity.dev}:${identity.ino}`
}

const protectSlice = createSlice({
  name: 'protect',
  initialState,
  reducers: {
    /**
     * Lock a skill. Ignores duplicates by name.
     * @param action.payload - Skill name plus, when the scan captured one, the inode behind it.
     * @example
     * dispatch(addProtection({ name: 'task', identity: { dev: 16777233, ino: 12345 } }))
     */
    addProtection: (state, action: PayloadAction<ProtectedSkill>) => {
      if (!state.items.some((item) => item.name === action.payload.name)) {
        state.items.push(action.payload)
      }
    },
    /**
     * Unlock a skill by name.
     * @param action.payload - Skill name to unprotect
     * @example
     * dispatch(removeProtection('task'))
     */
    removeProtection: (state, action: PayloadAction<SkillName>) => {
      state.items = state.items.filter((item) => item.name !== action.payload)
    },
  },
  extraReducers: (builder) => {
    // ── Follow renames, and backfill identities the lock was saved without ──
    // Renaming a skill changes `Skill.name` two ways — renaming the directory
    // (when SKILL.md has no `name:`) or editing that frontmatter field — and
    // both leave the directory's inode untouched. Without this the lock keeps
    // pointing at a name nothing resolves to and the renamed row comes back
    // unlocked, so the next bulk delete takes it with no confirmation.
    //
    // Reconciling here rather than on a rename event is deliberate: a rename
    // made while the app is closed emits no event, and that is the common
    // case. `fetchSkills` runs on mount and after every mutation, so the
    // comparison is against whatever the disk actually holds now.
    //
    // Mirrors the `fetchSkills.fulfilled` prune in uiSlice — same action, same
    // "reconcile persisted references against the fresh inventory" shape.
    builder.addCase(fetchSkills.fulfilled, (state, action) => {
      const nameByInode = new Map<string, SkillName>()
      const identityByName = new Map<SkillName, FilesystemEntryIdentity>()
      for (const skill of action.payload) {
        if (!skill.filesystemIdentity) continue
        nameByInode.set(inodeKey(skill.filesystemIdentity), skill.name)
        identityByName.set(skill.name, skill.filesystemIdentity)
      }
      // Pass 1 — locks whose directory this scan actually found. The scan is
      // authoritative about the name a surviving inode answers to, so these
      // names are taken first. One scan maps each inode to one name and skill
      // names are unique, so they never collide with each other, and settling
      // them up front is what makes the result independent of the order locks
      // happen to sit in. Doing it in one running pass instead let a chain
      // (`task`→`browse` while `browse`→`write`) resolve or stall purely on
      // that order.
      const claimed = new Set<SkillName>()
      for (const item of state.items) {
        const currentName =
          item.identity && nameByInode.get(inodeKey(item.identity))
        if (!currentName) continue
        // Assigning the name it already has is not a change — Immer skips
        // identical writes — so `items` keeps its reference and the memoized
        // selector below does not rebuild on a scan that renamed nothing.
        item.name = currentName
        claimed.add(currentName)
      }

      // Pass 2 — the rest: locks the scan has no directory for, and pre-v5
      // locks that never had one.
      const kept = state.items.filter((item) => {
        if (item.identity && nameByInode.has(inodeKey(item.identity))) {
          return true
        }
        // Pre-v5 lock, or one taken on a row the scan had no identity for.
        // Bind it now so the NEXT rename is followed.
        if (!item.identity) {
          const scanned = identityByName.get(item.name)
          if (scanned) item.identity = { dev: scanned.dev, ino: scanned.ino }
        }
        // A name that matches nothing is kept, because dropping it would
        // unlock a skill the user may only have temporarily moved away. It is
        // dropped only when pass 1 handed that name to a live directory: the
        // shadow entry is unreachable from the UI, `removeProtection` would
        // silently take it along with the real lock, and leaving it would
        // re-lock the skill on the next scan after the user unlocked it.
        if (claimed.has(item.name)) return false
        claimed.add(item.name)
        return true
      })
      // Reassign only when something was dropped, so a scan that changed
      // nothing leaves `items` referentially stable for the memoized selector.
      if (kept.length !== state.items.length) state.items = kept
    })
  },
})

export const { addProtection, removeProtection } = protectSlice.actions

/** Redux state shape required by protect selectors (slice tests use a minimal store). */
type ProtectSelectorState = Pick<RootState, 'protect'>

/**
 * Select all protected skills (internal — used by createSelector below).
 * @returns ProtectedSkill[]
 */
const selectProtectedItems = (state: ProtectSelectorState): ProtectedSkill[] =>
  state.protect.items

/**
 * Memoized Set of protected skill names. Built once per `items` reference
 * and shared across all callers — O(items) build cost amortized across the
 * full list render, not paid per row. Use this in components that need the
 * whole set (e.g. MainContent bulk-delete partition) without rebuilding a Set
 * on every render.
 */
export const selectProtectedNamesSet = createSelector(
  [selectProtectedItems],
  (items) => new Set(items.map((item) => item.name)) as ReadonlySet<SkillName>,
)

/**
 * Check if a skill is protected by name.
 * @param name - Skill name to check
 * @returns boolean
 * @example
 * const isProtected = useAppSelector((state) => selectIsProtected(state, 'task'))
 */
export const selectIsProtected = (
  state: ProtectSelectorState,
  name: SkillName,
): boolean => selectProtectedNamesSet(state).has(name)

export default protectSlice.reducer
