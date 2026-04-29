import { expect } from '@playwright/test'

import type { RemoveAllFromAgentResult } from '../../src/shared/types'

/**
 * Assert the structured IRON RULE refusal triplet returned by
 * `removeAllFromAgent` when `isSharedAgentPath` short-circuits the handler:
 * `success: false`, `removedCount: 0`, and the human-readable refusal copy.
 *
 * Centralizing the assertion means a wording change in `skills.ts` only
 * needs to update one regex literal — without this, three IRON RULE specs
 * would each silently pass on a copy drift unless every match string was
 * audited.
 *
 * @example
 * const result = await appWindow.evaluate(...)
 * expectIronRuleRefusal(result)
 */
export function expectIronRuleRefusal(result: RemoveAllFromAgentResult): void {
  expect(result.success).toBe(false)
  expect(result.removedCount).toBe(0)
  expect(result.error).toMatch(/Refusing to delete a shared skills folder/)
}
