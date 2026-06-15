import { AlertTriangle, Eraser, Settings } from 'lucide-react'
import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { DestructiveConfirmDialog } from '@/renderer/src/components/shared/DestructiveConfirmDialog'
import { StatusBadge } from '@/renderer/src/components/status/StatusBadge'
import { SymlinkStatus } from '@/renderer/src/components/status/SymlinkStatus'
import { ThemeSelector } from '@/renderer/src/components/theme/ThemeSelector'
import { Badge } from '@/renderer/src/components/ui/badge'
import { Button } from '@/renderer/src/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/renderer/src/components/ui/card'
import { Checkbox } from '@/renderer/src/components/ui/checkbox'
import { DialogIconHeader } from '@/renderer/src/components/shared/dialog-icon-header'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/src/components/ui/dropdown-menu'
import { FilterPill } from '@/renderer/src/components/shared/FilterPill'
import { Input } from '@/renderer/src/components/ui/input'
import { ScrollArea } from '@/renderer/src/components/ui/scroll-area'
import { Separator } from '@/renderer/src/components/ui/separator'
import { StatRow } from '@/renderer/src/components/shared/stat-row'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/renderer/src/components/ui/tabs'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/renderer/src/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/renderer/src/components/ui/tooltip'

import { storySkills } from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Primitives/Components',
  parameters: {
    skillsDesktop: {
      width: 1120,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const ButtonsBadgesAndInputs: Story = {
  render: () => (
    <StoryGrid columns={3}>
      <StoryCard label="Button">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="destructive">Delete</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
        </div>
      </StoryCard>
      <StoryCard label="Badge">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="valid">Valid</Badge>
          <Badge variant="broken">Broken</Badge>
          <Badge variant="missing">Missing</Badge>
          <Badge variant="destructive">Error</Badge>
        </div>
      </StoryCard>
      <StoryCard label="Input + Checkbox">
        <div className="flex flex-col gap-3">
          <Input
            defaultValue="design-review"
            aria-label="Skill name"
            name="skill-name"
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              defaultChecked
              aria-label="Link to every installed agent"
              name="link-everywhere"
            />
            Link to every installed agent
          </label>
        </div>
      </StoryCard>
    </StoryGrid>
  ),
}

export const CardsTabsAndRows: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="Card">
        <Card>
          <CardHeader>
            <CardTitle>Skill health</CardTitle>
            <CardDescription>At-a-glance symlink state.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <StatRow label="Valid links" value={12} tone="primary" />
            <StatRow label="Broken links" value={2} tone="amber" />
          </CardContent>
          <CardFooter>
            <Button size="sm">Open report</Button>
          </CardFooter>
        </Card>
      </StoryCard>
      <StoryCard label="Tabs">
        <Tabs defaultValue="files">
          <TabsList>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>
          <TabsContent
            value="files"
            className="rounded-md bg-muted/40 p-4 text-sm"
          >
            SKILL.md and references are previewed here.
          </TabsContent>
          <TabsContent
            value="info"
            className="rounded-md bg-muted/40 p-4 text-sm"
          >
            Symlink and source metadata live here.
          </TabsContent>
        </Tabs>
      </StoryCard>
    </StoryGrid>
  ),
}

export const MenusTooltipsAndSelectors: Story = {
  render: () => (
    <StoryGrid columns={3}>
      <StoryCard label="DropdownMenu">
        <DropdownMenu open>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Open menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Reveal in Finder</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>
              Show in sidebar
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value="terminal">
              <DropdownMenuRadioItem value="terminal">
                Terminal
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="iterm">
                iTerm2
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </StoryCard>
      <StoryCard label="Tooltip">
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="secondary">Hover target</Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Agent skill directory</TooltipContent>
        </Tooltip>
      </StoryCard>
      <StoryCard label="ThemeSelector">
        <ThemeSelector />
      </StoryCard>
    </StoryGrid>
  ),
}

export const FeedbackAndStatus: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="FilterPill">
        <FilterPill
          label={
            <>
              from <strong className="text-primary">laststance/gstack</strong>
            </>
          }
          onClear={() => undefined}
        />
      </StoryCard>
      <StoryCard label="StatusBadge">
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            status="valid"
            count={3}
            agentNames={['Claude Code', 'Cursor', 'Codex']}
          />
          <StatusBadge status="broken" count={1} agentNames={['Cursor']} />
          <StatusBadge status="missing" />
        </div>
      </StoryCard>
      <StoryCard label="SymlinkStatus">
        <div className="space-y-2">
          {storySkills[1]?.symlinks.map((symlink) => (
            <SymlinkStatus key={symlink.agentId} symlink={symlink} />
          ))}
        </div>
      </StoryCard>
      <StoryCard label="DialogIconHeader + Separator">
        <div className="space-y-4">
          <DialogIconHeader icon={Eraser} title="Cleanup missing skills" />
          <Separator />
          <DialogIconHeader
            icon={AlertTriangle}
            title="Sync Conflicts"
            tone="amber"
          />
        </div>
      </StoryCard>
    </StoryGrid>
  ),
}

export const ScrollAndToggleControls: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="ScrollArea">
        <ScrollArea className="h-48 rounded-md border border-border">
          <div className="space-y-2 p-3">
            {Array.from({ length: 12 }, (_, index) => (
              <div key={index} className="rounded-md bg-muted/50 p-2 text-sm">
                Row {index + 1}
              </div>
            ))}
          </div>
        </ScrollArea>
      </StoryCard>
      <StoryCard label="ToggleGroup">
        <ToggleGroup type="single" defaultValue="comfortable" variant="outline">
          <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
          <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          <ToggleGroupItem value="dense">Dense</ToggleGroupItem>
        </ToggleGroup>
      </StoryCard>
    </StoryGrid>
  ),
}

export const DestructiveDialog: Story = {
  render: () => (
    <DestructiveConfirmDialog
      open
      onClose={() => undefined}
      onConfirm={() => undefined}
      loading={false}
      title="Delete Skills Folder"
      description={
        <>
          Permanently delete the skills folder for <strong>Cursor</strong>?
        </>
      }
      confirmLabel="Delete"
    />
  ),
}
