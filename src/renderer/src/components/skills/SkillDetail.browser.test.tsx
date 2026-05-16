import { configureStore } from '@reduxjs/toolkit'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { DEFAULT_SETTINGS } from '@/shared/settings'
import type { Agent, AgentId, Skill, SymlinkInfo } from '@/shared/types'

const SOURCE_PATH = '/home/user/.agents/skills/task'
const CURSOR_PATH = '/home/user/.cursor/skills/task'
const mockWriteText = vi.fn()
const toastErrorMock = vi.fn()
let originalClipboardDescriptor: PropertyDescriptor | undefined

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
 * @returns Render handle and Redux store.
 */
async function renderSkillDetail(selectedAgentId: AgentId | null = null) {
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
        items: [makeAgent()],
        loading: false,
        error: null,
        agentToDelete: null,
        deleting: false,
      },
    },
  })

  store.dispatch(setSettings({ ...DEFAULT_SETTINGS, defaultSkillTab: 'info' }))
  store.dispatch(selectAgent(selectedAgentId))

  const screen = await render(
    <Provider store={store}>
      <SkillDetail skill={makeSkill()} />
    </Provider>,
  )

  return { screen, store }
}

describe('SkillDetail Info path copy', () => {
  it('copies the single source path when no agent is selected', async () => {
    const { screen } = await renderSkillDetail()

    await expect.element(screen.getByText('Path')).toBeInTheDocument()
    await screen.getByRole('button', { name: /^Copy path$/i }).click()

    expect(mockWriteText).toHaveBeenCalledWith(SOURCE_PATH)
    await expect
      .element(screen.getByRole('button', { name: /^Copy path$/i }))
      .toHaveTextContent(/Copied/)
  })

  it('copies source and symlink paths independently in agent view', async () => {
    const { screen } = await renderSkillDetail('cursor' as AgentId)

    await screen
      .getByRole('button', { name: /Copy Source Files path/i })
      .click()
    await screen.getByRole('button', { name: /Copy Symlink path/i }).click()

    expect(mockWriteText).toHaveBeenNthCalledWith(1, SOURCE_PATH)
    expect(mockWriteText).toHaveBeenNthCalledWith(2, CURSOR_PATH)
  })

  it('toasts when copying the source path fails', async () => {
    mockWriteText.mockRejectedValueOnce(new Error('copy failed'))
    const { screen } = await renderSkillDetail()

    await screen.getByRole('button', { name: /^Copy path$/i }).click()

    expect(mockWriteText).toHaveBeenCalledWith(SOURCE_PATH)
    await expect
      .poll(() => toastErrorMock.mock.calls[0]?.[0])
      .toBe('Failed to copy path')
  })
})
