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

/** Hard cap on a single `npx skills ...` invocation during global-setup. */
export const SPAWN_TIMEOUT_MS = 60_000

/**
 * Grace window between SIGTERM and SIGKILL when a `runNpx` invocation hits
 * SPAWN_TIMEOUT_MS. Gives the child a chance to flush stderr and exit cleanly
 * before we hard-kill the process tree. 5s matches the `npm@9` shutdown hook
 * budget; raising it just delays CI failure without changing the diagnosis.
 */
export const KILL_ESCALATION_MS = 5_000

/**
 * Host the offline pre-flight resolves to decide whether the npm registry
 * is reachable. Same FQDN `npx skills add ...` would hit; resolving any
 * other host gives a false positive when corporate DNS only blocks npm.
 */
export const NPM_REGISTRY_HOST = 'registry.npmjs.org'

/**
 * DNS lookup budget for the offline pre-flight. Tuned short so a
 * confirmed-online runner adds at most 1 RTT to global-setup, but long
 * enough that a sluggish cold resolver does not falsely classify the
 * runner as offline. 2s aligns with `getaddrinfo` defaults on macOS.
 */
export const OFFLINE_DNS_TIMEOUT_MS = 2_000

/** File the global-setup writes for fixtures to discover the snapshot HOME. */
export const SNAPSHOT_INFO_FILE = '.snapshot/info.json'
