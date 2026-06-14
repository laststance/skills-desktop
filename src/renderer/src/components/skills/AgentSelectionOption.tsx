import React, { useCallback } from 'react'

import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import { cn } from '@/renderer/src/lib/utils'
import type { AgentId } from '@/shared/types'

type CheckboxCheckedState = boolean | 'indeterminate'

interface AgentSelectionOptionProps {
  agentId: AgentId
  checkboxId: string
  name: string
  checked: boolean
  disabled: boolean
  secondaryLabel?: string
  hoverClassName: string
  onToggle: (agentId: AgentId) => void
}

/**
 * Shared selectable agent row for Add/Copy destination dialogs.
 *
 * Both flows need the same click handling: row click toggles, checkbox click
 * does not bubble back into the row, and disabled rows remain visibly inert.
 * Keeping that behavior in one component prevents the dialogs from drifting.
 *
 * @param props - Agent row state and toggle callback
 * @returns A checkbox row suitable for modal destination selection
 * @example
 * <AgentSelectionOption agentId="codex" checkboxId="copy-codex" name="Codex" checked={false} disabled={false} hoverClassName="hover:bg-muted" onToggle={toggle} />
 */
export const AgentSelectionOption = React.memo(function AgentSelectionOption({
  agentId,
  checkboxId,
  name,
  checked,
  disabled,
  secondaryLabel,
  hoverClassName,
  onToggle,
}: AgentSelectionOptionProps): React.ReactElement {
  const handleToggle = useCallback(
    (_checked?: CheckboxCheckedState): void => {
      if (!disabled) onToggle(agentId)
    },
    [agentId, disabled, onToggle],
  )

  // Native row clicks use a plain wrapper; passing handleToggle directly would
  // trip no-deopt-use-callback on the intrinsic <div>.
  const handleRowClick = (): void => {
    handleToggle()
  }

  const handleCheckboxClick = useCallback((event: React.MouseEvent): void => {
    event.stopPropagation()
  }, [])

  return (
    // react-doctor-disable-next-line react-doctor/click-events-have-key-events, react-doctor/no-static-element-interactions -- the row onClick is a mouse-only convenience that delegates to the keyboard-accessible <Checkbox> inside (it owns onCheckedChange); the real control is focusable and operable, so no separate row keyboard handler/role is needed.
    <div
      className={cn(
        'flex items-center gap-3 p-2 rounded-md',
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : cn(hoverClassName, 'cursor-pointer'),
      )}
      onClick={handleRowClick}
    >
      <Checkbox
        id={checkboxId}
        aria-label={name}
        checked={checked}
        onClick={handleCheckboxClick}
        onCheckedChange={handleToggle}
        disabled={disabled}
      />
      <div
        className={cn(
          'text-sm',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        {name}
        {secondaryLabel !== undefined && (
          <span className="text-xs text-muted-foreground ml-2">
            {secondaryLabel}
          </span>
        )}
      </div>
    </div>
  )
})
