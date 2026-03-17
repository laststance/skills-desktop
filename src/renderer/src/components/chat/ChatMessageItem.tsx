import { Bot, User } from 'lucide-react'

import { ChatToolCall } from './ChatToolCall'

interface ToolCallInfo {
  toolCallId: string
  toolName: string
  input: string
  output: string | null
  status: 'running' | 'done' | 'error'
}

interface ChatMessageItemProps {
  role: 'user' | 'assistant'
  content: string
  toolCalls: ToolCallInfo[]
}

/**
 * Single chat message bubble (user or assistant)
 * Assistant messages include tool call displays
 */
export function ChatMessageItem({
  role,
  content,
  toolCalls,
}: ChatMessageItemProps): React.ReactElement {
  const isUser = role === 'user'

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center ${
          isUser ? 'bg-primary/20' : 'bg-muted'
        }`}
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div
          className={`inline-block text-sm rounded-lg px-3 py-2 max-w-full ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{content}</p>
        </div>
        {toolCalls.map((tc) => (
          <ChatToolCall
            key={tc.toolCallId}
            toolName={tc.toolName}
            input={tc.input}
            output={tc.output}
            status={tc.status}
          />
        ))}
      </div>
    </div>
  )
}
