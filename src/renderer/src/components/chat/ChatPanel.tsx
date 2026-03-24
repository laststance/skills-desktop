import { Bot, MessageCircleQuestion } from 'lucide-react'
import { useCallback, useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  addUserMessage,
  clearMessages,
  clearPendingMessage,
  clearSandbox,
  setClaudeStatus,
  setPendingMessage,
  setSandbox,
} from '../../redux/slices/chatSlice'

import { ChatInput } from './ChatInput'
import { ChatMessageList } from './ChatMessageList'
import { ClaudeStatusBanner } from './ClaudeStatusBanner'
import { SandboxBar } from './SandboxBar'

/**
 * Agent Chat Panel — 4th column in Skills Desktop layout
 * Provides skill Q&A, management assistance, and sandbox testing
 */
export function ChatPanel(): React.ReactElement {
  const dispatch = useAppDispatch()
  const {
    messages,
    isStreaming,
    claudeAvailable,
    claudeVersion,
    sandboxPath,
    sandboxSkillName,
    error,
    pendingMessage,
  } = useAppSelector((state) => state.chat)
  const { selectedSkill, items: skills } = useAppSelector(
    (state) => state.skills,
  )

  // Detect Claude on mount
  useEffect(() => {
    window.electron.chat.detectClaude().then((status) => {
      dispatch(setClaudeStatus(status))
    })
  }, [dispatch])

  const handleRetryDetection = useCallback(() => {
    window.electron.chat.detectClaude().then((status) => {
      dispatch(setClaudeStatus(status))
    })
  }, [dispatch])

  const handleSend = useCallback(
    async (message: string) => {
      dispatch(addUserMessage(message))

      const skillContext = skills.map((s) => ({
        name: s.name,
        description: s.description,
      }))

      // Read full SKILL.md content for the selected skill
      // files.read() returns SkillFileContent | null, extract .content
      let activeSkillContent: string | null = null
      if (selectedSkill) {
        try {
          const skillMdPath = `${selectedSkill.path}/SKILL.md`
          const fileResult = await window.electron.files.read(skillMdPath)
          activeSkillContent = fileResult?.content ?? null
        } catch {
          // Fallback to description if SKILL.md read fails
          activeSkillContent = selectedSkill.description ?? null
        }
      }

      window.electron.chat.send({
        message,
        sandboxPath,
        skillContext,
        activeSkillContent,
      })
    },
    [dispatch, skills, sandboxPath, selectedSkill],
  )

  // Process pending messages from other components (e.g. Explain button)
  useEffect(() => {
    if (pendingMessage && !isStreaming && claudeAvailable) {
      handleSend(pendingMessage)
      dispatch(clearPendingMessage())
    }
  }, [pendingMessage, isStreaming, claudeAvailable, handleSend, dispatch])

  const handleAbort = useCallback(() => {
    window.electron.chat.abort()
  }, [])

  const handleCreateSandbox = useCallback(() => {
    const skillName = selectedSkill?.name ?? null
    window.electron.chat.createSandbox({ skillName }).then((result) => {
      dispatch(setSandbox({ path: result.path, skillName }))
    })
  }, [dispatch, selectedSkill])

  const handleCloseSandbox = useCallback(() => {
    if (sandboxPath) {
      window.electron.chat.cleanupSandbox(sandboxPath).then(() => {
        dispatch(clearSandbox())
      })
    }
  }, [dispatch, sandboxPath])

  const handleClear = useCallback(() => {
    dispatch(clearMessages())
  }, [dispatch])

  return (
    <aside className="h-full border-l border-border bg-card flex flex-col overflow-hidden">
      {/* Draggable title bar area */}
      <div className="h-8 drag-region shrink-0" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Bot className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium">Skills Assistant</span>
        <div className="ml-auto flex items-center gap-2">
          {selectedSkill && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs bg-muted hover:bg-muted/80 text-foreground rounded-md px-2 py-1 transition-colors"
              onClick={() =>
                dispatch(
                  setPendingMessage(
                    `Explain the "${selectedSkill.name}" skill: what it does, when to use it, and show usage examples.`,
                  ),
                )
              }
            >
              <MessageCircleQuestion className="h-3.5 w-3.5" />
              <span className="truncate max-w-[120px]">
                Explain {selectedSkill.name}
              </span>
            </button>
          )}
          {claudeVersion && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              v{claudeVersion}
            </span>
          )}
        </div>
      </div>

      {/* Sandbox bar */}
      {sandboxPath && (
        <SandboxBar
          sandboxPath={sandboxPath}
          skillName={sandboxSkillName}
          onClose={handleCloseSandbox}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Main content */}
      {claudeAvailable === false ? (
        <ClaudeStatusBanner onRetry={handleRetryDetection} />
      ) : (
        <ChatMessageList messages={messages} isStreaming={isStreaming} />
      )}

      {/* Input */}
      {claudeAvailable !== false && (
        <ChatInput
          isStreaming={isStreaming}
          sandboxActive={!!sandboxPath}
          onSend={handleSend}
          onAbort={handleAbort}
          onCreateSandbox={handleCreateSandbox}
          onClear={handleClear}
        />
      )}
    </aside>
  )
}
