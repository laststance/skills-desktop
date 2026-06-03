import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { installLayoutStyles } from '@/renderer/src/test/installLayoutStyles'
import { DEFAULT_SETTINGS } from '@/shared/settings'
import type {
  Agent,
  AgentId,
  AgentName,
  Skill,
  SymlinkInfo,
} from '@/shared/types'

const SOURCE_PATH = '/home/user/.agents/skills/task'
const CURSOR_PATH = '/home/user/.cursor/skills/task'
const DETAIL_PANEL_TEST_HEIGHT_PX = 280
const DETAIL_DRAG_REGION_HEIGHT_PX = 32
const VISIBLE_BOUNDS_TOLERANCE_PX = 1
const mockWriteText = vi.fn()
const toastErrorMock = vi.fn()
let originalClipboardDescriptor: PropertyDescriptor | undefined

const OVERFLOW_AGENT_ROWS = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'codex', name: 'Codex' },
  { id: 'gemini-cli', name: 'Gemini CLI' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'github-copilot', name: 'GitHub Copilot' },
  { id: 'cline', name: 'Cline' },
  { id: 'windsurf', name: 'Windsurf' },
  { id: 'junie', name: 'Junie' },
  { id: 'antigravity', name: 'Antigravity' },
  { id: 'kiro-cli', name: 'Kiro CLI' },
  { id: 'mcpjam', name: 'MCPJam' },
  { id: 'openclaw', name: 'OpenClaw' },
  { id: 'warp', name: 'Warp' },
  { id: 'devin', name: 'Devin for Terminal' },
] satisfies Array<{ id: AgentId; name: AgentName }>

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

vi.mock('./CodePreview', () => ({
  CodePreview: () => <div data-testid="mock-code-preview" />,
}))

/**
 * Build a minimal installed-agent fixture for SkillDetail tests.
 * @param overrides - Agent fields that differ from the default Cursor row.
 * @returns Complete Agent object.
 * @example
 * makeAgent({ id: 'claude-code', name: 'Claude Code' })
 */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'cursor' as AgentId,
    name: 'Cursor',
    path: '/home/user/.cursor/skills',
    exists: true,
    skillCount: 1,
    localSkillCount: 0,
    ...overrides,
  }
}

/**
 * Build a minimal skill fixture with one valid Cursor symlink.
 * @returns Complete Skill object.
 * @example
 * makeSkill()
 */
function makeSkill(): Skill {
  const symlinks: SymlinkInfo[] = [
    {
      agentId: 'cursor' as AgentId,
      agentName: 'Cursor',
      status: 'valid',
      targetPath: SOURCE_PATH,
      linkPath: CURSOR_PATH,
      isLocal: false,
    },
  ]

  return {
    name: 'task',
    description: 'Task workflow',
    path: SOURCE_PATH,
    symlinkCount: symlinks.length,
    symlinks,
    isSource: true,
    isOrphan: false,
  }
}

/**
 * Build enough Info rows to overflow the fixed-height detail shell used by the regression test.
 * @returns Agents and skill rows that force the Info tab to need vertical scrolling.
 * @example
 * const { agents, skill } = makeOverflowSkillFixture()
 */
function makeOverflowSkillFixture(): { agents: Agent[]; skill: Skill } {
  const agents = OVERFLOW_AGENT_ROWS.map(({ id, name }) =>
    makeAgent({
      id,
      name,
      path: `/home/user/.${id}/skills`,
      skillCount: 1,
    }),
  )
  const symlinks: SymlinkInfo[] = OVERFLOW_AGENT_ROWS.map(({ id, name }) => ({
    agentId: id,
    agentName: name,
    status: 'valid',
    targetPath: SOURCE_PATH,
    linkPath: id === 'cursor' ? CURSOR_PATH : `/home/user/.${id}/skills/task`,
    isLocal: false,
  }))

  return {
    agents,
    skill: {
      ...makeSkill(),
      symlinkCount: symlinks.length,
      symlinks,
    },
  }
}

beforeEach(() => {
  mockWriteText.mockReset()
  mockWriteText.mockResolvedValue(undefined)
  toastErrorMock.mockReset()
  originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    'clipboard',
  )
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mockWriteText },
  })
})

afterEach(() => {
  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor)
  } else {
    Reflect.deleteProperty(navigator, 'clipboard')
  }
  vi.restoreAllMocks()
})

/**
 * Render SkillDetail on the Info tab with the smallest real Redux state shape.
 * @param selectedAgentId - Optional selected agent; when present, Location shows both source and symlink paths.
 * @param skill - Skill fixture rendered in the right detail panel.
 * @param options - Optional installed-agent rows and shell chrome for layout regressions.
 * @returns Render handle and Redux store.
 * @example
 * await renderSkillDetail('cursor' as AgentId, makeSkill(), { withDetailShell: true })
 */
async function renderSkillDetail(
  selectedAgentId: AgentId | null = null,
  skill: Skill = makeSkill(),
  options: { agents?: Agent[]; withDetailShell?: boolean } = {},
) {
  const { default: settingsReducer } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { setSettings } =
    await import('@/renderer/src/redux/slices/settingsSlice')
  const { default: agentsReducer } =
    await import('@/renderer/src/redux/slices/agentsSlice')
  const { default: uiReducer, selectAgent } =
    await import('@/renderer/src/redux/slices/uiSlice')
  const { SkillDetail } = await import('./SkillDetail')

  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      agents: agentsReducer,
      ui: uiReducer,
    },
    preloadedState: {
      agents: {
        items: options.agents ?? [makeAgent()],
        loading: false,
        error: null,
        agentToDelete: null,
        deleting: false,
      },
    },
  })

  store.dispatch(setSettings({ ...DEFAULT_SETTINGS, defaultSkillTab: 'info' }))
  store.dispatch(selectAgent(selectedAgentId))

  const skillDetail = <SkillDetail skill={skill} />
  const content = options.withDetailShell ? (
    <div
      data-testid="detail-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: `${DETAIL_PANEL_TEST_HEIGHT_PX}px`,
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="detail-drag-region"
        style={{
          flexShrink: 0,
          height: `${DETAIL_DRAG_REGION_HEIGHT_PX}px`,
        }}
      />
      {skillDetail}
    </div>
  ) : (
    skillDetail
  )

  const screen = await render(<Provider store={store}>{content}</Provider>)

  return { screen, store }
}

describe('SkillDetail Info path copy', () => {
  it('copies the single source path when no agent is selected', async () => {
    // Arrange
    const { screen } = await renderSkillDetail()

    // Act
    await expect.element(screen.getByText('Path')).toBeInTheDocument()
    await screen.getByRole('button', { name: /^Copy path$/i }).click()

    // Assert
    expect(mockWriteText).toHaveBeenCalledWith(SOURCE_PATH)
    await expect
      .element(screen.getByRole('button', { name: /^Copy path$/i }))
      .toHaveTextContent(/Copied/)
  })

  it('copies source and symlink paths independently in agent view', async () => {
    // Arrange
    const { screen } = await renderSkillDetail('cursor' as AgentId)

    // Act
    await screen
      .getByRole('button', { name: /Copy Source Files path/i })
      .click()
    await screen.getByRole('button', { name: /Copy Symlink path/i }).click()

    // Assert
    expect(mockWriteText).toHaveBeenNthCalledWith(1, SOURCE_PATH)
    expect(mockWriteText).toHaveBeenNthCalledWith(2, CURSOR_PATH)
  })

  it('toasts when copying the source path fails', async () => {
    // Arrange
    mockWriteText.mockRejectedValueOnce(new Error('copy failed'))
    const { screen } = await renderSkillDetail()

    // Act
    await screen.getByRole('button', { name: /^Copy path$/i }).click()

    // Assert
    expect(mockWriteText).toHaveBeenCalledWith(SOURCE_PATH)
    await expect
      .poll(() => toastErrorMock.mock.calls[0]?.[0])
      .toBe('Failed to copy path')
  })

  it('counts inaccessible symlinks separately in the info summary', async () => {
    // Arrange
    const skill = makeSkill()
    skill.symlinks = [
      {
        agentId: 'cursor' as AgentId,
        agentName: 'Cursor',
        status: 'inaccessible',
        targetPath: SOURCE_PATH,
        linkPath: CURSOR_PATH,
        isLocal: false,
      },
    ]

    // Act
    const { screen } = await renderSkillDetail(null, skill)

    // Assert
    await expect.element(screen.getByText('Valid:')).toBeInTheDocument()
    await expect.element(screen.getByText('Broken:')).toBeInTheDocument()
    await expect.element(screen.getByText('Inaccessible:')).toBeInTheDocument()
    // Scope the count assertion to the Inaccessible row so it cannot pass on a
    // stray "1" rendered elsewhere (e.g. if the count landed in Valid instead).
    const inaccessibleRow = screen
      .getByText('Inaccessible:')
      .element()
      .closest('div')
    expect(inaccessibleRow).toBeInstanceOf(HTMLElement)
    await expect
      .element(inaccessibleRow as HTMLElement)
      .toHaveTextContent(/Inaccessible:\s*1/)
  })

  it('keeps Location paths visible after scrolling the Info tab inside detail chrome', async () => {
    // Arrange
    const layoutStyleElement = installLayoutStyles()
    const { agents, skill } = makeOverflowSkillFixture()
    try {
      const { screen } = await renderSkillDetail('cursor' as AgentId, skill, {
        agents,
        withDetailShell: true,
      })
      const detailShell = screen.container.querySelector(
        '[data-testid="detail-shell"]',
      )
      const infoScroller = screen.container.querySelector(
        '[data-skill-info-scroll]',
      )
      const symlinkPath = screen.getByText(CURSOR_PATH).element()

      expect(detailShell).toBeInstanceOf(HTMLElement)
      expect(infoScroller).toBeInstanceOf(HTMLElement)

      // Act
      const scrollPane = infoScroller as HTMLElement
      scrollPane.scrollTop = scrollPane.scrollHeight
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })

      // Assert
      expect(scrollPane.scrollHeight).toBeGreaterThan(scrollPane.clientHeight)
      expect(
        Math.round((detailShell as HTMLElement).getBoundingClientRect().height),
      ).toBe(DETAIL_PANEL_TEST_HEIGHT_PX)
      expect(symlinkPath.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        (detailShell as HTMLElement).getBoundingClientRect().bottom +
          VISIBLE_BOUNDS_TOLERANCE_PX,
      )
    } finally {
      layoutStyleElement.remove()
    }
  })
})
