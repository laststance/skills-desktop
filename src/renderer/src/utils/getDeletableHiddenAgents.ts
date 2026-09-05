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
 * Select independently owned folders for the hidden-agent menu's bulk-delete review.
 * @param hiddenAgents - Already-hidden agents from the sidebar's current scan.
 * @returns Existing real directories whose definitions do not share a scan path.
 * @example getDeletableHiddenAgents([hiddenCline, hiddenAmp]) // => [hiddenCline]
 */
export function getDeletableHiddenAgents(
  hiddenAgents: readonly Agent[],
): Agent[] {
  return hiddenAgents.filter((agent) => {
    const definition = AGENT_DEFINITIONS.find(
      (candidate) => candidate.id === agent.id,
    )

    // Main revalidates the reviewed identity and resolves shared-path aliases before deletion.
    return (
      agent.exists &&
      agent.filesystemIdentity?.kind === 'directory' &&
      definition !== undefined &&
      !sharedScanDirectories.has(definition.scanDir)
    )
  })
}
