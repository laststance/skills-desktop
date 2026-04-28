import type { AgentId, Skill, SymlinkInfo } from '../../../shared/types'

/**
 * View-model for the Inspector's "Location" section.
 *
 * - `sourcePath`: where the skill files actually live on disk.
 * - `symlinkPath`: the agent's link path, only set when a specific agent is
 *   selected AND that agent's link points to a different location than the
 *   source. When undefined, the Inspector renders a single line; otherwise
 *   it renders both Source Files and Symlink rows.
 */
export interface LocationViewModel {
  sourcePath: Skill['path']
  symlinkPath?: SymlinkInfo['linkPath']
}

/**
 * Compute the Location view-model for the Inspector.
 *
 * A universal skill (e.g. `~/.agents/skills/foo`) is symlinked into each
 * agent's skills dir. When the user selects a specific agent in the sidebar,
 * the Inspector should show both the source path and the agent's symlink
 * path, so seeing `~/.agents/skills/...` while looking at OpenClaw is no
 * longer confusing.
 *
 * @param skill - The skill being inspected.
 * @param selectedAgentId - The currently selected agent in the sidebar, or null when no agent is selected.
 * @returns
 * - `sourcePath` is always `skill.path`.
 * - `symlinkPath` is set only when an agent is selected, that agent has a symlink for this skill, and the symlink path differs from the source path.
 * - Otherwise `symlinkPath` is undefined and the Inspector renders a single-line layout.
 * @example
 * // Universal skill viewed under OpenClaw → two-line layout
 * getLocationViewModel(
 *   { path: '/u/me/.agents/skills/foo', symlinks: [{ agentId: 'opencode', linkPath: '/u/me/.opencode/skills/foo', ... }] },
 *   'opencode',
 * )
 * // => { sourcePath: '/u/me/.agents/skills/foo', symlinkPath: '/u/me/.opencode/skills/foo' }
 *
 * // No agent selected → single-line layout
 * getLocationViewModel(skill, null)
 * // => { sourcePath: skill.path, symlinkPath: undefined }
 *
 * // Local skill (link path equals source path) → single-line layout
 * getLocationViewModel(
 *   { path: '/u/me/.cursor/skills/foo', symlinks: [{ agentId: 'cursor', linkPath: '/u/me/.cursor/skills/foo', ... }] },
 *   'cursor',
 * )
 * // => { sourcePath: '/u/me/.cursor/skills/foo', symlinkPath: undefined }
 */
export function getLocationViewModel(
  skill: Skill,
  selectedAgentId: AgentId | null,
): LocationViewModel {
  const selectedSymlink = selectedAgentId
    ? skill.symlinks.find((s) => s.agentId === selectedAgentId)
    : undefined
  return {
    sourcePath: skill.path,
    symlinkPath:
      selectedSymlink && selectedSymlink.linkPath !== skill.path
        ? selectedSymlink.linkPath
        : undefined,
  }
}
