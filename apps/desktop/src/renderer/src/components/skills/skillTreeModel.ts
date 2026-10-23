import type { SkillFilesListing } from '@/shared/skillFiles'
import type { Skill, SkillFile } from '@/shared/types'

export type SkillTreeNode =
  | { kind: 'root'; skill: Skill; label: string }
  | { kind: 'directory'; skill: Skill; label: string }
  | { kind: 'file'; skill: Skill; label: string; file: SkillFile }
  | { kind: 'notice'; skill: Skill; label: string }

/** Encodes actual path segments, preserving literal backslashes, percent signs and Unicode.
 * The resulting IDs are presentation identities only; callers always use the explicit file map for IPC.
 * @example skillTreeFileId('r1/', file) // 'r1/guides/a%5Cb.md'
 */
export function skillTreeFileId(root: string, file: SkillFile): string {
  return root + file.relativePath.split('/').map(encodeURIComponent).join('/')
}

/** Builds input for Pierre's hierarchy model without maintaining a second expansion engine.
 * Root order follows the filtered skill list; notices are read-only descendants, never bulk targets.
 * @example const input = buildSkillTree(skills, ids, listings)
 */
export function buildSkillTree(
  skills: readonly Skill[],
  ids: ReadonlyMap<string, string>,
  listings: ReadonlyMap<
    string,
    { result?: SkillFilesListing; pending?: unknown }
  >,
) {
  const nodes = new Map<string, SkillTreeNode>()
  const paths: string[] = []
  for (const skill of skills) {
    const root = ids.get(skill.path)!
    // Duplicate scanner paths still identify one directory and must not duplicate model nodes.
    if (nodes.has(root)) continue
    nodes.set(root, { kind: 'root', skill, label: skill.name })
    paths.push(root)
    const listing = listings.get(skill.path)
    for (const file of listing?.result?.files ?? []) {
      const segments = file.relativePath.split('/')
      let parent = root
      for (const segment of segments.slice(0, -1)) {
        parent += `${encodeURIComponent(segment)}/`
        nodes.set(parent, { kind: 'directory', skill, label: segment })
      }
      const id = skillTreeFileId(root, file)
      paths.push(id)
      nodes.set(id, { kind: 'file', skill, file, label: file.name })
    }
    const result = listing?.result
    if (!result || result.status !== 'complete' || result.files.length === 0) {
      const label = getListingNotice(listing)
      const id = `${root}$notice`
      paths.push(id)
      nodes.set(id, { kind: 'notice', skill, label })
    }
    for (const issue of result?.issues ?? []) {
      if (!issue.relativePath) continue
      let parent = root
      for (const segment of issue.relativePath.split('/')) {
        parent += `${encodeURIComponent(segment)}/`
        nodes.set(parent, { kind: 'directory', skill, label: segment })
      }
      const notice = parent + '$notice'
      paths.push(notice)
      nodes.set(notice, {
        kind: 'notice',
        skill,
        label:
          issue.code === 'depth'
            ? 'Preview depth limit reached'
            : 'Folder could not be listed',
      })
    }
  }
  return { paths, nodes }
}

/** Gives complete-empty, loading and recoverable failures distinct observable copy.
 * @example getListingNotice({ result: unavailableSkillFiles('missing') })
 */
function getListingNotice(
  listing: { pending?: unknown; result?: SkillFilesListing } | undefined,
): string {
  if (listing?.pending) return 'Loading files…'
  const result = listing?.result
  if (!result) return 'Expand to load files'
  switch (result.code) {
    case 'missing':
      return 'Skill folder is missing · Rescan'
    case 'denied':
      return 'Folder access denied'
    case 'limit':
      return 'Showing a limited set of files'
    case 'busy':
      return 'Collapse another skill, then Retry'
    default:
      break
  }
  if (result.status === 'error') return 'Files unavailable · Retry'
  if (result.status === 'partial') return 'Some folders could not be listed'
  return 'No previewable files'
}
