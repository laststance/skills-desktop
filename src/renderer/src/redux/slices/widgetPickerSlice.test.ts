import { configureStore } from '@reduxjs/toolkit'
import { describe, expect, it } from 'vitest'

// Dynamic import per dashboardSlice.test.ts convention — keeps the slice out
// of the module graph until each test needs it and yields a pristine reducer.
async function createTestStore() {
  const { default: widgetPickerReducer } = await import('./widgetPickerSlice')
  return configureStore({ reducer: { widgetPicker: widgetPickerReducer } })
}

describe('widgetPickerSlice', () => {
  describe('initial state', () => {
    it('starts with no active preview override', async () => {
      // Arrange / Act
      const store = await createTestStore()

      // Assert
      expect(store.getState().widgetPicker.activePreviewType).toBeNull()
    })
  })

  describe('setActivePreviewType', () => {
    it('records the hovered widget so the preview stage can swap', async () => {
      // Arrange
      const { setActivePreviewType } = await import('./widgetPickerSlice')
      const store = await createTestStore()

      // Act
      store.dispatch(setActivePreviewType('agent-heatmap'))

      // Assert
      expect(store.getState().widgetPicker.activePreviewType).toBe(
        'agent-heatmap',
      )
    })

    it('clears the override when dispatched with null', async () => {
      // Arrange
      const { setActivePreviewType } = await import('./widgetPickerSlice')
      const store = await createTestStore()
      store.dispatch(setActivePreviewType('trending'))

      // Act
      store.dispatch(setActivePreviewType(null))

      // Assert
      expect(store.getState().widgetPicker.activePreviewType).toBeNull()
    })
  })

  describe('resetActivePreview', () => {
    it('drops a previous hover so the next open starts on the seed widget', async () => {
      // Arrange
      const { setActivePreviewType, resetActivePreview } =
        await import('./widgetPickerSlice')
      const store = await createTestStore()
      store.dispatch(setActivePreviewType('whats-new'))

      // Act
      store.dispatch(resetActivePreview())

      // Assert
      expect(store.getState().widgetPicker.activePreviewType).toBeNull()
    })
  })
})
