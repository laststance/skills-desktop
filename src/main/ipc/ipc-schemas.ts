import { z } from 'zod'

import type { IpcInvokeChannel } from '../../shared/ipc-contract'

/**
 * Zod schemas for runtime validation of IPC invoke arguments.
 * Channels not listed here accept no args and skip validation.
 * Keyed by IpcInvokeChannel to auto-match in typedHandle.
 * @example
 * IPC_ARG_SCHEMAS['files:read'] // z.tuple([z.string().min(1)])
 */

const nonEmptyString = z.string().min(1)
/**
 * Skill name must not contain path separators (prevents `../` traversal) or
 * null bytes (defense in depth: some libc wrappers truncate at `\0`, which
 * could let `evil\0.good` pass a later string check while opening `evil`).
 */
const skillNameString = z
  .string()
  .min(1)
  .regex(/^[^/\\]+$/, 'Skill name must not contain path separators')
  .refine((s) => !s.includes('\0'), 'Skill name must not contain null bytes')

/**
 * Tombstone id format: `<unix_ms>-<skillName>-<rand8hex>`.
 * Regex blocks path separators in both skillName and rand8 segments so a
 * crafted id cannot escape `TRASH_DIR` when joined.
 * The trailing 8-hex group prevents same-ms entry collisions (reviewer iter-2 HIGH-4).
 * @example "1729180800000-theme-generator-a1b2c3d4"
 */
export const tombstoneIdSchema = z
  .string()
  .regex(/^\d+-[^/\\]+-[a-f0-9]{8}$/, 'Invalid tombstone id format')

/**
 * Trash manifest schema written on every moveToTrash.
 * Validated via Zod before `trashService.restore()` touches the filesystem
 * — bad JSON or injected fields fail at the boundary, not via `JSON.parse` alone.
 * Each `linkPath` is re-validated with `validatePath` against the agent's base
 * directory before any fs op, so an attacker-crafted manifest still cannot point
 * outside the agent's allowed base (defense in depth).
 * @example
 * {
 *   schemaVersion: 1,
 *   deletedAt: 1729180800000,
 *   skillName: 'theme-generator',
 *   sourcePath: '/Users/me/.agents/skills/theme-generator',
 *   symlinks: [{ agentId: 'cursor', linkPath: '/Users/me/.cursor/skills/theme-generator', target: '/Users/me/.agents/skills/theme-generator' }]
 * }
 */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  deletedAt: z.number().int().positive(),
  skillName: skillNameString,
  sourcePath: nonEmptyString,
  symlinks: z.array(
    z.object({
      agentId: nonEmptyString,
      linkPath: nonEmptyString,
      target: nonEmptyString,
    }),
  ),
})

export const IPC_ARG_SCHEMAS: Partial<Record<IpcInvokeChannel, z.ZodTuple>> = {
  // File operations — require non-empty path strings
  'files:list': z.tuple([nonEmptyString]),
  'files:read': z.tuple([nonEmptyString]),

  // CLI operations
  'skills:cli:search': z.tuple([z.string()]),
  'skills:cli:install': z.tuple([
    z.object({
      repo: nonEmptyString,
      global: z.boolean(),
      agents: z.array(z.string()),
      skills: z.array(z.string()).optional(),
    }),
  ]),
  'skills:cli:remove': z.tuple([
    z.object({
      skillName: skillNameString,
    }),
  ]),
  'skills:cli:removeBatch': z.tuple([
    z.object({
      // Cap batch size. Each item spawns an `npx skills remove` child process
      // (serial), so an unbounded array could pin a CPU core and exhaust file
      // descriptors on cold npm cache. 100 covers realistic user selections
      // with generous headroom while closing the local-DoS footprint.
      items: z
        .array(z.object({ skillName: skillNameString }))
        .min(1, 'At least one skill required for batch CLI remove')
        .max(100, 'Batch CLI remove limited to 100 skills'),
    }),
  ]),

  // Skills operations
  'skills:unlinkFromAgent': z.tuple([
    z.object({
      skillName: skillNameString,
      agentId: nonEmptyString,
      linkPath: nonEmptyString,
    }),
  ]),
  'skills:removeAllFromAgent': z.tuple([
    z.object({
      agentId: nonEmptyString,
      agentPath: nonEmptyString,
    }),
  ]),
  'skills:deleteSkill': z.tuple([
    z.object({
      skillName: skillNameString,
    }),
  ]),
  'skills:createSymlinks': z.tuple([
    z.object({
      skillName: skillNameString,
      skillPath: nonEmptyString,
      agentIds: z.array(nonEmptyString).min(1),
    }),
  ]),
  'skills:copyToAgents': z.tuple([
    z.object({
      skillName: skillNameString,
      sourcePath: nonEmptyString,
      targetAgentIds: z.array(nonEmptyString).min(1),
    }),
  ]),

  // Bulk delete + undo
  'skills:deleteSkills': z.tuple([
    z.object({
      items: z
        .array(z.object({ skillName: skillNameString }))
        .min(1, 'At least one skill required for batch delete'),
    }),
  ]),
  'skills:unlinkManyFromAgent': z.tuple([
    z.object({
      agentId: nonEmptyString,
      items: z
        .array(z.object({ skillName: skillNameString }))
        .min(1, 'At least one skill required for batch unlink'),
    }),
  ]),
  'skills:restoreDeletedSkill': z.tuple([
    z.object({
      tombstoneId: tombstoneIdSchema,
    }),
  ]),

  // Marketplace Leaderboard
  'marketplace:leaderboard': z.tuple([
    z.object({
      filter: z.enum(['all-time', 'trending', 'hot']),
    }),
  ]),

  // Sync operations
  'sync:execute': z.tuple([
    z.object({
      replaceConflicts: z.array(z.string()),
    }),
  ]),

  // Shell — restrict to http/https to prevent opening arbitrary URI schemes
  'shell:openExternal': z.tuple([
    z
      .string()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), {
        message: 'Only http(s) URLs are allowed',
      }),
  ]),
}
