import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { Agent, AgentId, AgentName, Skill } from '@/shared/types'

/**
 * Build an Agent fixture letting each test vary the `exists` flag that gates the
 * active-agent count. Counts/path are filler — StatsWidget only reads `exists`.
 * @param id - Agent state id (must be a real AgentId, e.g. "claude-code").
 * @param name - Display name (must be a real AgentName, e.g. "Claude Code").
 * @param exists - Whether the agent's skills dir is on disk (drives "Agents").
 */
function makeAgent(id: AgentId, name: AgentName, exists: boolean): Agent {
  return {
    id,
    name,
    path: `/Users/test/.${id}/skills`,
    exists,
    skillCount: 0,
    localSkillCount: 0,
  }
}

/**
 * Build a Skill fixture letting each test vary `symlinkCount`, which gates the
 * linked-skill count. The other fields are filler the widget never reads.
 * @param name - Skill name (also its source dir basename).
 * @param symlinkCount - Valid symlink count; > 0 means the skill is "Linked".
 */
function makeSkill(name: string, symlinkCount: number): Skill {
  return {
    name,
    description: `${name} description`,
    path: `/Users/test/.agents/skills/${name}`,
    symlinkCount,
    symlinks: [],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Seed a store with the given skills/agents and render StatsWidget inside a sized
 * wrapper (the widget is `h-full w-full`). Seeding via each thunk's `fulfilled`
 * action avoids mocking IPC, matching the sibling CoverageWidget test.
 * @param skills - Skills to seed into skillsSlice (symlinkCount drives "Linked").
 * @param agents - Agents to seed into agentsSlice (exists drives "Agents").
 */
async function renderStats(skills: Skill[], agents: Agent[]) {
  const [
    { default: skillsReducer, fetchSkills },
    { default: agentsReducer, fetchAgents },
    { StatsWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./StatsWidget'),
  ])
  const store = configureStore({
    reducer: { skills: skillsReducer, agents: agentsReducer },
  })
  store.dispatch(fetchSkills.fulfilled(skills, 'req-skills'))
  store.dispatch(fetchAgents.fulfilled(agents, 'req-agents'))

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 96 }}>
        <StatsWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('StatsWidget', () => {
  it('counts only symlinked skills as Linked and only on-disk agents as active', async () => {
    // Arrange: 3 skills where 2 carry valid symlinks and 1 is unlinked (count 0),
    // plus 4 agents where exactly 1 has its skills dir on disk and 3 do not. The
    // resulting numbers (Skills 3, Linked 2, Agents 1) are deliberately distinct
    // so each filtered count is asserted unambiguously.
    const skills = [
      makeSkill('alpha-skill', 2),
      makeSkill('beta-skill', 1),
      makeSkill('gamma-skill', 0),
    ]
    const agents = [
      makeAgent('claude-code', 'Claude Code', true),
      makeAgent('cursor', 'Cursor', false),
      makeAgent('codex', 'Codex', false),
      makeAgent('gemini-cli', 'Gemini CLI', false),
    ]

    // Act
    const { screen } = await renderStats(skills, agents)

    // Assert: the unlinked skill is excluded so Linked shows 2, and the three
    // absent agents are excluded so Agents shows the single active 1.
    await expect.element(screen.getByText('3')).toBeVisible()
    await expect.element(screen.getByText('2')).toBeVisible()
    await expect.element(screen.getByText('1')).toBeVisible()
  })
})
