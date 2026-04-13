import { IPC_CHANNELS } from '../../shared/ipc-channels'
import { fetchLeaderboard } from '../services/leaderboardService'

import { typedHandle } from './typedHandle'

/**
 * Register IPC handler for marketplace leaderboard.
 * Fetches and parses skills.sh HTML leaderboard pages in the main process.
 * Raw HTML never reaches the renderer, only structured SkillSearchResult[].
 */
export function registerLeaderboardHandlers(): void {
  typedHandle(IPC_CHANNELS.MARKETPLACE_LEADERBOARD, async (_, { filter }) => {
    return fetchLeaderboard(filter)
  })
}
