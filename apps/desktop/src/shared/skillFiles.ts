import type {
  AbsolutePath,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from './types'

/** Shared limits keep discovery, IPC payloads and the renderer cache bounded. */
export const SKILL_FILES_LIMITS = {
  activeRoots: 2,
  queuedRoots: 64,
  entries: 10_000,
  files: 2_000,
  bytes: 4 * 1024 * 1024,
  issues: 100,
  timeoutMs: 10_000,
  cachedRoots: 64,
  cachedFiles: 20_000,
  cachedBytes: 32 * 1024 * 1024,
} as const

export type SkillFilesCode =
  | 'denied'
  | 'missing'
  | 'unavailable'
  | 'cancelled'
  | 'timeout'
  | 'busy'
  | 'limit'

/** Relative directory markers describe only observed omissions, never guessed totals. */
export interface SkillFilesIssue {
  relativePath: string
  code: SkillFilesCode | 'depth'
}

export interface SkillFilesListing {
  status: 'complete' | 'partial' | 'error'
  files: SkillFile[]
  issues: SkillFilesIssue[]
  observedEntries: number
  code?: SkillFilesCode
}

export interface SkillFilesRequest {
  root: AbsolutePath
  requestId: string
  generation: number
}

export type SkillFileRead =
  | { status: 'ready'; kind: 'text'; data: SkillFileContent }
  | { status: 'ready'; kind: 'image'; data: SkillBinaryContent }
  | { status: 'error'; code: SkillFilesCode }

/** Creates a privacy-safe failure envelope at service and renderer boundaries.
 * @example const result = unavailableSkillFiles('busy')
 */
export function unavailableSkillFiles(code: SkillFilesCode): SkillFilesListing {
  return { status: 'error', files: [], issues: [], observedEntries: 0, code }
}
