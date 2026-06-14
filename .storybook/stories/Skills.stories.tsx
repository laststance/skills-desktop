import React from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import type { PreviewContent } from '@/renderer/src/hooks/useCodePreview'
import { AddSymlinkModal } from '@/renderer/src/components/skills/AddSymlinkModal'
import { CodePreview } from '@/renderer/src/components/skills/CodePreview'
import { CopyToAgentsModal } from '@/renderer/src/components/skills/CopyToAgentsModal'
import { FileContent } from '@/renderer/src/components/skills/FileContent'
import { FileTabs } from '@/renderer/src/components/skills/FileTabs'
import { SearchBox } from '@/renderer/src/components/skills/SearchBox'
import { SelectionToolbar } from '@/renderer/src/components/skills/SelectionToolbar'
import { SkillDetail } from '@/renderer/src/components/skills/SkillDetail'
import { SkillItem } from '@/renderer/src/components/skills/SkillItem'
import { SkillsList } from '@/renderer/src/components/skills/SkillsList'
import { SourceLink } from '@/renderer/src/components/skills/SourceLink'
import { UndoToast } from '@/renderer/src/components/skills/UndoToast'
import { UnlinkDialog } from '@/renderer/src/components/skills/UnlinkDialog'

import {
  storySkillFileContent,
  storySkillFiles,
  storySkills,
  storyTombstoneIds,
} from '../fixtures'
import { StoryCard, StoryGrid } from '../storybook-utils'

const meta = {
  title: 'Skills/Components',
  parameters: {
    skillsDesktop: {
      width: 1180,
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const textPreview: PreviewContent = {
  kind: 'text',
  data: storySkillFileContent,
}

const binaryPreview: PreviewContent = {
  kind: 'binary',
  fileName: 'archive.zip',
  size: 420_000,
}

export const SkillRowsAndSearch: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="SearchBox">
        <SearchBox />
      </StoryCard>
      <StoryCard label="SelectionToolbar">
        <SelectionToolbar
          agentDisplayName="Claude Code"
          onPrimaryAction={() => undefined}
        />
      </StoryCard>
      {storySkills.map((skill) => (
        <StoryCard key={skill.name} label={`SkillItem / ${skill.name}`}>
          <SkillItem skill={skill} />
        </StoryCard>
      ))}
    </StoryGrid>
  ),
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          selectedAgentId: 'claude-code',
          bulkSelectMode: true,
        },
        skills: {
          selectedSkill: storySkills[0],
          selectedSkillNames: [storySkills[0]!.name, storySkills[1]!.name],
        },
      },
    },
  },
}

export const FullSkillsList: Story = {
  render: () => (
    <StoryCard label="SkillsList" className="h-[520px] overflow-hidden">
      <SkillsList />
    </StoryCard>
  ),
}

export const DetailAndCodePreview: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard
        label="SkillDetail / Files"
        className="h-[560px] overflow-hidden"
      >
        <SkillDetail skill={storySkills[0]!} />
      </StoryCard>
      <StoryCard label="CodePreview" className="h-[560px] overflow-hidden">
        <CodePreview skillPath={storySkills[0]!.path} />
      </StoryCard>
      <StoryCard label="FileTabs">
        <FileTabs
          files={storySkillFiles}
          activeFilePath={storySkillFiles[0]!.path}
        />
      </StoryCard>
      <StoryCard label="SourceLink">
        <SourceLink
          source={storySkills[0]!.source}
          sourceUrl={storySkills[0]!.sourceUrl}
        />
      </StoryCard>
    </StoryGrid>
  ),
}

export const FilePreviewStates: Story = {
  render: () => (
    <StoryGrid columns={2}>
      <StoryCard label="FileContent / text" className="h-80 overflow-hidden">
        <FileContent content={textPreview} />
      </StoryCard>
      <StoryCard label="FileContent / binary" className="h-80 overflow-hidden">
        <FileContent content={binaryPreview} />
      </StoryCard>
      <StoryCard label="FileContent / empty" className="h-80 overflow-hidden">
        <FileContent content={{ kind: 'empty' }} />
      </StoryCard>
      <StoryCard label="UndoToast">
        <UndoToast
          skillNames={[storySkills[0]!.name, storySkills[1]!.name]}
          tombstoneIds={storyTombstoneIds}
          // react-doctor-disable-next-line react-doctor/rendering-hydration-mismatch-time -- Storybook story renders client-only with no SSR hydration boundary; Date.now() here is intentional fixture data (15s expiry) and cannot mismatch.
          expiresAt={new Date(Date.now() + 15_000).toISOString()}
          summary="Deleted 2 skills. 5 symlinks removed."
          onUndo={() => undefined}
          toastId="storybook-undo-toast"
        />
      </StoryCard>
    </StoryGrid>
  ),
}

export const UnlinkDialogOpen: Story = {
  render: () => <UnlinkDialog />,
  parameters: {
    skillsDesktop: {
      state: {
        skills: {
          skillToUnlink: {
            skill: storySkills[1],
            symlink: storySkills[1]!.symlinks[1]!,
          },
        },
      },
    },
  },
}

export const AddSymlinkDialogOpen: Story = {
  render: () => <AddSymlinkModal />,
  parameters: {
    skillsDesktop: {
      state: {
        skills: {
          skillToAddSymlinks: storySkills[1],
          selectedAddAgentIds: ['codex'],
        },
      },
    },
  },
}

export const CopyToAgentsDialogOpen: Story = {
  render: () => <CopyToAgentsModal />,
  parameters: {
    skillsDesktop: {
      state: {
        ui: {
          selectedAgentId: 'codex',
        },
        skills: {
          skillToCopy: storySkills[2],
        },
      },
    },
  },
}
