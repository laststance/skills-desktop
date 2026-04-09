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
/** Skill name must not contain path separators to prevent directory traversal */
const skillNameString = z
  .string()
  .min(1)
  .regex(/^[^/\\]+$/, 'Skill name must not contain path separators')

export const IPC_ARG_SCHEMAS: Partial<Record<IpcInvokeChannel, z.ZodTuple>> = {
  // File operations — require non-empty path strings
  'files:list': z.tuple([nonEmptyString]),
  'files:read': z.tuple([nonEmptyString]),

  // CLI operations
  'skills:cli:search': z.tuple([z.string()]),
  'skills:cli:remove': z.tuple([nonEmptyString]),
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
      skillPath: nonEmptyString,
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
      linkPath: nonEmptyString,
      targetAgentIds: z.array(nonEmptyString).min(1),
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
