import { describe, expect, test } from 'vitest'

import { repositoryId } from '@/shared/types'

import {
  getEmptyListMessage,
  shouldShowOrphanToggle,
} from './skillsListHelpers'

describe('getEmptyListMessage', () => {
  test('names the active repo in the empty state when a search and a single source are both active', () => {
    // Search still wins as the user's most recent narrowing action, but the
    // active repo facet is named so the empty state explains the intersection.
    // Arrange: a search query plus a single selected source repo.
    // Act
    const message = getEmptyListMessage({
      searchQuery: 'react',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'local',
    })

    // Assert
    expect(message).toBe('No skills match your search in vercel-labs/skills')
  })

  test('names the single selected repo in the empty state when only that source is filtered', () => {
    // Arrange: only a single selected source repo, no search/agent narrowing.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: null,
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills from vercel-labs/skills')
  })

  test('summarizes several selected repos as "the selected repositories" instead of listing each', () => {
    // With >1 repo in the include filter, naming each would bloat the empty
    // state; the helper summarizes instead of listing.
    // Arrange: two selected source repos.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [
        repositoryId('vercel-labs/skills'),
        repositoryId('pbakaus/impeccable'),
      ],
      selectedAgentId: null,
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills from the selected repositories')
  })

  test('appends the multi-repo summary to a search empty state when several sources are filtered', () => {
    // Arrange: a search query plus two selected source repos.
    // Act
    const message = getEmptyListMessage({
      searchQuery: 'react',
      selectedSources: [
        repositoryId('vercel-labs/skills'),
        repositoryId('pbakaus/impeccable'),
      ],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe(
      'No skills match your search in the selected repositories',
    )
  })

  test('prefers the source message over the agent+type message when the search box is empty', () => {
    // The pill is a more specific, more recent action than the persistent
    // agent tab. Order in the ladder is search > source > agent+type > agent.
    // Arrange: a selected source repo competing with a selected agent + type.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [repositoryId('pbakaus/impeccable')],
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'symlinked',
    })

    // Assert
    expect(message).toBe('No skills from pbakaus/impeccable')
  })

  test('names the active repo in a search empty state when both a query and a single source are set', () => {
    // Arrange: a search query plus a single selected source repo.
    // Act
    const message = getEmptyListMessage({
      searchQuery: 'trace',
      selectedSources: [repositoryId('laststance/skills')],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills match your search in laststance/skills')
  })

  test('shows the agent-and-type empty state when an agent and a type filter are set without a source or search', () => {
    // Arrange: a selected agent plus a local type filter, no source/search.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'local',
    })

    // Assert
    expect(message).toBe('No local skills for this agent')
  })

  test('appends the excluded skill types to the selected-source empty state', () => {
    // Arrange: a selected source repo with two excluded skill types.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
      excludedSkillTypeFilters: ['gstack', 'orphan'],
    })

    // Assert
    expect(message).toBe(
      'No skills from vercel-labs/skills while excluding G-Stack and orphan',
    )
  })

  test('appends the excluded skill types to the agent-only empty state, Oxford-comma joined', () => {
    // Arrange: a selected agent with three excluded skill types.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
      excludedSkillTypeFilters: ['local', 'gstack', 'orphan'],
    })

    // Assert
    expect(message).toBe(
      'No skills installed for this agent while excluding local, G-Stack, and orphan',
    )
  })

  test('appends a single excluded skill type with no conjunction or comma when exactly one type is excluded', () => {
    // With one exclude active, the copy must read plainly ("excluding G-Stack")
    // — no "and", no Oxford comma, which only apply to multi-exclude lists.
    // Arrange: a selected agent with exactly one excluded skill type.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
      excludedSkillTypeFilters: ['gstack'],
    })

    // Assert
    expect(message).toBe(
      'No skills installed for this agent while excluding G-Stack',
    )
  })

  test('shows the symlinked-only empty state when the type filter is symlinked', () => {
    // Arrange: a selected agent with the symlinked type filter.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'symlinked',
    })

    // Assert
    expect(message).toBe('No symlinked skills for this agent')
  })

  test('shows the G-Stack-only empty state when the type filter is gstack', () => {
    // Arrange: a selected agent with the gstack type filter.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'gstack',
    })

    // Assert
    expect(message).toBe('No G-Stack skills for this agent')
  })

  test('shows the unique-only empty state when the type filter is unique', () => {
    // Arrange: a selected agent with the unique type filter and no other narrow.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'unique',
    })

    // Assert
    expect(message).toBe('No unique skills for this agent')
  })

  test('appends a single excluded unique type to the agent-only empty state', () => {
    // Arrange: a selected agent excluding the unique type under the all include.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
      excludedSkillTypeFilters: ['unique'],
    })

    // Assert
    expect(message).toBe(
      'No skills installed for this agent while excluding unique',
    )
  })

  test('shows the generic agent empty state when an agent is selected and no type filter narrows it', () => {
    // Arrange: a selected agent with the all type filter (no narrowing).
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'cursor',
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills installed for this agent')
  })

  test('shows the generic fallback message when nothing is narrowing the list', () => {
    // The "no agent, no source, no search" fallback is unusual — typically
    // means filteredSkills is empty because skills.length is 0, which is
    // handled by an earlier branch in SkillsList. Still worth locking the
    // string so the fallback never accidentally returns undefined.
    // Arrange: no search, no source, no agent, no type narrowing.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: null,
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills match your filter')
  })

  test('treats a whitespace-only query as a real search rather than an empty one', () => {
    // Document the current contract: the helper checks `length > 0`, so
    // a single space counts. SkillsList trims-on-input is the right place
    // to change this if the UX wants to ignore whitespace; the helper only
    // mirrors the upstream value verbatim.
    // Arrange: a single-space search query.
    // Act
    const message = getEmptyListMessage({
      searchQuery: ' ',
      selectedSources: [],
      selectedAgentId: null,
      skillTypeFilter: 'all',
    })

    // Assert
    expect(message).toBe('No skills match your search')
  })
})

describe('source-view Orphan toggle', () => {
  test('names the orphan population when the source-view Orphan toggle is on and nothing matches', () => {
    // Arrange: source view with the orphan mode active and zero orphan rows.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: null,
      skillTypeFilter: 'orphan',
    })

    // Assert
    expect(message).toBe('No orphaned skills')
  })

  test('keeps the orphan message when repo ticks are still selected underneath the suppressed narrowing', () => {
    // Arrange: orphan mode with repo ticks left in state — the narrowing is
    // suppressed in orphan mode, so the copy must not blame the repo filter.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: null,
      skillTypeFilter: 'orphan',
    })

    // Assert — the orphan arm wins over the repo arm
    expect(message).toBe('No orphaned skills')
  })

  test('still blames the search when orphan mode is on — the search itself is not suppressed', () => {
    // Arrange: orphan mode + a search query + a stale repo tick. Only the repo
    // narrowing is masked; the search arm stays honest.
    // Act
    const message = getEmptyListMessage({
      searchQuery: 'brain',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: null,
      skillTypeFilter: 'orphan',
    })

    // Assert
    expect(message).toBe('No skills match your search')
  })

  test('names the Orphan type filter when an agent view has no orphan rows', () => {
    // Arrange: agent view keeps 'orphan' as a normal type filter — distinct
    // from the source-view population swap.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: 'claude-code',
      skillTypeFilter: 'orphan',
    })

    // Assert
    expect(message).toBe('No orphan skills for this agent')
  })

  test('does not claim an orphan empty state for an inert persisted filter in source view', () => {
    // Arrange: 'local' persisted across an agent→source switch is inert in
    // source view — it must fall through to the plain fallback, not lie.
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: null,
      skillTypeFilter: 'local',
    })

    // Assert
    expect(message).toBe('No skills match your filter')
  })

  test('never appends the exclude suffix in source view where excludes do not apply', () => {
    // Arrange: a persisted exclude carried into source view (selectAgent no
    // longer clears it) must not produce "No orphaned skills while excluding X".
    // Act
    const message = getEmptyListMessage({
      searchQuery: '',
      selectedSources: [],
      selectedAgentId: null,
      skillTypeFilter: 'orphan',
      excludedSkillTypeFilters: ['gstack'],
    })

    // Assert
    expect(message).toBe('No orphaned skills')
  })

  test('blames the search alone when orphan mode, a query, and repo ticks are all active', () => {
    // Arrange: search applies in orphan mode but repo narrowing is suppressed —
    // "…in <repo>" would name a filter that isn't running.
    // Act
    const message = getEmptyListMessage({
      searchQuery: 'zzz',
      selectedSources: [repositoryId('vercel-labs/skills')],
      selectedAgentId: null,
      skillTypeFilter: 'orphan',
    })

    // Assert — the repo phrase is dropped; the search arm wins
    expect(message).toBe('No skills match your search')
  })
})

describe('shouldShowOrphanToggle', () => {
  test.each([
    [null, 3, true],
    [null, 1, true],
    [null, 0, false],
    ['cursor', 3, false],
    ['cursor', 0, false],
  ] as const)(
    'shows the source-view Orphan toggle only in source view with orphans (agent=%s, count=%s → %s)',
    (selectedAgentId, orphanCount, expected) => {
      // Act + Assert — source view + at least one orphan → visible; agent
      // view or zero orphans → hidden (the pill owns the exit at 0 anyway).
      expect(shouldShowOrphanToggle(selectedAgentId, orphanCount)).toBe(
        expected,
      )
    },
  )
})
