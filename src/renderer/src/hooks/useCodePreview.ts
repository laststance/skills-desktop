import { useState, useEffect } from 'react'

import type { SkillFile, SkillFileContent } from '../../../shared/types'

interface UseCodePreviewReturn {
  files: SkillFile[]
  activeFile: string | null
  setActiveFile: (path: string | null) => void
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
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [content, setContent] = useState<SkillFileContent | null>(null)
  const [loading, setLoading] = useState(true)

  // Load file list when skill changes
  useEffect(() => {
    async function loadFiles(): Promise<void> {
      setLoading(true)
      const fileList = await window.electron.files.list(skillPath)
      setFiles(fileList)
      if (fileList.length > 0) {
        setActiveFile(fileList[0].path)
      }
      setLoading(false)
    }
    loadFiles()
  }, [skillPath])

  // Load file content when active file changes
  useEffect(() => {
    async function loadContent(): Promise<void> {
      if (!activeFile) {
        setContent(null)
        return
      }
      const fileContent = await window.electron.files.read(activeFile)
      setContent(fileContent)
    }
    loadContent()
  }, [activeFile])

  return { files, activeFile, setActiveFile, content, loading }
}
