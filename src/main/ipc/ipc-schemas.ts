import { z } from 'zod'

import { TERMINAL_APP_IDS } from '@/shared/constants'
import type { IpcInvokeChannel } from '@/shared/ipc-contract'
import { SettingsSchema } from '@/shared/settings'

/**
 * Zod schemas for runtime validation of IPC invoke arguments.
 * Channels not listed here accept no args and skip validation.
 * Keyed by IpcInvokeChannel to auto-match in typedHandle.
 * @example
 * IPC_ARG_SCHEMAS['files:read'] // z.tuple([z.string().min(1)])
 */

const nonEmptyString = z.string().min(1)

/**
 * Absolute POSIX path validator for IPC channels that hand a path to
 * `shell.openPath` / `spawn('open', …)`. The leading-slash refine catches
 * relative paths early (a renderer bug or a tampered call) before they reach
 * the OS — `shell.openPath('relative/path')` resolves against the main
 * process's cwd, which is almost never what the user expects and may escape
 * the agent / source dir entirely.
 *
 * Symlink-loop protection (ELOOP) and not-found handling live in the
 * `folder.ts` handler — this is a syntactic guard only.
 *
 * @example
 * absolutePathArg.parse('/Users/me/.agents/skills') // ok
 * absolutePathArg.parse('relative/path')           // throws ZodError
 */
const absolutePathArg = z
  .string()
  .min(1)
  .refine((p) => p.startsWith('/'), {
    message: 'Path must be absolute (start with /)',
  })
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

/** Recorded symlink entry that lived in an agent dir before delete. */
const symlinkRecordSchema = z.object({
  agentId: nonEmptyString,
  linkPath: nonEmptyString,
  target: nonEmptyString,
})

/** Recorded local-copy entry — a real (non-symlink) skill folder under an agent dir. */
const localCopyRecordSchema = z.object({
  agentId: nonEmptyString,
  linkPath: nonEmptyString,
})

/**
 * Legacy v1 manifest (no kind discriminator — always source-backed).
 * Read-only path: never written by current code. Normalized to v2 source-backed
 * via Zod transform so consumers see one shape regardless of on-disk version.
 * Removable in a future major once the 24h startupCleanup TTL has flushed all
 * pre-upgrade tombstones.
 */
const manifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    deletedAt: z.number().int().positive(),
    skillName: skillNameString,
    sourcePath: nonEmptyString,
    symlinks: z.array(symlinkRecordSchema),
  })
  .transform((legacy) => ({
    schemaVersion: 2 as const,
    kind: 'source-backed' as const,
    deletedAt: legacy.deletedAt,
    skillName: legacy.skillName,
    sourcePath: legacy.sourcePath,
    symlinks: legacy.symlinks,
  }))

/**
 * v2 source-backed manifest — produced when `~/.agents/skills/<name>` is the
 * authoritative source dir and agent entries are symlinks pointing at it.
 */
const manifestV2SourceBackedSchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal('source-backed'),
  deletedAt: z.number().int().positive(),
  skillName: skillNameString,
  sourcePath: nonEmptyString,
  symlinks: z.array(symlinkRecordSchema),
})

/**
 * v2 local-only manifest — produced when no source dir exists but one or more
 * agent dirs hold a real (non-symlink) folder for the skill. Each agent folder
 * is moved to `<entryDir>/local-copies/<agentId>/` and recorded here so
 * `restore()` can put each copy back exactly where it came from.
 */
const manifestV2LocalOnlySchema = z.object({
  schemaVersion: z.literal(2),
  kind: z.literal('local-only'),
  deletedAt: z.number().int().positive(),
  skillName: skillNameString,
  localCopies: z.array(localCopyRecordSchema).min(1),
})

/**
 * Trash manifest schema written on every moveToTrash.
 * Validated via Zod before `trashService.restore()` touches the filesystem
 * — bad JSON or injected fields fail at the boundary, not via `JSON.parse` alone.
 * Each `linkPath` is re-validated with `validatePath` against the agent's base
 * directory before any fs op, so an attacker-crafted manifest still cannot point
 * outside the agent's allowed base (defense in depth).
 *
 * Discriminated on `kind` after Zod parsing — v1 manifests are normalized to
 * `{kind: 'source-backed', schemaVersion: 2}` so consumers don't branch on
 * version separately from kind.
 * @example
 * // v2 source-backed
 * {
 *   schemaVersion: 2,
 *   kind: 'source-backed',
 *   deletedAt: 1729180800000,
 *   skillName: 'theme-generator',
 *   sourcePath: '/Users/me/.agents/skills/theme-generator',
 *   symlinks: [{ agentId: 'cursor', linkPath: '/Users/me/.cursor/skills/theme-generator', target: '/Users/me/.agents/skills/theme-generator' }]
 * }
 * @example
 * // v2 local-only
 * {
 *   schemaVersion: 2,
 *   kind: 'local-only',
 *   deletedAt: 1729180800000,
 *   skillName: 'architecture-decision-records',
 *   localCopies: [{ agentId: 'claude', linkPath: '/Users/me/.claude/skills/architecture-decision-records' }]
 * }
 */
export const manifestSchema = z.union([
  manifestV2SourceBackedSchema,
  manifestV2LocalOnlySchema,
  manifestV1Schema,
])

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
  // Optional `agentId` scopes preview/execute to a single agent — used by
  // the per-agent Cleanup flow surfaced from AgentItem's context menu.
  'sync:preview': z.tuple([
    z
      .object({
        agentId: nonEmptyString.optional(),
      })
      .optional(),
  ]),
  'sync:execute': z.tuple([
    z.object({
      replaceConflicts: z.array(z.string()),
      agentId: nonEmptyString.optional(),
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

  // Settings — partial<Settings> with explicit allowed keys/values.
  // Matches src/shared/settings.ts; widening that schema must widen
  // this one too. Defense-in-depth so a compromised renderer cannot write
  // arbitrary JSON into settings.json.
  'settings:set': z.tuple([
    z
      .object({
        defaultSkillTab: z.enum(['files', 'info']).optional(),
        preferredTerminal: z.enum(TERMINAL_APP_IDS).optional(),
        // Direct re-export from SettingsSchema — drift between the two
        // constraint sets is mechanically impossible. `.shape` access yields
        // the field's ZodOptional<ZodString> exactly as defined in settings.ts.
        customTerminalAppName: SettingsSchema.shape.customTerminalAppName,
        // Same source-of-truth pattern: re-use the schema's own field so
        // the {min,int} constraints can never drift. `undefined` is how
        // the Settings UI clears the persisted size back to "use default".
        windowSize: SettingsSchema.shape.windowSize,
        // Reuse `SettingsSchema.shape.hiddenAgentIds` so the `z.enum(AGENT_IDS)`
        // constraint here cannot drift from the persisted-state validator.
        // `.optional()` lets clients send a partial update (only this key).
        hiddenAgentIds: SettingsSchema.shape.hiddenAgentIds.optional(),
      })
      .strict(),
  ]),

  // Folder actions — `open -a` / `shell.openPath`. Path must be absolute;
  // see `absolutePathArg` for rationale.
  'folder:revealInFinder': z.tuple([absolutePathArg]),
  'folder:openInTerminal': z.tuple([absolutePathArg]),
}
