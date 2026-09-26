import type { AgentFolderGroup } from '@/renderer/src/redux/slices/uiSlice'
import { AGENT_DEFINITIONS } from '@/shared/constants'
import type { Agent } from '@/shared/types'

// The universal source and scan directories shared by agent definitions must stay intact.
const sharedScanDirectories = new Set<string>([
  '.agents',
  ...AGENT_DEFINITIONS.filter((definition) =>
    AGENT_DEFINITIONS.some(
      (otherDefinition) =>
        otherDefinition.id !== definition.id &&
        otherDefinition.scanDir === definition.scanDir,
    ),
  ).map((definition) => definition.scanDir),
])

/**
 * Select independently owned folders when a sidebar group's bulk-delete review opens.
 * @param agents - Agents from the sidebar group's current scan.
 * @param group - Hidden skills folders or not-installed agents' empty parent folders.
 * @returns Existing real directories whose definitions do not share a scan path.
 * @example getDeletableAgentFolders([hiddenCline, hiddenAmp]) // => [hiddenCline]
 */
export function getDeletableAgentFolders(
  agents: readonly Agent[],
  group: AgentFolderGroup = 'hidden',
): Agent[] {
  return agents.filter((agent) => {
    const definition = AGENT_DEFINITIONS.find(
      (candidate) => candidate.id === agent.id,
    )

    // Main revalidates the reviewed identity and resolves shared-path aliases before deletion.
    return (
      (group === 'hidden'
        ? agent.exists && agent.filesystemIdentity?.kind === 'directory'
        : !agent.exists &&
          agent.emptyParentFolder?.filesystemIdentity.kind === 'directory') &&
      definition !== undefined &&
      !sharedScanDirectories.has(definition.scanDir)
    )
  })
}
