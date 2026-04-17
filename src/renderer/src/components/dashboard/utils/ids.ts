import type { DashboardPageId, WidgetInstanceId } from '../types'

/**
 * Opaque random-id factory. Not a UUID — just enough entropy to avoid
 * collisions within a single user's persisted dashboard state.
 * 8 base-36 chars gives ~2.8 trillion possibilities, plenty for local use.
 *
 * @example
 * randomId('w')   // => "w_4f2k9s1m"
 * randomId('p')   // => "p_7gh2mn8x"
 */
function randomId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}_${time}${random}`
}

export const newWidgetInstanceId = (): WidgetInstanceId =>
  randomId('w') as WidgetInstanceId

export const newDashboardPageId = (): DashboardPageId =>
  randomId('p') as DashboardPageId
