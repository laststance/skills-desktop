import { registerAgentsHandlers } from './agents'
import { registerFilesHandlers } from './files'
import { registerLeaderboardHandlers } from './leaderboard'
import { registerShellHandlers } from './shell'
import { registerSkillsHandlers } from './skills'
import { registerSkillsCliHandlers } from './skillsCli'
import { registerSourceHandlers } from './source'
import { registerSyncHandlers } from './sync'
import { registerUpdateHandlers } from './update'

/**
 * Register all IPC handlers for main process
 * Called once during app initialization
 */
export function registerAllHandlers(): void {
  registerSkillsHandlers()
  registerSkillsCliHandlers()
  registerLeaderboardHandlers()
  registerAgentsHandlers()
  registerSourceHandlers()
  registerFilesHandlers()
  registerUpdateHandlers()
  registerSyncHandlers()
  registerShellHandlers()
}
