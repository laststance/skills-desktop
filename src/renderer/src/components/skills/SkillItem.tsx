import type { Skill } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectSkill } from '../../redux/slices/skillsSlice'
import { StatusBadge } from '../status/StatusBadge'
import { Card, CardContent } from '../ui/card'

interface SkillItemProps {
  skill: Skill
}

/**
 * Single skill card in the skills list
 */
export function SkillItem({ skill }: SkillItemProps): React.ReactElement {
  const dispatch = useAppDispatch()
  const { selectedSkill } = useAppSelector((state) => state.skills)
  const isSelected = selectedSkill?.path === skill.path

  const validCount = skill.symlinks.filter((s) => s.status === 'valid').length
  const brokenCount = skill.symlinks.filter((s) => s.status === 'broken').length

  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50',
        isSelected && 'border-primary bg-primary/5',
      )}
      onClick={() => dispatch(selectSkill(skill))}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate">{skill.name}</h3>
            {skill.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                {skill.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          {validCount > 0 && <StatusBadge status="valid" count={validCount} />}
          {brokenCount > 0 && (
            <StatusBadge status="broken" count={brokenCount} />
          )}
          {validCount === 0 && brokenCount === 0 && (
            <span className="text-xs text-muted-foreground">
              Not linked to any agent
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
