import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import { FilterPill } from './FilterPill'

/**
 * FilterPill is presentational — it does not subscribe to Redux. The contract
 * worth pinning is: it renders the label after the static "Showing skills "
 * prefix, exposes the `data-testid` so MainContent can locate it, and calls
 * `onClear` when the Clear button is clicked. MainContent's pill-stacking
 * tests exercise the integration; this file stays focused on the primitive.
 */
describe('FilterPill', () => {
  it('renders "Showing skills <label>" and calls onClear on Clear click', async () => {
    const onClear = vi.fn()
    const screen = await render(
      <FilterPill
        label={
          <>
            for <strong>Claude Code</strong>
          </>
        }
        onClear={onClear}
        testId="agent-filter-pill"
      />,
    )

    const pill = screen.getByTestId('agent-filter-pill')
    await expect.element(pill).toBeInTheDocument()
    await expect
      .element(pill)
      .toHaveTextContent('Showing skills for Claude Code')

    await pill.getByRole('button', { name: /Clear/i }).click()
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})
