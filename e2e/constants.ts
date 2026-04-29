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

/**
 * Stderr/stdout substrings that mean "the network rejected us, not the
 * registry". Matched case-insensitively so npm's mixed casing
 * (`ECONNREFUSED` vs `network connect`) both hit. Kept narrow on purpose:
 * a false-positive offline classification would silently skip the install
 * on an actual CLI bug.
 *
 * The bare URL `request to https://registry.npmjs.org` was REMOVED because
 * it also fires for TLS-cert and corporate-proxy failures (`unable to
 * verify the first certificate`, `tunneling socket could not be
 * established`) — neither of which is offline. Real network failures all
 * surface one of the codes below alongside the URL, so this set still
 * catches them via the code token.
 */
export const OFFLINE_STDERR_PATTERNS = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'getaddrinfo',
  'network timed out',
] as const

/** File the global-setup writes for fixtures to discover the snapshot HOME. */
export const SNAPSHOT_INFO_FILE = '.snapshot/info.json'
