import { useEffect, useRef } from 'react'

import { ScrollArea } from '../ui/scroll-area'

import { ChatMessageItem } from './ChatMessageItem'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: {
    toolCallId: string
    toolName: string
    input: string
    output: string | null
    status: 'running' | 'done' | 'error'
  }[]
}

interface ChatMessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
}

/**
 * Scrollable list of chat messages with auto-scroll on new content
 */
export function ChatMessageList({
  messages,
  isStreaming,
}: ChatMessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isStreaming])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted-foreground text-center">
          Ask about skills, get help managing them, or test them in a sandbox.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-3">
        {messages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            role={msg.role}
            content={msg.content}
            toolCalls={msg.toolCalls}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
