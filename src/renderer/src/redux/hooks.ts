import { useDispatch, useSelector } from 'react-redux'

import type { RootState, AppDispatch } from './store'

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
