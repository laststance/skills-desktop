import { useEffect, useState } from 'react'

import { useAppDispatch, useAppSelector } from '@/renderer/src/redux/hooks'
import {
  fetchSkills,
  selectPreviewFile,
} from '@/renderer/src/redux/slices/skillsSlice'
import type { SkillFilesCode } from '@/shared/skillFiles'
import type {
  AbsolutePath,
  FileName,
  FileSizeBytes,
  SkillBinaryContent,
  SkillFileContent,
} from '@/shared/types'

import { useSkillFilesCache } from './SkillFilesProvider'

export type PreviewContent =
  | { kind: 'text'; data: SkillFileContent }
  | { kind: 'image'; data: SkillBinaryContent }
  | { kind: 'binary'; fileName: FileName; size: FileSizeBytes }
  | { kind: 'empty' }
  | { kind: 'error'; code: SkillFilesCode }

/** Loads content only for the current mapped file; Tree and Files tabs share Redux navigation.
 * Each effect owns one read, so late results from a previous skill, file or refresh cannot paint.
 * @example const { files, content, setActiveFile } = useCodePreview(skill.path)
 */
// eslint-disable-next-line @laststance/react-next/no-single-use-hook-file -- Dedicated content loader has browser regression tests; Tree and Inspector share its listing provider.
export function useCodePreview(skillPath: AbsolutePath) {
  const { cache, snapshot } = useSkillFilesCache()
  const dispatch = useAppDispatch()
  const intent = useAppSelector((state) => state.skills.inspectedFile)
  const generation = useAppSelector((state) => state.skills.filesGeneration)
  const [read, setRead] = useState<{
    path: AbsolutePath
    generation: number
    sequence: number
    content: PreviewContent
  } | null>(null)
  const [retrySequence, setRetrySequence] = useState(0)
  const entry = snapshot.entries.get(skillPath)
  const files = entry?.result?.files ?? []
  const requestedFile = intent?.root === skillPath ? intent.path : null
  const activeFile = requestedFile ?? files[0]?.path ?? null
  const file = files.find((candidate) => candidate.path === activeFile)
  const loading = !entry?.result
  const loadFailed = entry?.result?.status === 'error'

  useEffect(() => {
    void cache.ensure(skillPath)
  }, [cache, skillPath, generation, cache.generation])
  useEffect(() => {
    if (!file) return
    let cancelled = false
    const load = async (): Promise<void> => {
      const result =
        file.previewable === 'binary'
          ? null
          : await window.electron.files
              .readDetailed(skillPath, file.path)
              .catch(() => ({
                status: 'error' as const,
                code: 'unavailable' as const,
              }))
      if (cancelled) return
      const content: PreviewContent =
        result === null
          ? { kind: 'binary', fileName: file.name, size: file.size }
          : result.status === 'ready'
            ? ({ kind: result.kind, data: result.data } as PreviewContent)
            : { kind: 'error', code: result.code }
      setRead({ path: file.path, generation, sequence: retrySequence, content })
    }
    void load()
    return (): void => {
      cancelled = true
    }
  }, [file, skillPath, generation, retrySequence])

  const setActiveFile = async (path: AbsolutePath | null): Promise<void> => {
    // The UI can activate only entries actually admitted by the shared listing.
    if (path && files.some((candidate) => candidate.path === path))
      dispatch(selectPreviewFile({ root: skillPath, path }))
  }
  const content: PreviewContent =
    read?.path === activeFile &&
    read.generation === generation &&
    read.sequence === retrySequence
      ? read.content
      : requestedFile && !file && !loading
        ? { kind: 'error', code: 'missing' }
        : { kind: 'empty' }
  return {
    files,
    activeFile,
    setActiveFile,
    content,
    loading,
    loadFailed,
    reading:
      Boolean(file) &&
      (read?.path !== activeFile ||
        read.generation !== generation ||
        read.sequence !== retrySequence),
    listing: entry?.result,
    retry: (): void => {
      // Missing paths need a scanner refresh to reconcile the selected domain object.
      if (
        (content.kind === 'error' && content.code === 'missing') ||
        entry?.result?.code === 'missing'
      ) {
        void dispatch(fetchSkills())
        return
      }
      void cache.ensure(skillPath, true)
      setRetrySequence((value) => value + 1)
    },
  }
}
