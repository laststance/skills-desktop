import {
  mkdir,
  mkdtemp,
  readlink,
  realpath as realpathFs,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { AbsolutePath } from '@/shared/types'

import {
  checkSymlinkStatus,
  checkSymlinkTargetFromKnownLink,
  readSymlinkTargetIfPresent,
  resolveRawSymlinkTarget,
} from './symlinkChecker'

describe('symlinkChecker real filesystem behavior', () => {
  it('keeps a valid relative symlink valid when the parent directory is symlinked', async () => {
    // Arrange
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'skills-desktop-symlink-parent-'),
    )

    try {
      const homeDir = join(temporaryRoot, 'home')
      const physicalConfigDir = join(homeDir, 'dotfiles', '.config')
      const logicalConfigDir = join(homeDir, '.config')
      const physicalAgentSkillsDir = join(physicalConfigDir, 'devin', 'skills')
      const sourceSkillDir = join(homeDir, '.agents', 'skills', 'qa-skill')
      const relativeTarget = '../../../../.agents/skills/qa-skill'
      const linkPath = join(
        logicalConfigDir,
        'devin',
        'skills',
        'qa-skill',
      ) as AbsolutePath

      await mkdir(physicalAgentSkillsDir, { recursive: true })
      await mkdir(sourceSkillDir, { recursive: true })
      await writeFile(join(sourceSkillDir, 'SKILL.md'), 'name: qa-skill\n')
      await symlink(physicalConfigDir, logicalConfigDir)
      await symlink(relativeTarget, linkPath)
      const physicalSourceSkillDir = await realpathFs(sourceSkillDir)

      // Act
      const slowStatus = await checkSymlinkStatus(linkPath)
      const fastStatus = await checkSymlinkTargetFromKnownLink(linkPath)
      const displayedTarget = await readSymlinkTargetIfPresent(linkPath)

      // Assert
      expect(await readlink(linkPath)).toBe(relativeTarget)
      expect(slowStatus).toBe('valid')
      expect(fastStatus).toBe('valid')
      expect(displayedTarget).toBe(physicalSourceSkillDir)
      expect(displayedTarget).not.toBe(
        join(temporaryRoot, '.agents', 'skills', 'qa-skill'),
      )
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('resolves absolute symlink targets without requiring the link parent to exist', async () => {
    // Arrange
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), 'skills-desktop-absolute-target-'),
    )

    try {
      const removedParent = join(temporaryRoot, 'missing-agent', 'skills')
      const linkPath = join(removedParent, 'qa-skill')
      const target = join(temporaryRoot, '.agents', 'skills', 'qa-skill')

      // Act
      const resolvedTarget = await resolveRawSymlinkTarget(linkPath, target)

      // Assert
      expect(resolvedTarget).toBe(target)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })
})
