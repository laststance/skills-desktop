import { useEffect, useRef, useState } from 'react'

import type {
  AbsolutePath,
  FileName,
  FileSizeBytes,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '@/shared/types'

/**
 * Discriminated union for the preview pane's content state.
 * The renderer picks the correct component branch off `kind`.
 */
export type PreviewContent =
  | { kind: 'text'; data: SkillFileContent }
  | { kind: 'image'; data: SkillBinaryContent }
  | { kind: 'binary'; fileName: FileName; size: FileSizeBytes }
  | { kind: 'empty' }

interface UseCodePreviewReturn {
  files: SkillFile[]
  activeFile: AbsolutePath | null
  setActiveFile: (path: AbsolutePath | null) => Promise<void>
  content: PreviewContent
  loading: boolean
  loadFailed: boolean
}

/**
 * Hook for managing skill file preview state.
 * Routes text/image/binary files to the correct IPC read path and exposes a
 * discriminated union so the renderer can switch on `content.kind` without
 * re-deriving the file's shape from extensions.
 * @param skillPath - Absolute path to the skill directory.
 * @returns
 * - files: all previewable files discovered under the skill (text + image + placeholder)
 * - activeFile: currently selected file's absolute path
 * - setActiveFile: change the active file and load its content
 * - content: discriminated union describing how the renderer should display the file
 * - loading: true until the initial file list has been fetched for the current skill
 * - loadFailed: true when that fetch rejected, so the pane can explain instead of spinning
 * @example
 * const { files, content, setActiveFile } = useCodePreview('/skills/tdd')
 * // content.kind === 'text' | 'image' | 'binary' | 'empty'
 */
export function useCodePreview(skillPath: AbsolutePath): UseCodePreviewReturn {
  const [files, setFiles] = useState<SkillFile[]>([])
  const [loadedPath, setLoadedPath] = useState<AbsolutePath | null>(null)
  const [userSelectedFile, setUserSelectedFile] = useState<AbsolutePath | null>(
    null,
  )
  const [content, setContent] = useState<PreviewContent>({ kind: 'empty' })
  const [loadFailed, setLoadFailed] = useState(false)
  const prevSkillPathRef = useRef(skillPath)
  // Mirror of userSelectedFile readable synchronously from the initial-load
  // effect. The effect must check the *current* selection when its async IPC
  // resolves; reading state via closure would see a stale null snapshot.
  const userSelectedFileRef = useRef<AbsolutePath | null>(null)

  if (prevSkillPathRef.current !== skillPath) {
    prevSkillPathRef.current = skillPath
    userSelectedFileRef.current = null
    setUserSelectedFile(null)
    setContent({ kind: 'empty' })
    setLoadFailed(false)
  }

  const loading = loadedPath !== skillPath
  const activeFile = userSelectedFile ?? files[0]?.path ?? null

  useEffect(() => {
    let cancelled = false
    // Distinguishes the two failures the catch below can see. A rejected list
    // leaves the pane with nothing to show; a rejected content read leaves a
    // perfectly good tab bar that must stay on screen.
    let listSucceeded = false
    async function loadFiles(): Promise<void> {
      const fileList = await window.electron.files.list(skillPath)
      if (cancelled) return
      listSucceeded = true
      setFiles(fileList)
      setLoadedPath(skillPath)
      const first = fileList[0]
      if (!first) {
        setContent({ kind: 'empty' })
        return
      }
      const initial = await loadContentForFile(first)
      if (cancelled || userSelectedFileRef.current !== null) return
      setContent(initial)
    }
    // `files.list` rejects when the main process refuses the path: `validatePath`
    // runs OUTSIDE `listSkillFiles`' own swallow, and a skill reached through an
    // agent symlink that points off-tree resolves outside `getAllowedBases()`.
    // Without this catch the rejection floats, `loadedPath` never advances, and
    // `loading` stays true forever -- a spinner with no error and no retry.
    // The catch stays broad rather than wrapping only the list await: narrowing
    // it would leave every later rejection floating again, which is the bug.
    loadFiles().catch((error: unknown) => {
      // The UI states the cause in plain language; DevTools gets the real one.
      console.warn('[preview] failed to load skill files:', error)
      if (cancelled) return
      setLoadedPath(skillPath)
      if (!listSucceeded) {
        setLoadFailed(true)
        return
      }
      // The list landed, so `files` is valid and its tabs must keep rendering;
      // only this one file's content is missing. Same stale-click guard the
      // success path uses: a click during the initial read already committed
      // `userSelectedFile` and painted that file, so blanking here would wipe
      // the tab the user is looking at. (The `!listSucceeded` arm above needs
      // no guard -- `files` is empty there, so `setActiveFile` rejects every
      // path and the ref is provably still null.)
      if (userSelectedFileRef.current !== null) return
      setContent({ kind: 'empty' })
    })
    return () => {
      cancelled = true
    }
  }, [skillPath])

  const setActiveFile = async (path: AbsolutePath | null) => {
    if (path === activeFile) return
    // Resolve before committing. A path absent from `files` must never reach
    // `userSelectedFile`: `activeFile` would then name a tab that has no
    // Trigger, so the bar shows nothing highlighted over stale content, and
    // `files.length === 0` would stop implying `!activeFile` -- the
    // equivalence {@link CodePreview} guards its empty state on.
    const file = path ? files.find((f) => f.path === path) : undefined
    if (path && !file) return
    userSelectedFileRef.current = path
    setUserSelectedFile(path)
    if (!file) {
      setContent({ kind: 'empty' })
      return
    }
    // react-doctor-disable-next-line react-doctor/async-defer-await -- the post-await guards (below) deliberately re-read refs AFTER the async gap to drop a stale click or a skill switch that happened DURING the load; they cannot move before the await.
    const next = await loadContentForFile(file).catch(
      (error: unknown): PreviewContent => {
        // The UI falls back to the empty pane; DevTools gets the real cause.
        console.warn('[preview] failed to read selected file:', error)
        // Degrade to empty, don't rethrow. The selection committed above, so
        // this tab is already highlighted: leaving `content` alone would
        // caption the PREVIOUS file's text with THIS file's tab. An empty pane
        // is honest, misattributed text is not. Rethrowing is not an option
        // either -- `handleValueChange` drops the promise, so it would float.
        return { kind: 'empty' }
      },
    )
    // After the await, two things may have happened out of order:
    // (a) the user picked a different file (stale click loses)
    // (b) the skill itself switched (whole state already reset)
    // Both guards read refs so they see the *current* value, not the
    // closure snapshot from when this fetch started.
    if (userSelectedFileRef.current !== path) return
    /* v8 ignore next -- redundant double-guard: a skill switch runs the render-phase reset that nulls userSelectedFileRef.current, so any stale load after a switch already returns at the line-above guard (null !== path); reaching here with the skill changed would need the same absolute path re-selected on a different skill, which is impossible since paths are skill-specific */
    if (prevSkillPathRef.current !== skillPath) return
    setContent(next)
  }

  return { files, activeFile, setActiveFile, content, loading, loadFailed }
}

/**
 * Dispatch the right IPC call based on `file.previewable`.
 * Pure at the module level so it can be unit-tested without React.
 */
async function loadContentForFile(file: SkillFile): Promise<PreviewContent> {
  if (file.previewable === 'text') {
    const data = await window.electron.files.read(file.path)
    return data ? { kind: 'text', data } : { kind: 'empty' }
  }
  if (file.previewable === 'image') {
    const data = await window.electron.files.readBinary(file.path)
    return data ? { kind: 'image', data } : { kind: 'empty' }
  }
  return { kind: 'binary', fileName: file.name, size: file.size }
}
