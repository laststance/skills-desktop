import { Panel, Group, Separator } from 'react-resizable-panels'
import { describe, expect, test } from 'vitest'
import { userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { PANEL_MIN_WIDTH_PX } from '@/shared/constants'

import '@/renderer/src/styles/globals.css'

/**
 * The real react-resizable-panels trio inside a fixed-width shell. 528px is
 * the Group width at the 800px minimum window (800 content − 272 sidebar;
 * the Separator renders 0px wide). Mirrors the {@link App} panel contract:
 * both panels at `defaultSize="50%"` with the {@link PANEL_MIN_WIDTH_PX}
 * floor — imported, not literal, so bumping the constant past what a 528px
 * shell can satisfy fails loudly instead of silently degrading.
 * @param widthPx - Group width in CSS pixels.
 */
async function renderPanelShell(widthPx = 528) {
  return render(
    <div style={{ width: widthPx, height: 200 }}>
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="50%" minSize={PANEL_MIN_WIDTH_PX}>
          <div className="h-full" />
        </Panel>
        <Separator className="cursor-col-resize" />
        <Panel defaultSize="50%" minSize={PANEL_MIN_WIDTH_PX}>
          <div className="h-full" />
        </Panel>
      </Group>
    </div>,
  )
}

/**
 * Panel elements carry `data-panel` under the Group's `data-group` — the
 * library owns `data-testid`. Scoped to the group so a future nested Group
 * can't reorder the [center, right] indexes.
 */
function panelWidths(): number[] {
  return Array.from(document.querySelectorAll('[data-group] [data-panel]')).map(
    (panel) => panel.getBoundingClientRect().width,
  )
}

describe('App panel floor (real react-resizable-panels)', () => {
  test('ArrowLeft on the separator cannot drag a panel below the 264px pixel floor', async () => {
    // Arrange
    const screen = await renderPanelShell()
    const separator = screen.getByRole('separator')
    // Act — far more presses than the 528px shell can honor; the keyboard
    // path is a first-class resize trigger in the library.
    separator.element().focus()
    // The floor is only exercised if the keymap actually receives the keys.
    expect(document.activeElement).toBe(separator.element())
    for (let i = 0; i < 40; i++) await userEvent.keyboard('{ArrowLeft}')
    for (let i = 0; i < 80; i++) await userEvent.keyboard('{ArrowRight}')
    // Assert — 528px group minus the 0px separator: both panels pinned at the
    // floor in both drag directions. toBeCloseTo(…, 0): the library stores
    // the floor as a toFixed(3) percentage, rendering ~264.0px after 1/64px
    // layout quantization.
    const saturated = panelWidths()
    expect(saturated[0]).toBeCloseTo(264, 0)
    expect(saturated[1]).toBeCloseTo(264, 0)
  })

  test('clamps only the dragged panel at the floor while its sibling keeps the remainder of a wider group', async () => {
    // Arrange — 928px is the Group width at a 1200px window. The saturated
    // 528px case above cannot tell "floor clamped" from "even 50/50 split"
    // (264 = 528/2 either way); a wider group can: the dragged panel pins at
    // the floor while the sibling absorbs the rest.
    const screen = await renderPanelShell(928)
    const separator = screen.getByRole('separator')
    // The 50/50 default split itself: a floor-only flood at 528px can never
    // prove it (every end state there is [264, 264] regardless of the start).
    const initial = panelWidths()
    expect(initial[0]).toBeCloseTo(464, 0)
    expect(initial[1]).toBeCloseTo(464, 0)

    // Act — drag the split fully left, overshooting the 464→264 travel.
    separator.element().focus()
    expect(document.activeElement).toBe(separator.element())
    for (let i = 0; i < 60; i++) await userEvent.keyboard('{ArrowLeft}')

    // Assert — center pinned at 264px; the right panel keeps all 664px left over.
    const draggedLeft = panelWidths()
    expect(draggedLeft[0]).toBeCloseTo(264, 0)
    expect(draggedLeft[1]).toBeCloseTo(664, 0)

    // Act + Assert — symmetric the other way: right pins, center keeps 664px.
    for (let i = 0; i < 160; i++) await userEvent.keyboard('{ArrowRight}')
    const draggedRight = panelWidths()
    expect(draggedRight[0]).toBeCloseTo(664, 0)
    expect(draggedRight[1]).toBeCloseTo(264, 0)
  })
})
