import { registerActivityHandlers } from './activity'
import { registerAgentsHandlers } from './agents'
import { registerCliCommandHandlers } from './cliCommand'
import { registerFilesHandlers } from './files'
import { registerFolderHandlers } from './folder'
import { registerLeaderboardHandlers } from './leaderboard'
import { registerSettingsHandlers } from './settings'
import { registerShellHandlers } from './shell'
import { registerSkillsHandlers } from './skills'
import { registerSkillsCliHandlers } from './skillsCli'
import { registerSourceHandlers } from './source'
import { registerSyncHandlers } from './sync'
import { registerUpdateHandlers } from './update'
import { registerWindowHandlers } from './window'

/**
 * Register all IPC handlers for main process
 * Called once during app initialization
 */
export function registerAllHandlers(): void {
  registerSkillsHandlers()
  registerSkillsCliHandlers()
  registerCliCommandHandlers()
  registerLeaderboardHandlers()
  registerAgentsHandlers()
  registerSourceHandlers()
  registerFilesHandlers()
  registerUpdateHandlers()
  registerSyncHandlers()
  registerActivityHandlers()
  registerShellHandlers()
  registerSettingsHandlers()
  registerFolderHandlers()
  registerWindowHandlers()
}
