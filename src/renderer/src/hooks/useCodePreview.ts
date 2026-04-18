import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AbsolutePath,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '../../../shared/types'

/**
 * Discriminated union for the preview pane's content state.
 * The renderer picks the correct component branch off `kind`.
 */
export type PreviewContent =
  | { kind: 'text'; data: SkillFileContent }
  | { kind: 'image'; data: SkillBinaryContent }
  | { kind: 'binary'; fileName: string; size: number }
  | { kind: 'empty' }

interface UseCodePreviewReturn {
  files: SkillFile[]
  activeFile: AbsolutePath | null
  setActiveFile: (path: AbsolutePath | null) => Promise<void>
  content: PreviewContent
  loading: boolean
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
  }

  const loading = loadedPath !== skillPath
  const activeFile = userSelectedFile ?? files[0]?.path ?? null

  useEffect(() => {
    let cancelled = false
    async function loadFiles(): Promise<void> {
      const fileList = await window.electron.files.list(skillPath)
      if (cancelled) return
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
    loadFiles()
    return () => {
      cancelled = true
    }
  }, [skillPath])

  const setActiveFile = useCallback(
    async (path: AbsolutePath | null) => {
      if (path === activeFile) return
      userSelectedFileRef.current = path
      setUserSelectedFile(path)
      if (!path) {
        setContent({ kind: 'empty' })
        return
      }
      const file = files.find((f) => f.path === path)
      if (!file) return
      const next = await loadContentForFile(file)
      // After the await, two things may have happened out of order:
      // (a) the user picked a different file (stale click loses)
      // (b) the skill itself switched (whole state already reset)
      // Both guards read refs so they see the *current* value, not the
      // closure snapshot from when this fetch started.
      if (userSelectedFileRef.current !== path) return
      if (prevSkillPathRef.current !== skillPath) return
      setContent(next)
    },
    [activeFile, files, skillPath],
  )

  return { files, activeFile, setActiveFile, content, loading }
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
