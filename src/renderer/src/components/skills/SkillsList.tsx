import React, { useEffect } from 'react'

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

/**
 * List of all skills with search and agent filtering
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
    <div className="flex flex-col gap-3">
      {filteredSkills.map((skill) => (
        <SkillItem key={skill.path} skill={skill} />
      ))}
    </div>
  )
})
