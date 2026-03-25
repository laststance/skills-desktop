import React, { useEffect } from 'react'
import { List, type RowComponentProps } from 'react-window'

import type { Skill } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectFilteredSkills } from '../../redux/selectors'
import {
  fetchSkills,
  selectSkillsError,
  selectSkillsItems,
  selectSkillsLoading,
} from '../../redux/slices/skillsSlice'
import { selectSelectedAgentId } from '../../redux/slices/uiSlice'

import { SkillItem } from './SkillItem'

/** Estimated height of a skill card including gap (px) */
const ROW_HEIGHT = 120

/** Props passed to SkillRow via rowProps */
interface SkillRowProps {
  data: Skill[]
}

/**
 * Virtual row component for react-window v2.
 * Receives `index` and `style` from List, plus `data` via rowProps.
 * @param props - RowComponentProps with skill data array
 * @returns Rendered skill item wrapped in positioned div
 * @example
 * <List rowComponent={SkillRow} rowProps={{ data: skills }} ... />
 */
// eslint-disable-next-line @laststance/react-next/all-memo -- react-window virtualizes rows; React.memo return type is incompatible with rowComponent prop
function SkillRow({
  index,
  style,
  data,
}: RowComponentProps<SkillRowProps>): React.ReactElement {
  return (
    <div style={{ ...style, paddingBottom: 12 }}>
      <SkillItem skill={data[index]} />
    </div>
  )
}

/**
 * List of all skills with search, agent filtering, and virtual scrolling.
 * Uses react-window v2 for O(visible) DOM nodes instead of O(n).
 */
export const SkillsList = React.memo(function SkillsList(): React.ReactElement {
  const dispatch = useAppDispatch()
  const skills = useAppSelector(selectSkillsItems)
  const loading = useAppSelector(selectSkillsLoading)
  const error = useAppSelector(selectSkillsError)
  const selectedAgentId = useAppSelector(selectSelectedAgentId)
  const filteredSkills = useAppSelector(selectFilteredSkills)

  useEffect(() => {
    dispatch(fetchSkills())
  }, [dispatch])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading skills...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-destructive">{error}</div>
      </div>
    )
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium mb-2">No skills installed</p>
        <p className="text-sm text-muted-foreground mb-4">
          Install your first skill to get started
        </p>
        <code className="px-3 py-2 bg-muted rounded-md text-sm font-mono">
          npx skills add &lt;skill-name&gt;
        </code>
      </div>
    )
  }

  if (filteredSkills.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">
          {selectedAgentId
            ? 'No skills installed for this agent'
            : 'No skills match your search'}
        </div>
      </div>
    )
  }

  return (
    <List<SkillRowProps>
      rowComponent={SkillRow}
      rowCount={filteredSkills.length}
      rowHeight={ROW_HEIGHT}
      rowProps={{ data: filteredSkills }}
      overscanCount={5}
      style={{ width: '100%', height: '100%' }}
    />
  )
})
