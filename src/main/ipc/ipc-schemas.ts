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
      skillName: z.string(),
      agentId: z.string(),
      linkPath: nonEmptyString,
    }),
  ]),
  'skills:removeAllFromAgent': z.tuple([
    z.object({
      agentId: z.string(),
      agentPath: nonEmptyString,
    }),
  ]),
  'skills:deleteSkill': z.tuple([
    z.object({
      skillName: z.string(),
      skillPath: nonEmptyString,
    }),
  ]),
  'skills:createSymlinks': z.tuple([
    z.object({
      skillName: z.string(),
      skillPath: nonEmptyString,
      agentIds: z.array(z.string()).min(1),
    }),
  ]),
  'skills:copyToAgents': z.tuple([
    z.object({
      skillName: z.string(),
      linkPath: nonEmptyString,
      targetAgentIds: z.array(z.string()).min(1),
    }),
  ]),

  // Sync operations
  'sync:execute': z.tuple([
    z.object({
      replaceConflicts: z.array(z.string()),
    }),
  ]),

  // Chat operations
  'chat:send': z.tuple([
    z.object({
      message: nonEmptyString,
      sandboxPath: z.string().nullable(),
      skillContext: z.array(
        z.object({
          name: z.string(),
          description: z.string(),
        }),
      ),
      activeSkillContent: z.string().nullable(),
    }),
  ]),
  'chat:createSandbox': z.tuple([
    z.object({
      skillName: z.string().nullable(),
    }),
  ]),
  'chat:cleanupSandbox': z.tuple([nonEmptyString]),
}
