import { toast } from 'sonner'

import { useAppStore } from '@/renderer/src/redux/hooks'
import { setSettings } from '@/renderer/src/redux/slices/settingsSlice'
import type { SettingsPatch } from '@/shared/settings'

/**
 * Saves edits from either window and reconciles canonical responses only while their optimistic snapshot is still current.
 * @returns A partial-settings update callback with visible, race-safe failure recovery.
 * @example const updateSettings = useUpdateSettings(); updateSettings({ windowBackgroundOpacityPercent: 85 })
 */
export function useUpdateSettings(): (partial: SettingsPatch) => void {
  const store = useAppStore()

  return (partial): void => {
    // Read the store now: two edits in one render must not merge against the same stale closure.
    store.dispatch(setSettings({ ...store.getState().settings, ...partial }))
    const optimistic = store.getState().settings

    // Even a no-op save must reconcile failed fields: main sends no broadcast for unchanged settings.
    void window.electron.settings
      .set(partial)
      .then((persisted) => {
        if (store.getState().settings === optimistic) {
          store.dispatch(setSettings(persisted))
        }
      })
      .catch(async (error: unknown) => {
        console.error('Settings save failed', error)
        toast.error('Settings could not be saved', {
          id: 'settings-save-error',
          description: 'Your change was not saved. Try again.',
        })
        if (store.getState().settings !== optimistic) return

        try {
          const persisted = await window.electron.settings.get()
          if (store.getState().settings === optimistic) {
            store.dispatch(setSettings(persisted))
          }
        } catch (error: unknown) {
          console.error('Settings recovery failed', error)
          // A newer edit or broadcast also makes this recovery failure obsolete.
          if (store.getState().settings !== optimistic) return
          toast.error('Settings could not be reloaded', {
            id: 'settings-save-error',
            description: 'Reload this window to recover your saved settings.',
            duration: Infinity,
            closeButton: true,
            action: {
              label: 'Reload',
              onClick: () => window.location.reload(),
            },
          })
        }
      })
  }
}
