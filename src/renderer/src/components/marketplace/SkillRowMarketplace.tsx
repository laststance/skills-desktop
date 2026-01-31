import { Download, ExternalLink } from 'lucide-react'

import type { SkillSearchResult } from '../../../../shared/types'
import { useAppDispatch, useAppSelector } from '../../redux/hooks'
import { selectSkillForInstall } from '../../redux/slices/marketplaceSlice'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'

interface SkillRowMarketplaceProps {
  skill: SkillSearchResult
  isInstalled?: boolean
}

/**
 * Single skill row in marketplace search results
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

  const handleOpenUrl = (): void => {
    window.electron.shell.openExternal(skill.url)
  }

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">
                #{skill.rank}
              </span>
              <h3 className="font-medium truncate">{skill.name}</h3>
              {isInstalled && (
                <Badge variant="secondary" className="text-xs">
                  Installed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {skill.repo}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenUrl}
              title="View on skills.sh"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            {isInstalled ? (
              <Badge variant="outline" className="h-9 px-4">
                Installed
              </Badge>
            ) : (
              <Button size="sm" onClick={handleInstall} disabled={isOperating}>
                <Download className="h-4 w-4 mr-1" />
                Install
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
