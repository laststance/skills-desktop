import { Folder, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'

import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { fetchAgents } from '../../redux/slices/agentsSlice'
import { fetchSkills } from '../../redux/slices/skillsSlice'
import { fetchSourceStats } from '../../redux/slices/uiSlice'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

/**
 * Source directory card showing stats and refresh button
 */
export function SourceCard(): React.ReactElement {
  const dispatch = useAppDispatch()
  const { sourceStats, isRefreshing } = useAppSelector((state) => state.ui)

  useEffect(() => {
    dispatch(fetchSourceStats())
  }, [dispatch])

  const handleRefresh = (): void => {
    Promise.all([
      dispatch(fetchSourceStats()),
      dispatch(fetchSkills()),
      dispatch(fetchAgents()),
    ])
  }

  return (
    <Card className="bg-card/50">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Folder className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Source
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
        </div>
        <p className="text-sm font-medium truncate">~/.agents/skills</p>
        {sourceStats && (
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span>{sourceStats.skillCount} skills</span>
            <span>{sourceStats.totalSize}</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
