import { describe, expect, it } from 'vitest'

import { repositoryId } from '../../../../shared/types'

import { getEmptyListMessage } from './skillsListHelpers'

describe('getEmptyListMessage', () => {
  it('returns the search message when searchQuery is non-empty (highest priority)', () => {
    // Even with every other filter active, search wins because the user's
    // most recent narrowing action is what they want named in the message.
    expect(
      getEmptyListMessage({
        searchQuery: 'react',
        selectedSource: repositoryId('vercel-labs/skills'),
        selectedAgentId: 'cursor',
        skillTypeFilter: 'local',
      }),
    ).toBe('No skills match your search')
  })

  it('returns the source message when only selectedSource is set', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSource: repositoryId('vercel-labs/skills'),
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills from vercel-labs/skills')
  })

  it('source message wins over agent + type when both are set (search empty)', () => {
    // The pill is a more specific, more recent action than the persistent
    // agent tab. Order in the ladder is search > source > agent+type > agent.
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSource: repositoryId('pbakaus/impeccable'),
        selectedAgentId: 'claude-code',
        skillTypeFilter: 'symlinked',
      }),
    ).toBe('No skills from pbakaus/impeccable')
  })

  it('returns the agent + type message when both are set (no source / search)', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSource: null,
        selectedAgentId: 'cursor',
        skillTypeFilter: 'local',
      }),
    ).toBe('No local skills for this agent')
  })

  it('returns the symlinked variant when type filter is symlinked', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSource: null,
        selectedAgentId: 'claude-code',
        skillTypeFilter: 'symlinked',
      }),
    ).toBe('No symlinked skills for this agent')
  })

  it('returns the agent-only message when selectedAgentId is set and type is all', () => {
    expect(
      getEmptyListMessage({
        searchQuery: '',
        selectedSource: null,
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
        selectedSource: null,
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
        selectedSource: null,
        selectedAgentId: null,
        skillTypeFilter: 'all',
      }),
    ).toBe('No skills match your search')
  })
})
