import { fetchAgents } from './slices/agentsSlice'
import { fetchSkills } from './slices/skillsSlice'
import { fetchSourceStats } from './slices/uiSlice'
import type { AppDispatch } from './store'

/**
 * Refresh all data after a mutation (skill create/delete/unlink/copy/sync).
 * Dispatches fetchSkills, fetchAgents, and fetchSourceStats in parallel.
 * Centralises the 3-dispatch pattern used by every mutation dialog.
 * @param dispatch - Redux dispatch function
 * @example
 * const dispatch = useAppDispatch()
 * await dispatch(deleteSkill(skill))
 * refreshAllData(dispatch)
 */
export function refreshAllData(dispatch: AppDispatch): void {
  dispatch(fetchSkills())
  dispatch(fetchAgents())
  dispatch(fetchSourceStats())
}
