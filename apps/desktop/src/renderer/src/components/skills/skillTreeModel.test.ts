import { expect, test } from 'vitest'

import {
  unavailableSkillFiles,
  type SkillFilesListing,
} from '@/shared/skillFiles'
import {
  toAbsolutePath,
  toSkillName,
  toSymlinkCount,
  type Skill,
} from '@/shared/types'

import { buildSkillTree } from './skillTreeModel'

const skill: Skill = {
  name: toSkillName('fixture'),
  path: toAbsolutePath('/skills/fixture'),
  description: '',
  symlinks: [],
  symlinkCount: toSymlinkCount(0),
  isSource: true,
  isOrphan: false,
}
const ids = new Map([[skill.path, 'r0/']])

test.each([
  ['missing', 'Skill folder is missing · Rescan'],
  ['denied', 'Folder access denied'],
  ['limit', 'Showing a limited set of files'],
  ['busy', 'Collapse another skill, then Retry'],
  ['timeout', 'Files unavailable · Retry'],
] as const)('shows a specific recovery notice for %s', (code, label) => {
  // Arrange / Act
  const input = buildSkillTree(
    [skill],
    ids,
    new Map([[skill.path, { result: unavailableSkillFiles(code) }]]),
  )
  // Assert
  expect(input.nodes.get('r0/$notice')?.label).toBe(label)
})

test('represents successful empty discovery without an error notice', () => {
  // Arrange
  const result: SkillFilesListing = {
    status: 'complete',
    files: [],
    issues: [],
    observedEntries: 0,
  }
  // Act
  const input = buildSkillTree(
    [skill],
    ids,
    new Map([[skill.path, { result }]]),
  )
  // Assert
  expect(input.nodes.get('r0/$notice')?.label).toBe('No previewable files')
})

test('places depth and unreadable markers under their actual directories and ignores the root marker path', () => {
  // Arrange
  const result: SkillFilesListing = {
    status: 'partial',
    files: [],
    observedEntries: 3,
    issues: [
      { relativePath: '', code: 'limit' },
      { relativePath: 'deep/folder', code: 'depth' },
      { relativePath: 'private', code: 'denied' },
    ],
  }
  // Act
  const input = buildSkillTree(
    [skill],
    ids,
    new Map([[skill.path, { result }]]),
  )
  // Assert
  expect(input.nodes.get('r0/deep/folder/$notice')?.label).toBe(
    'Preview depth limit reached',
  )
  expect(input.nodes.get('r0/private/$notice')?.label).toBe(
    'Folder could not be listed',
  )
  expect(input.paths).toEqual([
    'r0/',
    'r0/$notice',
    'r0/deep/folder/$notice',
    'r0/private/$notice',
  ])
})
