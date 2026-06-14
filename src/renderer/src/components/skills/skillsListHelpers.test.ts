import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'

import { getEmptyListMessage } from './skillsListHelpers'

describe('getEmptyListMessage', () => {
  it('names the active repo in the empty state when a search and a single source are both active', () => {
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

  it('names the single selected repo in the empty state when only that source is filtered', () => {
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

  it('summarizes several selected repos as "the selected repositories" instead of listing each', () => {
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

  it('appends the multi-repo summary to a search empty state when several sources are filtered', () => {
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

  it('prefers the source message over the agent+type message when the search box is empty', () => {
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

  it('names the active repo in a search empty state when both a query and a single source are set', () => {
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

  it('shows the agent-and-type empty state when an agent and a type filter are set without a source or search', () => {
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

  it('appends the excluded skill types to the selected-source empty state', () => {
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

  it('appends the excluded skill types to the agent-only empty state, Oxford-comma joined', () => {
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

  it('appends a single excluded skill type with no conjunction or comma when exactly one type is excluded', () => {
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

  it('shows the symlinked-only empty state when the type filter is symlinked', () => {
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

  it('shows the G-Stack-only empty state when the type filter is gstack', () => {
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

  it('shows the generic agent empty state when an agent is selected and no type filter narrows it', () => {
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

  it('shows the generic fallback message when nothing is narrowing the list', () => {
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

  it('treats a whitespace-only query as a real search rather than an empty one', () => {
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
