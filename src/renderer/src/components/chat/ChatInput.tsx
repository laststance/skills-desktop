import { FlaskConical, Send, Square, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '../ui/button'

interface ChatInputProps {
  isStreaming: boolean
  sandboxActive: boolean
  onSend: (message: string) => void
  onAbort: () => void
  onCreateSandbox: () => void
  onClear: () => void
}

/**
 * Chat input with send/abort and action buttons (sandbox, clear)
 */
export function ChatInput({
  isStreaming,
  sandboxActive,
  onSend,
  onAbort,
  onCreateSandbox,
  onClear,
}: ChatInputProps): React.ReactElement {
  const [input, setInput] = useState('')

  const handleSubmit = (): void => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-2">
      <div className="flex gap-2">
        <textarea
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          rows={2}
          placeholder="Ask about skills..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <Button
            variant="destructive"
            size="icon"
            className="shrink-0 self-end"
            onClick={onAbort}
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            variant="default"
            size="icon"
            className="shrink-0 self-end"
            onClick={handleSubmit}
            disabled={!input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex gap-1">
        {!sandboxActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onCreateSandbox}
            disabled={isStreaming}
          >
            <FlaskConical className="h-3 w-3 mr-1" />
            Sandbox
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onClear}
          disabled={isStreaming}
        >
          <Trash2 className="h-3 w-3 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  )
}
