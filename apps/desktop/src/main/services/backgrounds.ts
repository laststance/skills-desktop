import { isDeepStrictEqual } from 'node:util'

import { broadcastTypedEvent } from '@/main/ipc/typedSend'
import {
  BackgroundApplyInputSchema,
  BackgroundApplySourceSchema,
  BackgroundLayoutSchema,
  BackgroundOwnedIdSchema,
  DEFAULT_BACKGROUND_CROP,
  type BackgroundApplyAcceptance,
  type BackgroundApplyInput,
  type BackgroundApplySource,
  type BackgroundDisplay,
  type BackgroundLayout,
  type BackgroundOperation,
  type BackgroundOperationError,
  type BackgroundPreview,
  type BackgroundSnapshot,
  type BackgroundUpload,
} from '@/shared/backgrounds'
import {
  BACKGROUND_FIRST_APPLY_OPACITY_PERCENT,
  WINDOW_OPACITY_MAX_PERCENT,
} from '@/shared/constants'
import { IPC_CHANNELS } from '@/shared/ipc-channels'
import type { Settings } from '@/shared/settings'

import {
  BackgroundImageError,
  claimBackgroundDraft,
  finishBackgroundDraft,
  getBackgroundPreview,
  getBackgroundSourceInfo,
  prepareBackgroundDisplay,
  publishBackgroundDraft,
  readBackgroundDisplay,
  removeBackgroundDisplay,
  removeBackgroundUpload,
} from './backgroundImages'
import {
  BackgroundRemoteError,
  backgroundPhotoCredit,
  backgroundPhotoUrl,
  notifyBackgroundDownload,
  prepareOnlineBackground,
  previewOnlineBackground,
} from './backgroundsRemote'
import { getSettings, updateSettings } from './settings'

/** The current Apply owns its input until success, abandonment or an exact failed-input retry. */
interface BackgroundApplication {
  input: BackgroundApplyInput
  record: BackgroundOperation
  draftId: string | null
  upload: BackgroundUpload | null
  notificationAcknowledged: boolean
  committing: boolean
  committed: boolean
  settled: boolean
}

let currentApplication: BackgroundApplication | null = null
// Keep only scalar acceptances for duplicate IPC delivery; full source/result state remains current-operation-only.
// ponytail: retain one scalar entry per Apply for process-lifetime deduplication; use owner-scoped monotonic tokens only if measured growth warrants a protocol change.
const acceptedRequests = new Map<string, BackgroundApplyAcceptance>()
let nextOperationId = 0
let snapshot: BackgroundSnapshot = {
  revision: 0,
  displayRetryRevision: 0,
  operation: null,
  display: null,
}

/** Returns Main's current result without starting work, allowing subscribe-before-get replay in either window.
 * @returns The current monotonic operation/display snapshot.
 * @example getBackgroundSnapshot().operation?.status // 'applying'
 */
export function getBackgroundSnapshot(): BackgroundSnapshot {
  return snapshot
}

/** Publishes operation and display together after acceptance, a durable mutation or explicit display Retry.
 * @returns Nothing; destroyed windows are skipped by the existing typed broadcaster.
 * @example publishBackgroundSnapshot() // Both open windows receive the same revision.
 */
function publishBackgroundSnapshot(): void {
  snapshot = {
    ...snapshot,
    revision: snapshot.revision + 1,
    operation: currentApplication?.record ?? null,
  }
  broadcastTypedEvent(IPC_CHANNELS.BACKGROUNDS_CHANGED, snapshot)
}

/** Rebuilds a committed descriptor at boot/Retry without applying, writing settings or notifying Unsplash.
 * @returns The saved display, or null for a missing local derivative while the saved source remains intact.
 * @example await restoreBackgroundDisplay(getSettings())
 */
async function restoreBackgroundDisplay(
  settings: Settings,
): Promise<BackgroundDisplay | null> {
  const selection = settings.background.selected
  if (!selection) return null
  const { source } = selection
  if (source.kind === 'unsplash') {
    return {
      selection,
      image: {
        url: backgroundPhotoUrl(source.photo, false),
        width: source.photo.width,
        height: source.photo.height,
      },
      crop: selection.crop,
      title:
        source.photo.altDescription ??
        source.photo.description ??
        'Unsplash photo',
      credit: backgroundPhotoCredit(source.photo),
    }
  }
  try {
    const info = getBackgroundSourceInfo(source, settings.background.uploads)
    if (!selection.displayId) return null
    return {
      selection,
      image: await readBackgroundDisplay(selection.displayId),
      crop: DEFAULT_BACKGROUND_CROP,
      title: info.title,
      credit: info.credit,
    }
  } catch {
    // Missing/corrupt settings or files never authorize sweeping the library.
    return null
  }
}

/** Hydrates the selected display after {@link loadSettings}, preserving newer selections while a local file is read.
 * @returns The latest snapshot, with no provider requests or operation replay on startup.
 * @example await initializeBackgrounds() // Call before creating renderer windows.
 */
export async function initializeBackgrounds(): Promise<BackgroundSnapshot> {
  const settings = getSettings()
  const startingRevision = snapshot.revision
  const retryRevision = snapshot.displayRetryRevision
  const display = await restoreBackgroundDisplay(settings)
  if (
    startingRevision === snapshot.revision &&
    retryRevision === snapshot.displayRetryRevision &&
    isDeepStrictEqual(
      settings.background.selected,
      getSettings().background.selected,
    )
  ) {
    snapshot = { ...snapshot, display }
    publishBackgroundSnapshot()
  }
  return snapshot
}

/** Reloads only the saved display on explicit Retry, giving both renderers a new image generation.
 * @returns The latest snapshot; ordinary operation updates never increment this reload generation.
 * @example await retryBackgroundDisplay() // No settings write, Apply or provider notification.
 */
export async function retryBackgroundDisplay(): Promise<BackgroundSnapshot> {
  snapshot = {
    ...snapshot,
    displayRetryRevision: snapshot.displayRetryRevision + 1,
  }
  return initializeBackgrounds()
}

/** Resolves validated local tokens or a bounded hotlink for the editor, including retained failed-operation drafts.
 * @returns A preview whose source dimensions remain distinct from its display dimensions.
 * @example await previewBackground({ kind: 'builtin', builtinId: 'alpine-lake' })
 */
export async function previewBackground(
  input: BackgroundApplySource,
): Promise<BackgroundPreview> {
  const source = BackgroundApplySourceSchema.parse(input)
  return source.kind === 'unsplash'
    ? previewOnlineBackground(source.photo)
    : getBackgroundPreview(source, getSettings().background.uploads)
}

/** Checks intent before preparation, remote effects and the final queued commit boundary.
 * @returns True only for the current, unsuperseded Apply.
 * @example isCurrentApplication(application) // false after Clear before commit.
 */
function isCurrentApplication(application: BackgroundApplication): boolean {
  return (
    currentApplication === application &&
    application.record.status === 'applying'
  )
}

/** Turns service failures into safe retained operation details for both-window notifications and Retry.
 * @returns A public failure without filesystem paths or provider response bodies.
 * @example backgroundOperationError(new Error('disk details')).code // 'save-failed'
 */
function backgroundOperationError(error: unknown): BackgroundOperationError {
  if (error instanceof BackgroundRemoteError) return error.detail
  if (error instanceof BackgroundImageError)
    return { code: error.code, message: error.message }
  return {
    code: 'save-failed',
    message:
      'The background could not be saved. Free some disk space or check permissions, then try again.',
  }
}

/** Cleans only a known unused display; a newer committed reference is always checked before unlinking.
 * @returns Cleanup completion; failed unlink is recorded without rolling back durable settings.
 * @example await discardUnusedDisplay(previousDisplayId)
 */
async function discardUnusedDisplay(
  displayId: string | undefined,
): Promise<void> {
  if (!displayId || getSettings().background.selected?.displayId === displayId)
    return
  await removeBackgroundDisplay(displayId).catch(() =>
    console.warn('[backgrounds] unused display cleanup failed'),
  )
}

/** Releases a finished operation's claimed input after its transaction outcome, retaining a current failed input for Retry.
 * @returns Cleanup completion; no operation input is removed during an accepted settings rename.
 * @example await releaseApplicationInput(application)
 */
async function releaseApplicationInput(
  application: BackgroundApplication,
): Promise<void> {
  if (!application.draftId || !application.settled) return
  if (
    currentApplication === application &&
    application.record.status === 'failed'
  )
    return
  const draftId = application.draftId
  application.draftId = null
  await finishBackgroundDraft(draftId, application.committed).catch(() =>
    console.warn('[backgrounds] abandoned upload cleanup failed'),
  )
}

/** Invalidates a pending/failed Apply synchronously; its running transaction owns cleanup until it settles.
 * @returns Nothing; a transaction already past its final check is allowed to finish before later queued intents.
 * @example supersedeApplication() // Clear cancels preparation, not an in-flight atomic rename.
 */
function supersedeApplication(): void {
  const application = currentApplication
  if (
    !application ||
    (application.record.status !== 'applying' &&
      application.record.status !== 'failed')
  )
    return
  application.record = { ...application.record, status: 'superseded' }
  publishBackgroundSnapshot()
  void releaseApplicationInput(application)
}

/** Matches a retry to the retained failure before transferring its owned input and provider acknowledgement.
 * @returns The failed application only when source, crop and aspect match exactly.
 * @example retryApplication(input) // null for a fresh Apply; throws for an obsolete retry ID.
 */
function retryApplication(
  input: BackgroundApplyInput,
): BackgroundApplication | null {
  if (input.retryOperationId === undefined) return null
  const previous = currentApplication
  if (
    !previous ||
    previous.record.status !== 'failed' ||
    previous.record.operationId !== input.retryOperationId ||
    !isDeepStrictEqual(input.source, previous.input.source) ||
    !isDeepStrictEqual(input.crop, previous.input.crop) ||
    input.aspect !== previous.input.aspect
  ) {
    throw new BackgroundImageError(
      'source-missing',
      'This background retry is no longer current. Choose the image again.',
    )
  }
  return previous
}

/** Accepts/claims an Apply synchronously before IPC replies, then lets Main finish without either renderer window.
 * @returns A deduplicated acceptance ID; completion is replayed through {@link getBackgroundSnapshot}.
 * @example applyBackground({ requestId, source, crop, aspect: 'original' })
 */
export function applyBackground(
  rawInput: BackgroundApplyInput,
): BackgroundApplyAcceptance {
  const input = BackgroundApplyInputSchema.parse(rawInput)
  const accepted = acceptedRequests.get(input.requestId)
  if (accepted) return accepted
  const retry = retryApplication(input)
  const draftId =
    input.source.kind === 'upload-draft' ? input.source.draftId : null
  const retainedInput =
    retry ??
    (draftId &&
    currentApplication?.record.status === 'failed' &&
    currentApplication.draftId === draftId
      ? currentApplication
      : null)
  const upload =
    retainedInput?.upload ?? (draftId ? claimBackgroundDraft(draftId) : null)
  // Edited failed uploads reuse their input too; only an exact retry inherits provider acknowledgement below.
  if (retainedInput) retainedInput.draftId = null
  supersedeApplication()
  const record: BackgroundOperation = {
    operationId: ++nextOperationId,
    requestId: input.requestId,
    source: input.source,
    crop: input.crop,
    aspect: input.aspect,
    status: 'applying',
  }
  const application: BackgroundApplication = {
    input,
    record,
    draftId,
    upload,
    notificationAcknowledged: retry?.notificationAcknowledged ?? false,
    committing: false,
    committed: false,
    settled: false,
  }
  currentApplication = application
  const acceptance = {
    operationId: record.operationId,
    requestId: record.requestId,
  }
  acceptedRequests.set(input.requestId, acceptance)
  publishBackgroundSnapshot()
  void runBackgroundApplication(application)
  return acceptance
}

/** Prepares real crop pixels outside the settings queue; local publication happens before any persistent reference.
 * @returns A complete display or null when a newer intent superseded the expensive work.
 * @example await prepareApplicationDisplay(application)
 */
async function prepareApplicationDisplay(
  application: BackgroundApplication,
): Promise<BackgroundDisplay | null> {
  const { source, crop, aspect } = application.input
  if (!isCurrentApplication(application)) return null
  if (source.kind === 'unsplash') {
    const image = await prepareOnlineBackground(source.photo, crop, () =>
      isCurrentApplication(application),
    )
    return {
      selection: { source, crop, aspect },
      image,
      crop,
      title:
        source.photo.altDescription ??
        source.photo.description ??
        'Unsplash photo',
      credit: backgroundPhotoCredit(source.photo),
    }
  }
  const uploads = getSettings().background.uploads
  const info = getBackgroundSourceInfo(source, uploads)
  const prepared = await prepareBackgroundDisplay(source, crop, uploads, () =>
    isCurrentApplication(application),
  )
  if (!prepared) return null
  // Publication failures still leave this output owned by the operation's finally cleanup.
  const selectedSource =
    source.kind === 'upload-draft' && application.upload
      ? { kind: 'upload' as const, uploadId: application.upload.id }
      : source
  if (selectedSource.kind === 'upload-draft')
    throw new BackgroundImageError(
      'source-missing',
      'The upload draft has expired.',
    )
  return {
    selection: {
      source: selectedSource,
      crop,
      aspect,
      displayId: prepared.displayId,
    },
    image: prepared.image,
    crop: DEFAULT_BACKGROUND_CROP,
    title: info.title,
    credit: info.credit,
  }
}

/** Adjusts active opacity once, only when every active value is still opaque at the successful commit boundary.
 * @returns Settings with the first-use adjustment, or unchanged preferences for custom/later applications.
 * @example firstApplicationOpacity(settings) // Entire 100 becomes 60 on the first successful image.
 */
function firstApplicationOpacity(settings: Settings): Settings {
  if (settings.background.hasAppliedImage) return settings
  if (settings.windowOpacityMode === 'entire') {
    return settings.windowBackgroundOpacityPercent ===
      WINDOW_OPACITY_MAX_PERCENT
      ? {
          ...settings,
          windowBackgroundOpacityPercent:
            BACKGROUND_FIRST_APPLY_OPACITY_PERCENT,
        }
      : settings
  }
  const sections = [
    settings.leftSectionOpacityPercent,
    settings.centerSectionOpacityPercent,
    settings.rightSectionOpacityPercent,
  ]
  return sections.every((value) => value === WINDOW_OPACITY_MAX_PERCENT)
    ? {
        ...settings,
        leftSectionOpacityPercent: BACKGROUND_FIRST_APPLY_OPACITY_PERCENT,
        centerSectionOpacityPercent: BACKGROUND_FIRST_APPLY_OPACITY_PERCENT,
        rightSectionOpacityPercent: BACKGROUND_FIRST_APPLY_OPACITY_PERCENT,
      }
    : settings
}

/** Sends existing settings synchronization before the background snapshot, while still inside the durable save queue.
 * @returns Nothing; no-op layout/removal requests produce no redundant write or broadcast.
 * @example publishBackgroundSettings(next, previous)
 */
function publishBackgroundSettings(next: Settings, previous: Settings): void {
  if (next === previous) return
  broadcastTypedEvent(IPC_CHANNELS.SETTINGS_CHANGED, { settings: next })
  publishBackgroundSnapshot()
}

/** Commits selection, library and first-use opacity together after the final current-intent/source check.
 * @returns Completion; later intents cannot remove this operation's files until its atomic transaction finishes.
 * @example await commitApplication(application, preparedDisplay)
 */
async function commitApplication(
  application: BackgroundApplication,
  display: BackgroundDisplay,
): Promise<void> {
  let previousDisplayId: string | undefined
  let opacityAdjusted = false
  await updateSettings(
    (current) => {
      if (!isCurrentApplication(application)) return current
      const source = application.input.source
      if (
        source.kind === 'upload' &&
        !current.background.uploads.some(
          (upload) => upload.id === source.uploadId,
        )
      ) {
        throw new BackgroundImageError(
          'source-missing',
          'This image was removed from your library. Choose another image.',
        )
      }
      // This final check is the commit boundary: Clear/Remove/new Apply now order after the complete atomic write.
      application.committing = true
      previousDisplayId = current.background.selected?.displayId
      const adjusted = firstApplicationOpacity(current)
      opacityAdjusted = adjusted !== current
      const uploads =
        application.upload &&
        !current.background.uploads.some(
          (upload) => upload.id === application.upload?.id,
        )
          ? [...current.background.uploads, application.upload]
          : current.background.uploads
      return {
        ...adjusted,
        background: {
          ...current.background,
          uploads,
          selected: display.selection,
          hasAppliedImage: true,
        },
      }
    },
    (next, previous) => {
      if (!application.committing) return
      application.committed = true
      snapshot = { ...snapshot, display }
      if (isCurrentApplication(application))
        application.record = {
          ...application.record,
          status: 'succeeded',
          opacityAdjusted,
        }
      publishBackgroundSettings(next, previous)
      // An unchanged online selection still completes a newly accepted Apply in both windows.
      if (next === previous) publishBackgroundSnapshot()
    },
  )
  await discardUnusedDisplay(previousDisplayId)
}

/** Notifies only a newly applied online photo, after the last intent check and before its queued commit.
 * @returns Completion after acknowledgement, or no side effect for local/same-photo/already-acknowledged work.
 * @example await notifyApplicationIfNeeded(application)
 */
async function notifyApplicationIfNeeded(
  application: BackgroundApplication,
): Promise<void> {
  const { source } = application.input
  if (source.kind !== 'unsplash' || application.notificationAcknowledged) return
  const currentSource = getSettings().background.selected?.source
  if (
    currentSource?.kind === 'unsplash' &&
    source.photo.id === currentSource.photo.id
  )
    return
  // The current-intent check directly precedes the only remote side effect; it is not a notification retry loop.
  if (!isCurrentApplication(application)) return
  await notifyBackgroundDownload(source.photo)
  application.notificationAcknowledged = true
}

/** Orchestrates one accepted Apply, retaining acknowledged notification success only for its exact failed-input retry.
 * @returns Completion after safe output cleanup; all failures become the current operation's replayable result.
 * @example void runBackgroundApplication(application)
 */
async function runBackgroundApplication(
  application: BackgroundApplication,
): Promise<void> {
  let display: BackgroundDisplay | null = null
  try {
    display = await prepareApplicationDisplay(application)
    if (!display || !isCurrentApplication(application)) return
    if (application.draftId) await publishBackgroundDraft(application.draftId)
    if (!isCurrentApplication(application)) return
    await notifyApplicationIfNeeded(application)
    await commitApplication(application, display)
  } catch (error) {
    if (isCurrentApplication(application)) {
      application.record = {
        ...application.record,
        status: 'failed',
        error: backgroundOperationError(error),
      }
      publishBackgroundSnapshot()
    }
  } finally {
    application.settled = true
    if (!application.committed)
      await discardUnusedDisplay(display?.selection.displayId)
    await releaseApplicationInput(application)
  }
}

/** Clears the selected reference through the save queue while preserving the library, layout and first-use preferences.
 * @returns Durable settings; a Clear before Apply's final check leaves its unused first-use flag untouched.
 * @example await clearBackground() // Pending preparation becomes superseded immediately.
 */
export async function clearBackground(): Promise<Settings> {
  supersedeApplication()
  let previousDisplayId: string | undefined
  const next = await updateSettings(
    (current) => {
      previousDisplayId = current.background.selected?.displayId
      return {
        ...current,
        background: { ...current.background, selected: null },
      }
    },
    (saved, previous) => {
      snapshot = { ...snapshot, display: null }
      publishBackgroundSettings(saved, previous)
    },
  )
  await discardUnusedDisplay(previousDisplayId)
  return next
}

/** Removes exactly one owned library image; only removal of the pending source supersedes Apply.
 * @returns Durable settings after reference removal; unlink failures never restore removed references.
 * @example await removeUploadedBackground(uploadId) // Removing selected A keeps pending B alive.
 */
export async function removeUploadedBackground(
  input: string,
): Promise<Settings> {
  const uploadId = BackgroundOwnedIdSchema.parse(input)
  const pendingSource = currentApplication?.input.source
  if (pendingSource?.kind === 'upload' && pendingSource.uploadId === uploadId)
    supersedeApplication()
  let removed = false
  let previousDisplayId: string | undefined
  const next = await updateSettings(
    (current) => {
      removed = current.background.uploads.some(
        (upload) => upload.id === uploadId,
      )
      if (!removed) return current
      const selected = current.background.selected
      const clearSelected =
        selected?.source.kind === 'upload' &&
        selected.source.uploadId === uploadId
      if (clearSelected) previousDisplayId = selected.displayId
      return {
        ...current,
        background: {
          ...current.background,
          uploads: current.background.uploads.filter(
            (upload) => upload.id !== uploadId,
          ),
          selected: clearSelected ? null : selected,
        },
      }
    },
    (saved, previous) => {
      if (saved.background.selected === null)
        snapshot = { ...snapshot, display: null }
      publishBackgroundSettings(saved, previous)
    },
  )
  try {
    if (removed) await removeBackgroundUpload(uploadId)
  } catch {
    // Reference removal is already durable; report incomplete cleanup without restoring older settings.
    throw new BackgroundImageError(
      'save-failed',
      'The image was removed from the gallery, but its local copy could not be deleted. Check disk permissions.',
    )
  } finally {
    await discardUnusedDisplay(previousDisplayId)
  }
  return next
}

/** Persists layout independently of an in-flight Apply, merging with its latest committed library and selection.
 * @returns Durable settings; an unchanged layout is a structural no-op.
 * @example await setBackgroundLayout('fit')
 */
export async function setBackgroundLayout(
  input: BackgroundLayout,
): Promise<Settings> {
  const layout = BackgroundLayoutSchema.parse(input)
  return updateSettings(
    (current) => ({
      ...current,
      background: { ...current.background, layout },
    }),
    publishBackgroundSettings,
  )
}
