import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type { Agent, AgentId, AgentName, Skill } from '@/shared/types'

/**
 * Build an Agent fixture letting each test vary the coverage-relevant fields.
 * @param id - Agent state id (e.g. "claude-code").
 * @param name - Display name shown in the row label.
 * @param exists - Whether the agent's skills dir is on disk (gates disabled/bar).
 * @param skillCount - Valid symlinked-from-source skills (the `linked` count).
 * @param localSkillCount - Real local folders in the agent dir (the `local` count).
 */
function makeAgent(
  id: AgentId,
  name: AgentName,
  exists: boolean,
  skillCount: number,
  localSkillCount: number,
): Agent {
  return {
    id,
    name,
    path: `/Users/test/.${id}/skills`,
    exists,
    skillCount,
    localSkillCount,
  }
}

/**
 * Build a minimal Skill fixture. The CoverageWidget only reads `skills.length`
 * (the source-pool size for the fill-bar ratio), so the other fields are filler.
 * @param name - Skill name (also its source dir basename).
 */
function makeSkill(name: string): Skill {
  return {
    name,
    description: `${name} description`,
    path: `/Users/test/.agents/skills/${name}`,
    symlinkCount: 0,
    symlinks: [],
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Seed a store with the given agents/skills and render the widget inside a sized
 * wrapper (the widget is `h-full w-full`). Seeding via each thunk's `fulfilled`
 * action avoids mocking the IPC layer, matching the sibling widget tests.
 * @param agents - Agents to seed into agentsSlice.
 * @param skills - Source skills to seed into skillsSlice (length drives the ratio).
 */
async function renderCoverage(agents: Agent[], skills: Skill[]) {
  const [
    { default: agentsReducer, fetchAgents },
    { default: skillsReducer, fetchSkills },
    { default: uiReducer },
    { CoverageWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/uiSlice'),
    import('./CoverageWidget'),
  ])
  const store = configureStore({
    reducer: { agents: agentsReducer, skills: skillsReducer, ui: uiReducer },
  })
  store.dispatch(fetchAgents.fulfilled(agents, 'req-agents'))
  store.dispatch(fetchSkills.fulfilled(skills, 'req-skills'))

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <CoverageWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('CoverageWidget', () => {
  it('shows the empty-state hint when no agents are discovered', async () => {
    // Arrange + Act: no agents seeded, but the source pool has a skill.
    const { screen } = await renderCoverage([], [makeSkill('alpha-skill')])

    // Assert
    await expect
      .element(screen.getByText('No agents discovered yet'))
      .toBeVisible()
  })

  it('renders one row per agent showing its linked and local skill counts', async () => {
    // Arrange: Claude Code has 8 linked + 2 local; Cursor has 3 linked, 0 local.
    const agents = [
      makeAgent('claude-code', 'Claude Code', true, 8, 2),
      makeAgent('cursor', 'Cursor', true, 3, 0),
    ]
    const skills = [
      makeSkill('alpha-skill'),
      makeSkill('beta-skill'),
      makeSkill('gamma-skill'),
    ]

    // Act
    const { screen } = await renderCoverage(agents, skills)

    // Assert: each row exposes its per-agent linked/local breakdown as the
    // button's accessible label, so a regression that mis-attributes counts to
    // the wrong agent fails here.
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Claude Code: 8 linked, 2 local',
        }),
      )
      .toBeVisible()
    await expect
      .element(
        screen.getByRole('button', { name: 'Cursor: 3 linked, 0 local' }),
      )
      .toBeVisible()
  })

  it('selects the clicked agent so the main list filters to it', async () => {
    // Arrange: two installed agents; nothing selected yet.
    const agents = [
      makeAgent('claude-code', 'Claude Code', true, 5, 0),
      makeAgent('cursor', 'Cursor', true, 2, 0),
    ]
    const skills = [makeSkill('alpha-skill')]
    const { screen, store } = await renderCoverage(agents, skills)

    // Act: click the Cursor row.
    await screen
      .getByRole('button', { name: 'Cursor: 2 linked, 0 local' })
      .click()

    // Assert: the clicked agent becomes the selected agent in ui state.
    expect(store.getState().ui.selectedAgentId).toBe('cursor')
  })

  it('marks a not-installed agent as a disabled row tagged "not installed"', async () => {
    // Arrange: Codex is discovered but its skills dir is absent (exists: false).
    const agents = [makeAgent('codex', 'Codex', false, 0, 0)]
    const skills = [makeSkill('alpha-skill')]

    // Act
    const { screen } = await renderCoverage(agents, skills)

    // Assert: the row is disabled (un-clickable) and shows the "not installed"
    // tag instead of a fill bar.
    await expect
      .element(screen.getByRole('button', { name: 'Codex: 0 linked, 0 local' }))
      .toBeDisabled()
    await expect.element(screen.getByText('not installed')).toBeVisible()
  })

  it('shows a bare zero for an installed agent with no skills at all', async () => {
    // Arrange: an installed agent with zero linked and zero local skills, and an
    // empty source pool so the ratio stays at 0 (no divide-by-zero bar).
    const agents = [makeAgent('claude-code', 'Claude Code', true, 0, 0)]
    const skills: Skill[] = []

    // Act
    const { screen } = await renderCoverage(agents, skills)

    // Assert: the count column collapses to a single muted "0".
    await expect.element(screen.getByText('0', { exact: true })).toBeVisible()
  })
})
