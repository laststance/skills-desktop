/**
 * IPC event recorder for E2E tests.
 * Active only when `__E2E_BUILD__` is true (via `E2E_BUILD=1` build flag).
 * Normal builds tree-shake the push call to a no-op so production users
 * never accumulate event payloads in memory.
 */
export interface RecordedIpcEvent {
  channel: string
  data: unknown
  timestamp: number
}

export const recordedIpcEvents: RecordedIpcEvent[] = []

export function recordIpcEvent(channel: string, data: unknown): void {
  if (!__E2E_BUILD__) return
  recordedIpcEvents.push({ channel, data, timestamp: Date.now() })
}
