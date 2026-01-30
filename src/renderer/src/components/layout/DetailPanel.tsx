import { useAppSelector } from '../../redux/hooks'
import { SkillDetail } from '../skills/SkillDetail'

/**
 * Right detail panel (320px width)
 * Shows selected skill details with file preview
 */
export function DetailPanel(): React.ReactElement {
  const { selectedSkill } = useAppSelector((state) => state.skills)

  if (!selectedSkill) {
    return (
      <aside className="h-full border-l border-border bg-card flex flex-col">
        {/* Draggable title bar area */}
        <div className="h-8 drag-region shrink-0" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground text-sm">
            Select a skill to view details
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="h-full border-l border-border bg-card flex flex-col overflow-hidden">
      {/* Draggable title bar area */}
      <div className="h-8 drag-region shrink-0" />
      <SkillDetail skill={selectedSkill} />
    </aside>
  )
}
