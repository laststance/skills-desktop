import { expect, test } from 'vitest'

import {
  toAbsolutePath,
  toSkillName,
  toSymlinkCount,
  type Skill,
} from '@/shared/types'

import skillsReducer, {
  fetchSkills,
  inspectSkillFile,
  selectPreviewFile,
  selectSkill,
  setInspectorTabOverride,
} from './skillsSlice'

const skill: Skill = {
  name: toSkillName('fixture'),
  path: toAbsolutePath('/skills/fixture'),
  description: '',
  symlinks: [],
  symlinkCount: toSymlinkCount(0),
  isSource: true,
  isOrphan: false,
}
const path = toAbsolutePath('/skills/fixture/guide.md')

test('file activation atomically opens Files while same-root inspection preserves the file intent', () => {
  // Arrange
  let state = skillsReducer(undefined, { type: 'init' })
  // Act
  state = skillsReducer(state, inspectSkillFile({ skill, path }))
  state = skillsReducer(state, selectSkill(skill))
  // Assert
  expect(state.selectedSkill?.name).toBe('fixture')
  expect(state.inspectedFile).toEqual({
    root: '/skills/fixture',
    path: '/skills/fixture/guide.md',
    sequence: 1,
  })
  expect(state.inspectorTabOverride).toBe('files')
})

test('an Inspector tab click can clear the temporary override and root changes reset file navigation', () => {
  // Arrange
  let state = skillsReducer(undefined, inspectSkillFile({ skill, path }))
  // Act
  state = skillsReducer(state, setInspectorTabOverride(null))
  state = skillsReducer(state, selectPreviewFile({ root: skill.path, path }))
  state = skillsReducer(
    state,
    selectSkill({ ...skill, path: toAbsolutePath('/skills/other') }),
  )
  // Assert
  expect(state.inspectedFile).toBeNull()
  expect(state.inspectorTabOverride).toBeNull()
})

test('Rescan clears inspection when the selected root has been removed', () => {
  // Arrange
  let state = skillsReducer(undefined, inspectSkillFile({ skill, path }))
  // Act
  state = skillsReducer(state, fetchSkills.pending('refresh', undefined))
  state = skillsReducer(state, fetchSkills.fulfilled([], 'refresh', undefined))
  // Assert
  expect(state.filesGeneration).toBe(1)
  expect(state.selectedSkill).toBeNull()
  expect(state.inspectedFile).toBeNull()
  expect(state.inspectorTabOverride).toBeNull()
})

test('Rescan refreshes selected metadata while preserving an existing file intent', () => {
  // Arrange
  let state = skillsReducer(undefined, inspectSkillFile({ skill, path }))
  // Act
  state = skillsReducer(
    state,
    fetchSkills.fulfilled(
      [{ ...skill, description: 'Updated' }],
      'refresh',
      undefined,
    ),
  )
  // Assert
  expect(state.selectedSkill?.description).toBe('Updated')
  expect(state.inspectedFile?.path).toBe('/skills/fixture/guide.md')
})
