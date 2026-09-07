import { useTransition, type ReactElement } from 'react'
import { toast } from 'sonner'

import { Button } from '@/renderer/src/components/ui/button'
import { retryBackgroundDisplay } from '@/renderer/src/hooks/useBackgroundSnapshot'

/** Sends an explicit display-only retry from Appearance or the main fallback, without applying a new selection.
 * @returns A disabled-while-pending retry action with visible IPC failure recovery.
 * @example <BackgroundImageRetry />
 */
export function BackgroundImageRetry(): ReactElement {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      variant="link"
      size="xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await retryBackgroundDisplay()
          } catch {
            toast.error('Background could not be reloaded', {
              description: 'The selected image was kept. Try again.',
            })
          }
        })
      }
    >
      {pending ? 'Retrying…' : 'Retry image'}
    </Button>
  )
}
