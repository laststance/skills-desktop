import { configureStore } from '@reduxjs/toolkit'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { renderHook } from 'vitest-browser-react'

import skills, {
  fetchSkills,
  inspectSkillFile,
  selectSkill,
} from '@/renderer/src/redux/slices/skillsSlice'
import type { SkillFileRead, SkillFilesListing } from '@/shared/skillFiles'
import {
  toAbsolutePath,
  toFileExtension,
  toFileName,
  toFileSizeBytes,
  toLineCount,
  toPosixRelativePath,
  toSkillName,
  toSymlinkCount,
  type Skill,
  type SkillFile,
} from '@/shared/types'

import { SkillFilesProvider } from './SkillFilesProvider'
import { useCodePreview } from './useCodePreview'

const root = toAbsolutePath('/skills/alpha')
const skill: Skill = {
  name: toSkillName('alpha'),
  path: root,
  description: '',
  symlinks: [],
  symlinkCount: toSymlinkCount(0),
  isSource: true,
  isOrphan: false,
}
const first: SkillFile = {
  name: toFileName('SKILL.md'),
  path: toAbsolutePath('/skills/alpha/SKILL.md'),
  relativePath: toPosixRelativePath('SKILL.md'),
  extension: toFileExtension('.md'),
  size: toFileSizeBytes(10),
  previewable: 'text',
}
const second: SkillFile = {
  ...first,
  name: toFileName('guide.md'),
  path: toAbsolutePath('/skills/alpha/guide.md'),
  relativePath: toPosixRelativePath('guide.md'),
}
const body = {
  name: toFileName('SKILL.md'),
  content: 'First file',
  extension: toFileExtension('md'),
  lineCount: toLineCount(1),
}
const listing: SkillFilesListing = {
  status: 'complete',
  files: [first, second],
  issues: [],
  observedEntries: 2,
}
const listDetailed = vi.fn<() => Promise<SkillFilesListing>>()
const readDetailed =
  vi.fn<(_root: string, path: string) => Promise<SkillFileRead>>()

beforeEach(() => {
  listDetailed.mockReset().mockResolvedValue(listing)
  readDetailed
    .mockReset()
    .mockResolvedValue({ status: 'ready', kind: 'text', data: body })
  vi.stubGlobal('electron', {
    files: {
      listDetailed,
      readDetailed,
      cancelList: vi.fn().mockResolvedValue(undefined),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

/** Mounts a preview with the real shared cache and navigation reducer.
 * @example const { result, store } = await fixture()
 */
async function fixture(initialFile?: SkillFile) {
  const store = configureStore({ reducer: { skills } })
  store.dispatch(selectSkill(skill))
  if (initialFile)
    store.dispatch(inspectSkillFile({ skill, path: initialFile.path }))
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <SkillFilesProvider>{children}</SkillFilesProvider>
      </Provider>
    )
  }
  const mounted = await renderHook(
    (props: { path: string } = { path: root }) =>
      useCodePreview(toAbsolutePath(props.path)),
    { initialProps: { path: root }, wrapper: Wrapper },
  )
  return { ...mounted, store }
}

test('previews the first file and reuses a warm listing after a skill round trip', async () => {
  // Arrange
  const { result, rerender } = await fixture()
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'text', data: body })
  // Act
  rerender({ path: toAbsolutePath('/skills/beta') })
  await expect.poll(() => listDetailed.mock.calls.length).toBe(2)
  rerender({ path: root })
  // Assert
  await expect
    .poll(() => result.current.activeFile)
    .toBe('/skills/alpha/SKILL.md')
  expect(listDetailed).toHaveBeenCalledTimes(2)
})

test('honors an explicit Tree file intent before the initial read without reading SKILL.md', async () => {
  // Arrange / Act
  const { result } = await fixture(second)
  // Assert
  await expect
    .poll(() => result.current.activeFile)
    .toBe('/skills/alpha/guide.md')
  await expect.poll(() => readDetailed.mock.calls.length).toBe(1)
  expect(readDetailed).toHaveBeenCalledWith(
    '/skills/alpha',
    '/skills/alpha/guide.md',
  )
})

test('updates shared navigation when a Files tab is clicked and ignores unmapped paths', async () => {
  // Arrange
  const { result, store, act } = await fixture()
  await expect.poll(() => result.current.files.length).toBe(2)
  // Act
  await act(async () => result.current.setActiveFile(second.path))
  await act(async () =>
    result.current.setActiveFile(toAbsolutePath('/private/secret')),
  )
  // Assert
  expect(store.getState().skills.inspectedFile?.path).toBe(
    '/skills/alpha/guide.md',
  )
  expect(
    readDetailed.mock.calls.some((call) => call[1] === '/private/secret'),
  ).toBe(false)
})

test('discards a late initial read after another file is selected', async () => {
  // Arrange
  let release: (value: SkillFileRead) => void = () => undefined
  readDetailed.mockImplementationOnce(
    async () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  readDetailed.mockResolvedValue({
    status: 'ready',
    kind: 'text',
    data: { ...body, content: 'Second file' },
  })
  const { result, act } = await fixture()
  await expect.poll(() => readDetailed.mock.calls.length).toBe(1)
  // Act
  await act(async () => result.current.setActiveFile(second.path))
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'text', data: { ...body, content: 'Second file' } })
  await act(() => release({ status: 'ready', kind: 'text', data: body }))
  // Assert
  expect(result.current.content).toEqual({
    kind: 'text',
    data: { ...body, content: 'Second file' },
  })
})

test('clears old content while the newly selected file is reading', async () => {
  // Arrange
  const { result, act } = await fixture()
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'text', data: body })
  readDetailed.mockImplementation(async () => new Promise(() => {}))
  // Act
  await act(async () => result.current.setActiveFile(second.path))
  // Assert
  expect(result.current.reading).toBe(true)
  expect(result.current.content).toEqual({ kind: 'empty' })
})

test('distinguishes a successful empty directory from unavailable discovery', async () => {
  // Arrange
  listDetailed.mockResolvedValue({
    status: 'complete',
    files: [],
    issues: [],
    observedEntries: 0,
  })
  // Act
  const { result } = await fixture()
  // Assert
  await expect.poll(() => result.current.loading).toBe(false)
  expect(result.current.loadFailed).toBe(false)
  expect(result.current.activeFile).toBeNull()
  expect(readDetailed).not.toHaveBeenCalled()
})

test('settles rejected discovery and manually retries without an automatic loop', async () => {
  // Arrange
  listDetailed.mockRejectedValueOnce(new Error('private error'))
  const { result, act } = await fixture()
  await expect.poll(() => result.current.loadFailed).toBe(true)
  expect(listDetailed).toHaveBeenCalledTimes(1)
  // Act
  await act(() => result.current.retry())
  // Assert
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'text', data: body })
  expect(listDetailed).toHaveBeenCalledTimes(2)
})

test('retains readable tabs when a selected content read fails', async () => {
  // Arrange
  readDetailed.mockRejectedValueOnce(new Error('private error'))
  // Act
  const { result } = await fixture()
  // Assert
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'error', code: 'unavailable' })
  expect(result.current.files).toHaveLength(2)
  expect(result.current.loadFailed).toBe(false)
})

test('keeps a missing file intent visible as an error instead of silently previewing a different file', async () => {
  // Arrange
  const missing = { ...second, path: toAbsolutePath('/skills/alpha/gone.md') }
  // Act
  const { result } = await fixture(missing)
  // Assert
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'error', code: 'missing' })
  expect(readDetailed).not.toHaveBeenCalled()
})

test('invalidates a cached listing and rejects stale content when a rescan starts', async () => {
  // Arrange
  const { result, store, act } = await fixture()
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'text', data: body })
  listDetailed.mockImplementation(async () => new Promise(() => {}))
  // Act
  await act(() => store.dispatch(fetchSkills.pending('refresh', undefined)))
  // Assert
  await expect.poll(() => result.current.loading).toBe(true)
  expect(result.current.content).toEqual({ kind: 'empty' })
  expect(listDetailed).toHaveBeenCalledTimes(2)
})

test('shows an oversized-file placeholder without issuing a content read', async () => {
  // Arrange
  listDetailed.mockResolvedValue({
    ...listing,
    files: [{ ...first, previewable: 'binary' }],
  })
  // Act
  const { result } = await fixture()
  // Assert
  await expect
    .poll(() => result.current.content)
    .toEqual({ kind: 'binary', fileName: 'SKILL.md', size: 10 })
  expect(readDetailed).not.toHaveBeenCalled()
})
