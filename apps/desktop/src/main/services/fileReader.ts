import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

import type {
  AbsolutePath,
  SkillBinaryContent,
  SkillFile,
  SkillFileContent,
} from '@/shared/types'
import { toAbsolutePath } from '@/shared/types'

import { readSkillFileDetailed, skillFilesScheduler } from './skillFiles'

/** Preserves the legacy list API while sharing the bounded process-wide discovery scheduler.
 * New renderer consumers use detailed outcomes; legacy callers still receive a readable subset or an empty array.
 * @example await listSkillFiles(root, senderFrameOwner)
 */
export async function listSkillFiles(
  skillPath: AbsolutePath,
  owner = 'legacy-service',
): Promise<SkillFile[]> {
  const result = await skillFilesScheduler.list(owner, {
    root: skillPath,
    requestId: randomUUID(),
    generation: 0,
  })
  return result.files
}

/** Adapts bounded text reads for older preload callers after their path has been allowlist-validated.
 * @example await readSkillFile(file.path)
 */
export async function readSkillFile(
  filePath: AbsolutePath,
): Promise<SkillFileContent | null> {
  const result = await readSkillFileDetailed(
    toAbsolutePath(dirname(filePath)),
    filePath,
  )
  return result.status === 'ready' && result.kind === 'text'
    ? result.data
    : null
}

/** Adapts bounded image reads to the existing nullable image-preview contract.
 * @example await readBinaryFile(image.path)
 */
export async function readBinaryFile(
  filePath: AbsolutePath,
): Promise<SkillBinaryContent | null> {
  const result = await readSkillFileDetailed(
    toAbsolutePath(dirname(filePath)),
    filePath,
  )
  return result.status === 'ready' && result.kind === 'image'
    ? result.data
    : null
}
