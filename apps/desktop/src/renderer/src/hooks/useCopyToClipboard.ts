import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { useUnmountEffect } from '@/renderer/src/hooks/useUnmountEffect'
import { COPIED_FEEDBACK_DURATION_MS } from '@/shared/constants'

interface CopyToClipboardState {
  /** True for COPIED_FEEDBACK_DURATION_MS after a successful copy, otherwise false. */
  copied: boolean
  /**
   * Write `value` to the clipboard, flash `copied`, and toast on failure.
   * @param value - The text to place on the clipboard.
   * @param failureLabel - What to name in the error toast (e.g. "preview URL").
   */
  copy: (value: string, failureLabel: string) => Promise<void>
}

/**
 * Single-value clipboard copy with a self-resetting "Copied" flash and an error
 * toast — exists so any copy affordance (skill path, marketplace preview URL)
 * shares one feedback contract instead of re-implementing the timeout dance;
 * fires on a copy button click.
 * @returns `copied` flag for button state and an async `copy(value, label)` action.
 * @example
 * const { copied, copy } = useCopyToClipboard()
 * <button onClick={() => copy(url, 'preview URL')}>{copied ? 'Copied' : 'Copy'}</button>
 */
export function useCopyToClipboard(): CopyToClipboardState {
  const [copied, setCopied] = useState(false)
  const resetCopiedTimeoutRef = useRef<number | null>(null)

  // Clear a pending reset timer if the component unmounts mid-flash.
  useUnmountEffect(() => {
    if (resetCopiedTimeoutRef.current !== null) {
      window.clearTimeout(resetCopiedTimeoutRef.current)
    }
  })

  const copy = async (value: string, failureLabel: string): Promise<void> => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable')
      }
      await navigator.clipboard.writeText(value)
      setCopied(true)

      // Reset the flash after a short confirmation window, replacing any
      // in-flight timer so rapid re-copies extend rather than stack.
      if (resetCopiedTimeoutRef.current !== null) {
        window.clearTimeout(resetCopiedTimeoutRef.current)
      }
      resetCopiedTimeoutRef.current = window.setTimeout(() => {
        setCopied(false)
        resetCopiedTimeoutRef.current = null
      }, COPIED_FEEDBACK_DURATION_MS)
    } catch {
      toast.error(`Failed to copy ${failureLabel}`)
    }
  }

  return { copied, copy }
}
