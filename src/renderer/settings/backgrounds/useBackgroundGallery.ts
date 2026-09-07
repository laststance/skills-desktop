import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useAppStore } from '@/renderer/src/redux/hooks'
import { setSettings } from '@/renderer/src/redux/slices/settingsSlice'
import { backgroundSourceKey } from '@/renderer/src/utils/backgroundSourceKey'
import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundApplySource,
  type BackgroundCrop,
  type BackgroundCropAspect,
  type BackgroundPreview,
  type BackgroundSelection,
  type BackgroundSnapshot,
} from '@/shared/backgrounds'
import type { Settings } from '@/shared/settings'

import { areBackgroundCropsEqual } from './utils/areBackgroundCropsEqual'
import { backgroundErrorMessage } from './utils/backgroundErrorMessage'

export interface BackgroundDraft {
  preview: BackgroundPreview
  crop: BackgroundCrop
  aspect: BackgroundCropAspect
}
interface GalleryState {
  open: boolean
  view: 'gallery' | 'crop'
  draft: BackgroundDraft | null
  beforeCrop: BackgroundDraft | null
  checking: boolean
  starting: boolean
  error: string | null
  session: number
}
const initialState: GalleryState = {
  open: false,
  view: 'gallery',
  draft: null,
  beforeCrop: null,
  checking: false,
  starting: false,
  error: null,
  session: 0,
}

/** Owns the unsaved editor draft; accepted inputs belong to Main even before its IPC reply arrives.
 * @returns Gallery state and user actions; cancelling restores the exact pre-upload image and crop.
 * @example const gallery = useBackgroundGallery(snapshot); gallery.openGallery()
 */
export function useBackgroundGallery(snapshot: BackgroundSnapshot) {
  const [state, setState] = useState(initialState)
  const requestGeneration = useRef(0)
  const draftTokens = useRef(new Set<string>())
  const startingRequest = useRef<string | null>(null)
  const opener = useRef<HTMLElement | null>(null)
  const store = useAppStore()

  const discard = (retainedDraftId?: string): void => {
    // A replacement and its Cancel destination both remain owned until the user chooses which to keep.
    for (const draftId of draftTokens.current) {
      if (draftId === retainedDraftId) continue
      draftTokens.current.delete(draftId)
      void window.electron.backgrounds.discardDraft({ draftId }).catch(() =>
        toast.error('Image draft could not be removed', {
          description: 'Reopen Settings to retry cleanup.',
        }),
      )
    }
  }

  useEffect(() => {
    const cleanup = (): void => {
      requestGeneration.current += 1
      // Main ignores cleanup for accepted tokens, including when the acknowledgement is still in transit.
      for (const draftId of draftTokens.current)
        void window.electron.backgrounds
          .discardDraft({ draftId })
          .catch(() => undefined)
      draftTokens.current.clear()
    }
    window.addEventListener('beforeunload', cleanup)
    return () => {
      window.removeEventListener('beforeunload', cleanup)
      cleanup()
    }
  }, [])

  const loadPreview = async (
    source: BackgroundApplySource,
    crop?: BackgroundSelection['crop'],
    aspect?: BackgroundCropAspect,
    view: GalleryState['view'] = 'gallery',
  ): Promise<void> => {
    const generation = ++requestGeneration.current
    setState((current) => ({ ...current, checking: true, error: null }))
    try {
      const preview = await window.electron.backgrounds.preview(source)
      if (generation !== requestGeneration.current) return
      discard(source.kind === 'upload-draft' ? source.draftId : undefined)
      if (source.kind === 'upload-draft')
        draftTokens.current.add(source.draftId)
      const draft = {
        preview,
        crop: crop ?? DEFAULT_BACKGROUND_CROP,
        aspect: aspect ?? 'original',
      }
      setState((current) => ({
        ...current,
        draft,
        beforeCrop: draft,
        checking: false,
        view,
        session: current.session + 1,
      }))
    } catch (error: unknown) {
      if (generation !== requestGeneration.current) return
      setState((current) => ({
        ...current,
        checking: false,
        error: backgroundErrorMessage(
          error,
          'Image preview unavailable. Try another image.',
        ),
      }))
    }
  }

  const openGallery = (view: GalleryState['view'] = 'gallery'): void => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    setState((current) => ({
      ...current,
      open: true,
      view: 'gallery',
      error: null,
    }))
    const retainedOperation =
      view === 'gallery' &&
      snapshot.operation &&
      (snapshot.operation.status === 'failed' ||
        snapshot.operation.status === 'applying')
        ? snapshot.operation
        : null
    const selected =
      retainedOperation ?? store.getState().settings.background.selected
    if (selected && (!state.draft || view === 'crop'))
      void loadPreview(selected.source, selected.crop, selected.aspect, view)
  }

  const close = (): void => {
    requestGeneration.current += 1
    discard()
    setState((current) => ({ ...initialState, session: current.session + 1 }))
  }

  const importImage = async (): Promise<void> => {
    const generation = ++requestGeneration.current
    setState((current) => ({ ...current, checking: true, error: null }))
    try {
      const preview = await window.electron.backgrounds.importImage()
      if (generation !== requestGeneration.current) {
        if (preview)
          await window.electron.backgrounds.discardDraft({
            draftId: preview.source.draftId,
          })
        return
      }
      if (!preview) {
        setState((current) => ({ ...current, checking: false }))
        return
      }
      draftTokens.current.add(preview.source.draftId)
      // Save the entire prior draft before opening the new-upload editor; Cancel restores its crop too.
      setState((current) => ({
        ...current,
        beforeCrop: current.draft,
        draft: { preview, crop: DEFAULT_BACKGROUND_CROP, aspect: 'original' },
        checking: false,
        view: 'crop',
        session: current.session + 1,
      }))
    } catch (error: unknown) {
      if (generation !== requestGeneration.current) return
      setState((current) => ({
        ...current,
        checking: false,
        error: backgroundErrorMessage(
          error,
          'Image could not be checked. Choose another file.',
        ),
      }))
    }
  }

  const cancelCrop = (): void => {
    const previousSource = state.beforeCrop?.preview.source
    discard(
      previousSource?.kind === 'upload-draft'
        ? previousSource.draftId
        : undefined,
    )
    setState((current) => ({
      ...current,
      draft: current.beforeCrop,
      view: 'gallery',
      error: null,
    }))
  }

  const apply = async (draft = state.draft): Promise<void> => {
    if (!draft || startingRequest.current) return
    const requestId = crypto.randomUUID()
    startingRequest.current = requestId
    const generation = requestGeneration.current
    setState((current) => ({ ...current, draft, starting: true, error: null }))
    const failed =
      snapshot.operation?.status === 'failed' &&
      backgroundSourceKey(snapshot.operation.source) ===
        backgroundSourceKey(draft.preview.source) &&
      snapshot.operation.aspect === draft.aspect &&
      areBackgroundCropsEqual(snapshot.operation.crop, draft.crop)
        ? snapshot.operation
        : null
    try {
      await window.electron.backgrounds.apply({
        requestId,
        source: draft.preview.source,
        crop: draft.crop,
        aspect: draft.aspect,
        ...(failed ? { retryOperationId: failed.operationId } : {}),
      })
    } catch (error: unknown) {
      if (generation === requestGeneration.current)
        setState((current) => ({
          ...current,
          error: backgroundErrorMessage(
            error,
            'Background could not be started. Try again.',
          ),
        }))
    } finally {
      startingRequest.current = null
      if (generation === requestGeneration.current)
        setState((current) => ({ ...current, starting: false }))
    }
  }

  const saveMutation = async (
    action: () => Promise<Settings>,
  ): Promise<void> => {
    const previous = store.getState().settings
    try {
      const saved = await action()
      // Broadcasts/newer user edits own newer snapshots; late direct replies cannot overwrite them.
      if (store.getState().settings === previous)
        store.dispatch(setSettings(saved))
    } catch (error: unknown) {
      toast.error('Background change could not be saved', {
        description: backgroundErrorMessage(error, 'Try again.'),
      })
      throw error
    }
  }

  return {
    ...state,
    opener,
    openGallery,
    close,
    loadPreview,
    importImage,
    cancelCrop,
    apply,
    saveMutation,
    editCrop: (): void =>
      setState((current) => ({
        ...current,
        beforeCrop: current.draft,
        view: 'crop',
        session: current.session + 1,
      })),
  }
}
