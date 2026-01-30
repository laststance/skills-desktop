import { registerAgentsHandlers } from './agents'
import { registerFilesHandlers } from './files'
import { registerSkillsHandlers } from './skills'
import { registerSourceHandlers } from './source'

/**
 * Register all IPC handlers for main process
 * Called once during app initialization
 */
export function registerAllHandlers(): void {
  registerSkillsHandlers()
  registerAgentsHandlers()
  registerSourceHandlers()
  registerFilesHandlers()
}
