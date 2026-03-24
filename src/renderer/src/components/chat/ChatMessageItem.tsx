import { Bot, User } from 'lucide-react'
import React from 'react'
import Markdown from 'react-markdown'

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
export const ChatMessageItem = React.memo(function ChatMessageItem({
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
          className={`inline-block rounded-lg px-3 py-2 max-w-full text-left ${
            isUser
              ? 'text-sm bg-primary text-primary-foreground'
              : 'text-base bg-muted text-foreground'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{content}</p>
          ) : !content ? (
            <div className="flex items-center gap-1.5 py-1">
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:0ms]" />
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:150ms]" />
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            <Markdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold mt-4 mb-2 first:mt-0">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold mt-3 mb-2 first:mt-0">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-2 last:mb-0 break-words">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-5 mb-2 space-y-1">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="break-words">{children}</li>
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = /language-/.test(className || '')
                  return isBlock ? (
                    <pre className="bg-background/50 rounded-md p-3 my-2 overflow-x-auto">
                      <code className="text-sm font-mono">{children}</code>
                    </pre>
                  ) : (
                    <code
                      {...props}
                      className="bg-background/50 px-1.5 py-0.5 rounded text-sm font-mono"
                    >
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => <>{children}</>,
                strong: ({ children }) => (
                  <strong className="font-semibold">{children}</strong>
                ),
                a: ({ href, children }) => (
                  <button
                    type="button"
                    className="text-primary underline underline-offset-2"
                    onClick={() => {
                      if (href) void window.electron.shell.openExternal(href)
                    }}
                  >
                    {children}
                  </button>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="my-2 overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="border-b border-border">{children}</thead>
                ),
                th: ({ children }) => (
                  <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-1.5 border-b border-border/50">
                    {children}
                  </td>
                ),
                tr: ({ children }) => (
                  <tr className="hover:bg-background/30">{children}</tr>
                ),
              }}
            >
              {content}
            </Markdown>
          )}
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
})
