/**
 * Hides empty agent disclosures when the sidebar and its overflow menu render.
 * @param hiddenAgentCount - Number of installed agents hidden in Settings.
 * @returns The disclosure label, or null when there are no hidden agents.
 * @example getHiddenAgentsLabel(2) // '2 hidden'
 */
export function getHiddenAgentsLabel(hiddenAgentCount: number): string | null {
  return hiddenAgentCount > 0 ? `${hiddenAgentCount} hidden` : null
}
