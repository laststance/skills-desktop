import { useEffect } from 'react'

import { useAppDispatch } from '../redux/hooks'
import { setInstallProgress } from '../redux/slices/marketplaceSlice'

/**
 * Hook to subscribe to skill installation progress events
 * Sets up IPC listener and cleans up on unmount
 */
export function useMarketplaceProgress(): void {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const cleanup = window.electron.skillsCli.onProgress((progress) => {
      dispatch(setInstallProgress(progress))
    })

    return cleanup
  }, [dispatch])
}
