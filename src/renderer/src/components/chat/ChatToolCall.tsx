import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface ChatToolCallProps {
  toolName: string
  input: string
  output: string | null
  status: 'running' | 'done' | 'error'
}

/**
 * Collapsible tool call display within an assistant message
 * Shows tool name, status indicator, and expandable input/output
 */
export function ChatToolCall({
  toolName,
  input,
  output,
  status,
}: ChatToolCallProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="my-1 rounded border border-border/50 bg-muted/30 text-xs">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-mono text-muted-foreground">{toolName}</span>
        {status === 'running' && (
          <Loader2 className="h-3 w-3 animate-spin text-blue-400 ml-auto" />
        )}
        {status === 'done' && (
          <span className="text-emerald-400 ml-auto">✓</span>
        )}
        {status === 'error' && <span className="text-red-400 ml-auto">✗</span>}
      </button>
      {isOpen && (
        <div className="px-2 pb-2 space-y-1">
          {input && (
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
              {input}
            </pre>
          )}
          {output && (
            <pre className="text-[10px] text-foreground/70 whitespace-pre-wrap break-all max-h-32 overflow-y-auto border-t border-border/30 pt-1">
              {output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
