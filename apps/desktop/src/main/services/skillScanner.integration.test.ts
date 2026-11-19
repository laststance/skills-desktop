import {
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const home = mkdtempSync(join(tmpdir(), 'skills-inventory-'))
const source = join(home, '.agents', 'skills')
const agent = join(home, '.config', 'goose', 'skills')
const lockDir = join(home, 'state', 'skills')

vi.mock('../constants', () => ({
  SOURCE_DIR: source,
  TRASH_DIR: join(home, '.agents', '.trash'),
  AGENTS: [{ id: 'goose', name: 'Goose', path: agent }],
}))

const { scanSkills, getSourceStats } = await import('./skillScanner')
const { syncPreview } = await import('./syncService')

beforeEach(() => {
  rmSync(home, { recursive: true, force: true })
  for (const path of [source, agent, lockDir])
    mkdirSync(path, { recursive: true })
  vi.stubEnv('XDG_STATE_HOME', join(home, 'state'))
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})

/** Write a real manifest so the scanner can distinguish the directory from its display name.
 * @example installFixture(source, 'blue', 'Review')
 */
function installFixture(parent: string, dir: string, title: string): void {
  mkdirSync(join(parent, dir), { recursive: true })
  writeFileSync(
    join(parent, dir, 'SKILL.md'),
    `---\nname: ${title}\ndescription: A QA fixture\n---\n`,
  )
}

/** Write the CLI's lock envelope, including malformed entries for recovery tests.
 * @example writeLock({ review: { source: 'demo/review' } })
 */
function writeLock(skills: Record<string, unknown>): void {
  writeFileSync(
    join(lockDir, '.skill-lock.json'),
    JSON.stringify({ version: 3, skills }),
  )
}

test('a linked source with a manifest appears in Installed and the sidebar without becoming a cleanup target', async () => {
  // Arrange
  installFixture(home, 'checkout', 'Linked skill')
  symlinkSync('../../checkout', join(source, 'linked'))
  symlinkSync('../../absent', join(source, 'broken'))

  // Act
  const [skills, stats, cleanup] = await Promise.all([
    scanSkills(),
    getSourceStats(),
    syncPreview({ agentId: 'goose' }),
  ])

  // Assert
  expect(
    skills.map((skill) => [
      skill.name,
      skill.path,
      skill.filesystemIdentity?.kind,
    ]),
  ).toEqual([['Linked skill', join(source, 'linked'), 'symlink']])
  expect(stats.skillCount).toBe(1)
  expect(cleanup.toCreate).toBe(0)
  expect(readlinkSync(join(source, 'linked'))).toBe('../../checkout')
})

test('two source folders with the same title keep separate rows and their own repository links', async () => {
  // Arrange
  installFixture(source, 'blue', 'Review')
  installFixture(source, 'green', 'Review')
  writeLock({
    blue: { source: 'fixture/blue' },
    green: { source: 'fixture/green' },
  })

  // Act
  const skills = await scanSkills()

  // Assert
  expect(skills.map((skill) => [skill.name, skill.source])).toEqual([
    ['blue', 'fixture/blue'],
    ['green', 'fixture/green'],
  ])
})

test('a renamed source linked into an agent occupies one agent slot and one Installed row', async () => {
  // Arrange
  installFixture(source, 'renamed-dir', 'Readable title')
  symlinkSync(join(source, 'renamed-dir'), join(agent, 'renamed-dir'))

  // Act
  const skills = await scanSkills()

  // Assert
  expect(skills.map((skill) => [skill.name, skill.symlinkCount])).toEqual([
    ['Readable title', 1],
  ])
  expect(skills[0].symlinks[0].linkPath).toBe(join(agent, 'renamed-dir'))
})

test('an invalid repository field leaves only that skill local while a separately keyed CLI source remains actionable', async () => {
  // Arrange
  installFixture(source, 'bad', 'bad')
  installFixture(source, 'fancy-skill', 'Readable title')
  writeLock({
    bad: {
      source: { label: 'wrong type' },
      sourceUrl: 'https://example.org/bad',
    },
    'Fancy Skill': {
      source: 'fixture/fancy',
      sourceUrl: 'https://example.org/fancy.git',
    },
  })

  // Act
  const skills = await scanSkills()

  // Assert
  expect(skills.find((skill) => skill.name === 'bad')).toMatchObject({
    name: 'bad',
  })
  expect(skills.find((skill) => skill.name === 'bad')?.source).toBeUndefined()
  expect(skills.find((skill) => skill.name === 'Readable title')).toMatchObject(
    {
      source: 'fixture/fancy',
      sourceUrl: 'https://example.org/fancy.git',
    },
  )
})

test('a directory shared by two normalized lock keys never inherits a guessed repository', async () => {
  // Arrange
  installFixture(source, 'code-review', 'code-review')
  writeLock({
    'Code Review': { source: 'fixture/first' },
    'code-review': { source: 'fixture/second' },
  })

  // Act
  const [skill] = await scanSkills()

  // Assert
  expect(skill.name).toBe('code-review')
  expect(skill.source).toBeUndefined()
})
