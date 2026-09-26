import type { PayloadAction } from '@reduxjs/toolkit'
import { createSlice } from '@reduxjs/toolkit'

import type { WidgetType } from '@/renderer/src/components/dashboard/types'
import type { RootState } from '@/renderer/src/redux/store'

/**
 * Picker-only ephemeral state. Lives in Redux per the renderer convention that
 * modal/dialog state is slice-owned, but is intentionally absent from the
 * persistence list — a hover-driven preview type shouldn't survive an app
 * restart. Read by `WidgetPicker` only.
 */
interface WidgetPickerState {
  /**
   * Widget the live-preview stage currently shows, or `null` to fall through
   * to the seed widget. Updated on row hover / keyboard focus, cleared on
   * picker close.
   */
  activePreviewType: WidgetType | null
}

const initialState: WidgetPickerState = {
  activePreviewType: null,
}

const widgetPickerSlice = createSlice({
  name: 'widgetPicker',
  initialState,
  reducers: {
    /**
     * Set the previewed widget. Called from `WidgetPicker` row onMouseEnter /
     * onFocus. `null` releases the override so the seed widget takes over.
     */
    setActivePreviewType: (state, action: PayloadAction<WidgetType | null>) => {
      state.activePreviewType = action.payload
    },
    /**
     * Clear the override on picker close — next open starts on the seed
     * widget instead of the last-hovered one. Dispatched from `WidgetPicker`
     * on the open→closed transition.
     */
    resetActivePreview: (state) => {
      state.activePreviewType = null
    },
  },
})

export const { setActivePreviewType, resetActivePreview } =
  widgetPickerSlice.actions
export default widgetPickerSlice.reducer

/**
 * Currently-previewed widget type, or `null` when no row is being hovered /
 * focused (caller falls through to the seed widget).
 * @example
 * const activePreviewType = useAppSelector(selectActivePreviewType)
 * // 'agent-heatmap' | null
 */
export const selectActivePreviewType = (state: RootState): WidgetType | null =>
  state.widgetPicker.activePreviewType
