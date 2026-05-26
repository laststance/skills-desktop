import { describe, expect, it } from 'vitest'

import { repositoryId } from '@/shared/types'

import { getEmptyListMessage } from './skillsListHelpers'

describe('getEmptyListMessage', () => {
  it('returns the search message with repo context when searchQuery and source are active', () => {
    // Search still wins as the user's most recent narrowing action, but the
    // active repo facet is named so the empty state explains the intersection.
    expect(
      getEmptyListMessage({
        searchQuery: 'react',
        selectedSources: [repositoryId('vercel-labs/skills')],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'local',
      }),
    ).toBe('No skills match your search in vercel-labs/skills')
  })

  it('returns the source message when only a single source is selected', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [repositoryId('vercel-labs/skills')],
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills from vercel-labs/skills')
  })

  it('collapses multiple selected sources to "the selected repositories"', () => {
    // With >1 repo in the include filter, naming each would bloat the empty
    // state; the helper summarizes instead of listing.
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [
          repositoryId('vercel-labs/skills'),
          repositoryId('pbakaus/impeccable'),
        ],
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills from the selected repositories')
  })

  it('adds the multi-source summary to a search result', () => {
    expect(
      getEmptyListMessage({
        searchQuery: 'react',
        selectedSources: [
          repositoryId('vercel-labs/skills'),
          repositoryId('pbakaus/impeccable'),
        ],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills match your search in the selected repositories')
  })

  it('source message wins over agent + type when both are set (search empty)', () => {
    // The pill is a more specific, more recent action than the persistent
    // agent tab. Order in the ladder is search > source > agent+type > agent.
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [repositoryId('pbakaus/impeccable')],
        selectedAgentId: 'claude-code',
        skillTypeFilter: 'symlinked',
      }),
    ).toBe('No skills from pbakaus/impeccable')
  })

  it('adds repository context to a search result when both query and source are active', () => {
    expect(
      getEmptyListMessage({
        searchQuery: 'trace',
        selectedSources: [repositoryId('laststance/skills')],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills match your search in laststance/skills')
  })

  it('returns the agent + type message when both are set (no source / search)', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'local',
      }),
    ).toBe('No local skills for this agent')
  })

  it('adds excluded skill types to the selected source message', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [repositoryId('vercel-labs/skills')],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'all',
        excludedSkillTypeFilters: ['gstack', 'orphan'],
      }),
    ).toBe(
      'No skills from vercel-labs/skills while excluding G-Stack and orphan',
    )
  })

  it('adds excluded skill types to the agent-only message', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'all',
        excludedSkillTypeFilters: ['local', 'gstack', 'orphan'],
      }),
    ).toBe(
      'No skills installed for this agent while excluding local, G-Stack, and orphan',
    )
  })

  it('returns the symlinked variant when type filter is symlinked', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: 'claude-code',
        skillTypeFilter: 'symlinked',
      }),
    ).toBe('No symlinked skills for this agent')
  })

  it('returns the G-Stack variant when type filter is gstack', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'gstack',
      }),
    ).toBe('No G-Stack skills for this agent')
  })

  it('returns the agent-only message when selectedAgentId is set and type is all', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: 'cursor',
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills installed for this agent')
  })

  it('returns the fallback when no narrowing is active', () => {
    // The "no agent, no source, no search" fallback is unusual — typically
    // means filteredSkills is empty because skills.length is 0, which is
    // handled by an earlier branch in SkillsList. Still worth locking the
    // string so the fallback never accidentally returns undefined.
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSources: [],
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills match your filter')
  })

  it('treats whitespace-only searchQuery as a non-empty query (current behavior)', () => {
    // Document the current contract: the helper checks `length > 0`, so
    // a single space counts. SkillsList trims-on-input is the right place
    // to change this if the UX wants to ignore whitespace; the helper only
    // mirrors the upstream value verbatim.
    expect(
      getEmptyListMessage({
        searchQuery: ' ',
        selectedSources: [],
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills match your search')
  })
})
