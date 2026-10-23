import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { SkillTreeBoundary } from './SkillTreeBoundary'

let crashing = true
function Child() {
  if (crashing) throw new Error('/private/skill/path with secret contents')
  return <p>Healthy tree</p>
}
afterEach(() => {
  vi.restoreAllMocks()
  crashing = true
})

test('contains Tree crashes, preserves sibling panels, and retries without exposing the exception', async () => {
  // Arrange
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const useList = vi.fn()
  const screen = await render(
    <>
      <p>Inspector remains available</p>
      <SkillTreeBoundary useList={useList}>
        <Child />
      </SkillTreeBoundary>
    </>,
  )
  // Assert
  await expect.element(screen.getByRole('alert')).toBeVisible()
  await expect
    .element(screen.getByText('Inspector remains available'))
    .toBeVisible()
  expect(warning).toHaveBeenCalledWith('[TREE_RENDER] SkillsTree')
  expect(
    screen.getByText('/private/skill/path with secret contents').query(),
  ).toBeNull()
  // Act
  crashing = false
  await screen.getByRole('button', { name: 'Try again' }).click()
  // Assert
  await expect.element(screen.getByText('Healthy tree')).toBeVisible()
  expect(useList).not.toHaveBeenCalled()
})

test('offers an explicit List fallback after a Tree crash', async () => {
  // Arrange
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const useList = vi.fn()
  const screen = await render(
    <SkillTreeBoundary useList={useList}>
      <Child />
    </SkillTreeBoundary>,
  )
  // Act
  await screen.getByRole('button', { name: 'Use List' }).click()
  // Assert
  expect(useList).toHaveBeenCalledTimes(1)
})
