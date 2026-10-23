/* eslint-disable @laststance/react-next/no-react-context -- Approved per-renderer provider scopes the external cache to one app instance and isolated tests; no global mutable singleton. */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { useAppSelector } from '@/renderer/src/redux/hooks'
import {
  SKILL_FILES_LIMITS,
  unavailableSkillFiles,
  type SkillFilesListing,
  type SkillFilesRequest,
} from '@/shared/skillFiles'
import type { AbsolutePath } from '@/shared/types'

import { useCycleEffect } from './useCycleEffect'

interface CachedListing {
  result?: SkillFilesListing
  pending?: Promise<SkillFilesListing>
  request?: SkillFilesRequest
  bytes: number
}

/** One listing cache per renderer, shared by Tree and Inspector; never caches file contents.
 * @example const cache = new SkillFilesCache()
 */
export class SkillFilesCache {
  private readonly files = window.electron.files
  readonly entries = new Map<AbsolutePath, CachedListing>()
  private refused = new Map<AbsolutePath, CachedListing>()
  generation = 0
  private published = {
    entries: new Map<AbsolutePath, CachedListing>(),
    generation: 0,
  }
  private listeners = new Set<() => void>()
  private expanded = new Set<AbsolutePath>()
  private active: AbsolutePath | null = null
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return (): void => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.published

  /** Pins only visible expanded roots and the inspected skill against LRU eviction.
   * @example cache.pin(new Set([root]), activeRoot)
   */
  pin(expanded: ReadonlySet<AbsolutePath>): void {
    this.expanded = new Set(expanded)
  }

  /** Keeps the inspected root pinned even while the Tree presentation is unmounted.
   * @example cache.setActive(root)
   */
  setActive(root: AbsolutePath | null): void {
    this.active = root
  }

  /** Clears obsolete data and cancels only this provider's outstanding requests.
   * @example cache.invalidate(nextGeneration)
   */
  invalidate(generation: number): void {
    for (const entry of this.entries.values()) {
      if (entry.request)
        void this.files.cancelList(entry.request).catch(() => undefined)
    }
    this.generation = generation
    this.entries.clear()
    this.refused.clear()
    this.changed()
  }

  /** Coalesces Tree/Inspector requests; retry is explicit and preserves a previously readable subset.
   * @example await cache.ensure(root, true)
   */
  async ensure(root: AbsolutePath, retry = false): Promise<SkillFilesListing> {
    const previous = this.entries.get(root) ?? this.refused.get(root)
    if (previous?.pending) return previous.pending
    if (previous?.result && !retry) {
      // Reinsert on access so eviction follows actual use, not insertion age.
      if (this.entries.has(root)) {
        this.entries.delete(root)
        this.entries.set(root, previous)
      }
      return Promise.resolve(previous.result)
    }
    if (!this.makeRoom(root, 0, 0)) {
      const result = unavailableSkillFiles('busy')
      this.refused.set(root, { result, bytes: 0 })
      if (this.refused.size > 64)
        this.refused.delete(this.refused.keys().next().value!)
      this.changed()
      return Promise.resolve(result)
    }
    this.refused.delete(root)
    const request: SkillFilesRequest = {
      root,
      requestId: crypto.randomUUID(),
      generation: this.generation,
    }
    const entry: CachedListing = {
      result: previous?.result,
      bytes: previous?.bytes ?? 0,
      request,
    }
    const pending = this.files
      .listDetailed(request)
      .catch(() => unavailableSkillFiles('unavailable'))
      .then((result) => {
        if (
          this.generation !== request.generation ||
          this.entries.get(root) !== entry
        )
          return result
        const retained =
          result.status === 'error' && previous?.result?.files.length
            ? {
                ...result,
                status: 'partial' as const,
                files: previous.result.files,
                issues: previous.result.issues,
              }
            : result
        const bytes = new TextEncoder().encode(JSON.stringify(retained)).length
        // All pinned roots may fill the budget; deny admission instead of growing memory silently.
        entry.result = this.makeRoom(root, retained.files.length, bytes)
          ? retained
          : unavailableSkillFiles('busy')
        entry.bytes = entry.result === retained ? bytes : 0
        entry.pending = undefined
        entry.request = undefined
        this.entries.set(root, { ...entry })
        this.changed()
        return entry.result
      })
    entry.pending = pending
    this.entries.set(root, entry)
    this.changed()
    return pending
  }

  /** Evicts only unpinned, settled roots; subscribers remove their model children in the same render cycle.
   * @example this.makeRoom(root, files.length, bytes)
   */
  private makeRoom(root: AbsolutePath, files: number, bytes: number): boolean {
    const fits = (): boolean => {
      let count = 1
      let totalFiles = files
      let totalBytes = bytes
      for (const [key, entry] of this.entries) {
        if (key === root) continue
        count += 1
        totalFiles += entry.result?.files.length ?? 0
        totalBytes += entry.bytes
      }
      return (
        count <= SKILL_FILES_LIMITS.cachedRoots &&
        totalFiles <= SKILL_FILES_LIMITS.cachedFiles &&
        totalBytes <= SKILL_FILES_LIMITS.cachedBytes
      )
    }
    for (const [key, entry] of this.entries) {
      if (fits()) return true
      if (
        key !== root &&
        key !== this.active &&
        !this.expanded.has(key) &&
        !entry.pending
      )
        this.entries.delete(key)
    }
    return fits()
  }

  private changed(): void {
    this.published = {
      entries: new Map([...this.entries, ...this.refused]),
      generation: this.generation,
    }
    for (const listener of this.listeners) listener()
  }
}

const SkillFilesContext = createContext<SkillFilesCache | null>(null)

/** Mounts above both panels so presentation changes cannot duplicate file discovery.
 * @example <SkillFilesProvider><MainContent /><DetailPanel /></SkillFilesProvider>
 */
export function SkillFilesProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new SkillFilesCache())
  const generation = useAppSelector((state) => state.skills.filesGeneration)
  const selectedRoot = useAppSelector(
    (state) => state.skills.selectedSkill?.path ?? null,
  )
  useLayoutEffect(() => cache.setActive(selectedRoot), [cache, selectedRoot])
  const cleanup = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLayoutEffect(() => {
    if (cache.generation !== generation) cache.invalidate(generation)
  }, [cache, generation])
  useCycleEffect(() => {
    if (cleanup.current) clearTimeout(cleanup.current)
    return (): void => {
      cleanup.current = setTimeout(
        () => cache.invalidate(cache.generation + 1),
        0,
      )
    }
  }, [cache])
  return <SkillFilesContext value={cache}>{children}</SkillFilesContext>
}

/** Subscribes preview and Tree consumers to the shared listing cache.
 * @example const cache = useSkillFilesCache()
 */
export function useSkillFilesCache(): {
  cache: SkillFilesCache
  snapshot: ReturnType<SkillFilesCache['snapshot']>
} {
  const cache = useContext(SkillFilesContext)
  if (!cache) throw new Error('SkillFilesProvider is required')
  const snapshot = useSyncExternalStore(
    cache.subscribe,
    cache.snapshot,
    cache.snapshot,
  )
  return { cache, snapshot }
}
