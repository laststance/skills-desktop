import { useDispatch, useSelector, useStore } from 'react-redux'

import type { RootState, AppDispatch, AppStore } from './store'

/**
 * Typed dispatch hook for Redux actions
 * @returns Typed dispatch function
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()

/**
 * Typed selector hook for Redux state
 * @returns Typed selector function
 */
export const useAppSelector = useSelector.withTypes<RootState>()

/**
 * Reads the current provider store when asynchronous actions must recheck state after awaiting work.
 * @returns The typed store whose getState reads the latest state without a render closure.
 * @example const hiddenIds = useAppStore().getState().settings.hiddenAgentIds
 */
export const useAppStore = useStore.withTypes<AppStore>()
