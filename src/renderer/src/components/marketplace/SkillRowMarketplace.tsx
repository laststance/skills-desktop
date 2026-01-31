import { Check, Download, Plus, Trash2 } from 'lucide-react'

import type { SkillSearchResult } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import {
  selectSkillForInstall,
  setSkillToRemove,
} from '../../redux/slices/marketplaceSlice'

interface SkillRowMarketplaceProps {
  skill: SkillSearchResult
  isInstalled?: boolean
}

/**
 * Format install count for display (e.g., 72900 -> "72.9K")
 * @param count - Raw install count number
 * @returns Formatted string with K/M suffix
 */
function formatInstallCount(count: number | undefined): string {
  if (!count) return '—'
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`
  }
  return count.toString()
}

/**
 * Single skill row in marketplace search results
 * Design: 72px height, rank badge, install count, install/remove buttons
 */
export function SkillRowMarketplace({
  skill,
  isInstalled = false,
}: SkillRowMarketplaceProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { status } = useAppSelector((state) => state.marketplace)
  const isOperating = status === 'installing' || status === 'removing'

  const handleInstall = (): void => {
    dispatch(selectSkillForInstall(skill))
  }

  const handleRemove = (): void => {
    dispatch(setSkillToRemove(skill.name))
  }

  return (
    <div
      className={cn(
        'flex items-center gap-4 p-4 rounded-lg bg-[#1E293B] h-[72px]',
        'border transition-colors',
        isInstalled
          ? 'border-[#22D3EE]'
          : 'border-[#1E293B] hover:border-primary/50',
      )}
    >
      {/* Rank Badge */}
      <div
        className={cn(
          'flex items-center justify-center w-8 h-8 rounded-md bg-[#334155]',
          'font-mono text-sm font-semibold',
          isInstalled ? 'text-[#94A3B8]' : 'text-[#22D3EE]',
        )}
      >
        {skill.rank}
      </div>

      {/* Skill Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="font-semibold text-[15px] text-white truncate">
          {skill.name}
        </span>
        <span className="font-mono text-xs text-[#64748B] truncate">
          {skill.repo}
        </span>
      </div>

      {/* Install Count */}
      <div className="flex items-center gap-1.5 text-[#94A3B8]">
        <Download className="h-3.5 w-3.5 text-[#64748B]" />
        <span className="font-mono text-[13px] font-medium">
          {formatInstallCount(skill.installCount)}
        </span>
      </div>

      {/* Action Buttons */}
      {isInstalled ? (
        <div className="flex items-center gap-3">
          {/* Installed Badge */}
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#22D3EE]/10">
            <Check className="h-3 w-3 text-[#22D3EE]" />
            <span className="text-[11px] font-medium text-[#22D3EE]">
              Installed
            </span>
          </div>

          {/* Remove Button */}
          <button
            onClick={handleRemove}
            disabled={isOperating}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-md',
              'bg-[#334155] border border-[#EF4444]',
              'text-[#EF4444] text-[13px] font-semibold',
              'hover:bg-[#3E4A5E] transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : (
        /* Install Button */
        <button
          onClick={handleInstall}
          disabled={isOperating}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-md',
            'bg-[#22D3EE] text-[#0A0F1C] text-[13px] font-semibold',
            'hover:bg-[#06B6D4] transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Install
        </button>
      )}
    </div>
  )
}
