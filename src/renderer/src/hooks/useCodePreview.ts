import { useState, useEffect, useCallback, useRef } from 'react'

import type { SkillFile, SkillFileContent } from '../../../shared/types'

interface UseCodePreviewReturn {
  files: SkillFile[]
  activeFile: string | null
  setActiveFile: (path: string | null) => Promise<void>
  content: SkillFileContent | null
  loading: boolean
}

/**
 * Hook for managing skill file preview state
 * Handles file list loading and content fetching via IPC
 * @param skillPath - Path to the skill directory
 * @returns
 * - files: Array of skill files in the directory
 * - activeFile: Currently selected file path
 * - setActiveFile: Function to change active file
 * - content: Content of the active file
 * - loading: Whether files are being loaded
 * @example
 * const { files, activeFile, setActiveFile, content, loading } = useCodePreview('/path/to/skill')
 */
export function useCodePreview(skillPath: string): UseCodePreviewReturn {
  const [files, setFiles] = useState<SkillFile[]>([])
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [userSelectedFile, setUserSelectedFile] = useState<string | null>(null)
  const [content, setContent] = useState<SkillFileContent | null>(null)
  const prevSkillPathRef = useRef(skillPath)

  // Reset user selection synchronously when skillPath changes (not in an effect)
  if (prevSkillPathRef.current !== skillPath) {
    prevSkillPathRef.current = skillPath
    setUserSelectedFile(null)
    setContent(null)
  }

  // Derived: loading is true until files have been fetched for the current skillPath
  const loading = loadedPath !== skillPath

  // Derived: activeFile falls back to first file when user hasn't explicitly selected one
  const activeFile = userSelectedFile ?? files[0]?.path ?? null

  // Load file list when skill changes
  useEffect(() => {
    let cancelled = false
    async function loadFiles(): Promise<void> {
      const fileList = await window.electron.files.list(skillPath)
      if (cancelled) return
      setFiles(fileList)
      setLoadedPath(skillPath)
      // Load content for the first file directly
      if (fileList.length > 0) {
        const fileContent = await window.electron.files.read(fileList[0].path)
        if (cancelled) return
        setContent(fileContent)
      }
    }
    loadFiles()
    return () => {
      cancelled = true
    }
  }, [skillPath])

  // Load file content directly when user selects a file
  const setActiveFile = useCallback(async (path: string | null) => {
    setUserSelectedFile(path)
    if (!path) {
      setContent(null)
      return
    }
    const fileContent = await window.electron.files.read(path)
    setContent(fileContent)
  }, [])

  return { files, activeFile, setActiveFile, content, loading }
}
