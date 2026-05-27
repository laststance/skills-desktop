import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'
import type {
  Agent,
  AgentId,
  AgentName,
  Skill,
  SymlinkInfo,
  SymlinkStatus,
} from '@/shared/types'

/**
 * Build a minimal Agent fixture. Only `id`/`name`/`exists` matter to the
 * heatmap (columns come from installed agents); the rest are plausible filler.
 * @param id - Agent state id (e.g. "claude-code").
 * @param name - Display name driving the column header abbreviation.
 * @param exists - Whether the agent's skills dir is on disk (gates the column).
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
 * Build a SymlinkInfo fixture for one (skill × agent) slot.
 * @param agentId - Owning agent id.
 * @param agentName - Owning agent display name (appears in the cell label).
 * @param status - valid / broken / missing.
 * @param isLocal - True when the slot is a real local folder, not a symlink.
 */
function makeSymlink(
  agentId: AgentId,
  agentName: AgentName,
  status: SymlinkStatus,
  isLocal = false,
): SymlinkInfo {
  return {
    agentId,
    agentName,
    status,
    linkPath: `/Users/test/.${agentId}/skills/${agentName}`,
    isLocal,
  }
}

/**
 * Build a Skill fixture. `symlinkCount` is derived from the valid links so the
 * row-sorting input stays internally consistent.
 * @param name - Skill name (also the heatmap row label).
 * @param symlinks - Per-agent symlink slots for this skill.
 */
function makeSkill(name: string, symlinks: SymlinkInfo[]): Skill {
  return {
    name,
    description: `${name} description`,
    path: `/Users/test/.agents/skills/${name}`,
    symlinkCount: symlinks.filter((link) => link.status === 'valid').length,
    symlinks,
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Seed a store with the given skills/agents and render the heatmap inside a
 * sized wrapper (the widget is `h-full w-full`, so it needs a box to fill).
 * Seeding via each thunk's `fulfilled` action avoids mocking the IPC layer.
 */
async function renderHeatmap(skills: Skill[], agents: Agent[]) {
  const [
    { default: skillsReducer, fetchSkills },
    { default: agentsReducer, fetchAgents },
    { AgentHeatmapWidget },
  ] = await Promise.all([
    import('@/renderer/src/redux/slices/skillsSlice'),
    import('@/renderer/src/redux/slices/agentsSlice'),
    import('./AgentHeatmapWidget'),
  ])
  const store = configureStore({
    reducer: { skills: skillsReducer, agents: agentsReducer },
  })
  store.dispatch(fetchSkills.fulfilled(skills, 'req-skills'))
  store.dispatch(fetchAgents.fulfilled(agents, 'req-agents'))

  const screen = await render(
    <Provider store={store}>
      <div style={{ width: 320, height: 240 }}>
        <AgentHeatmapWidget />
      </div>
    </Provider>,
  )
  return { screen, store }
}

describe('AgentHeatmapWidget', () => {
  it('shows the not-enough-data hint when no agents are installed', async () => {
    // Arrange: a skill exists, but every agent is uninstalled (exists: false).
    const skills = [makeSkill('alpha-skill', [])]
    const agents = [
      makeAgent('claude-code', 'Claude Code', false),
      makeAgent('cursor', 'Cursor', false),
    ]

    // Act
    const { screen } = await renderHeatmap(skills, agents)

    // Assert
    await expect
      .element(screen.getByText('Not enough data for a heatmap yet'))
      .toBeVisible()
  })

  it('renders a two-letter column header for each installed agent and omits not-installed agents', async () => {
    // Arrange: Claude Code + Cursor are installed; Codex is not.
    const skills = [
      makeSkill('alpha-skill', [
        makeSymlink('claude-code', 'Claude Code', 'valid'),
      ]),
    ]
    const agents = [
      makeAgent('claude-code', 'Claude Code', true),
      makeAgent('cursor', 'Cursor', true),
      makeAgent('codex', 'Codex', false),
    ]

    // Act
    const { screen } = await renderHeatmap(skills, agents)

    // Assert: installed agents get an uppercased two-letter header...
    await expect.element(screen.getByText('CC', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('CU', { exact: true })).toBeVisible()
    // ...and the uninstalled Codex column never renders.
    expect(screen.getByText('CO', { exact: true }).query()).toBeNull()
  })

  it('labels each heatmap cell with its per-agent symlink status', async () => {
    // Arrange: one skill linked valid to Claude Code and broken to Cursor;
    // Codex is installed but has no link for this skill, so it reads "missing".
    const skills = [
      makeSkill('alpha-skill', [
        makeSymlink('claude-code', 'Claude Code', 'valid'),
        makeSymlink('cursor', 'Cursor', 'broken'),
      ]),
    ]
    const agents = [
      makeAgent('claude-code', 'Claude Code', true),
      makeAgent('cursor', 'Cursor', true),
      makeAgent('codex', 'Codex', true),
    ]

    // Act
    const { screen } = await renderHeatmap(skills, agents)

    // Assert: each cell exposes "<skill> — <status> in <agent>" as its
    // accessible label. (We assert presence, not visibility: the cells are
    // empty colored squares whose Tailwind size utilities aren't generated in
    // the test CSS bundle, so a labeled-but-zero-size cell is expected here.)
    expect(
      screen
        .getByRole('img', {
          name: 'alpha-skill — valid in Claude Code',
          exact: true,
        })
        .query(),
    ).not.toBeNull()
    expect(
      screen
        .getByRole('img', {
          name: 'alpha-skill — broken in Cursor',
          exact: true,
        })
        .query(),
    ).not.toBeNull()
    expect(
      screen
        .getByRole('img', {
          name: 'alpha-skill — missing in Codex',
          exact: true,
        })
        .query(),
    ).not.toBeNull()
  })

  it('labels a local folder slot as local to its agent', async () => {
    // Arrange: the skill is present as a real local folder in Claude Code.
    const skills = [
      makeSkill('gamma-skill', [
        makeSymlink('claude-code', 'Claude Code', 'valid', true),
      ]),
    ]
    const agents = [makeAgent('claude-code', 'Claude Code', true)]

    // Act
    const { screen } = await renderHeatmap(skills, agents)

    // Assert: local slots read "local to <agent>", not a status verb.
    expect(
      screen
        .getByRole('img', {
          name: 'gamma-skill — local to Claude Code',
          exact: true,
        })
        .query(),
    ).not.toBeNull()
  })
})
