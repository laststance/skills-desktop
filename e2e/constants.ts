/**
 * Constants shared across global-setup, fixtures, and helpers.
 * The skills CLI version is pinned to match the renderer's runtime constant.
 */
export const SKILLS_CLI_VERSION = '1.5.1'

/**
 * The 7 azure-* skills installed during global-setup.
 * Pre-installed once into a snapshot HOME, then hardlink-copied into each
 * test's working HOME for a ~50ms reset between specs.
 */
export const AZURE_SKILLS_REPO = 'microsoft/azure-skills'
export const AZURE_SKILL_NAMES = [
  'azure-ai',
  'azure-deploy',
  'azure-prepare',
  'azure-diagnostics',
  'azure-compute',
  'azure-validate',
  'azure-storage',
] as const

export type AzureSkillName = (typeof AZURE_SKILL_NAMES)[number]

/** File the global-setup writes for fixtures to discover the snapshot HOME. */
export const SNAPSHOT_INFO_FILE = '.snapshot/info.json'
