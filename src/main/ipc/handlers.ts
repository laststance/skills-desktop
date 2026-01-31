import { registerAgentsHandlers } from './agents'
import { registerFilesHandlers } from './files'
import { registerSkillsHandlers } from './skills'
import { registerSkillsCliHandlers } from './skillsCli'
import { registerSourceHandlers } from './source'
import { registerUpdateHandlers } from './update'

/**
 * Register all IPC handlers for main process
 * Called once during app initialization
 */
export function registerAllHandlers(): void {
  registerSkillsHandlers()
  registerSkillsCliHandlers()
  registerAgentsHandlers()
  registerSourceHandlers()
  registerFilesHandlers()
  registerUpdateHandlers()
}
