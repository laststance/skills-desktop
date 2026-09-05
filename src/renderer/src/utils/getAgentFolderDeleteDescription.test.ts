import { describe, expect, it } from 'vitest'

import { getAgentFolderDeleteDescription } from './getAgentFolderDeleteDescription'

describe('agent folder deletion review description', () => {
  it.each([
    {
      group: 'unused',
      folderCount: 1,
      expected:
        'Move 1 empty agent folder to Trash. Folders containing files, settings, history, or skills will be kept.',
    },
    {
      group: 'unused',
      folderCount: 2,
      expected:
        'Move 2 empty agent folders to Trash. Folders containing files, settings, history, or skills will be kept.',
    },
    {
      group: 'hidden',
      folderCount: 1,
      expected:
        'Move 1 skills folder to Trash, including all contents. Folders containing protected skills will remain.',
    },
    {
      group: 'hidden',
      folderCount: 2,
      expected:
        'Move 2 skills folders to Trash, including all contents. Folders containing protected skills will remain.',
    },
  ] as const)(
    'explains what is kept when reviewing $folderCount $group folders',
    ({ group, folderCount, expected }) => {
      // Act
      const description = getAgentFolderDeleteDescription(group, folderCount)

      // Assert
      expect(description).toBe(expected)
    },
  )
})
