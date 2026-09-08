import type { BackgroundCropAspect } from '@/shared/backgrounds'

/** Appearance renders these labels; the hidden-image hint uses the same source to focus the active range. */
export const WINDOW_OPACITY_LABELS = {
  windowBackgroundOpacityPercent: 'Background opacity',
  leftSectionOpacityPercent: 'Left opacity',
  centerSectionOpacityPercent: 'Center opacity',
  rightSectionOpacityPercent: 'Right opacity',
}

/** Desktop gallery geometry and crop interaction limits from DESIGN.md. */
export const GALLERY_THREE_COLUMN_MIN_WIDTH_PX = 520
export const GALLERY_ROW_HEIGHT_PX = 180
export const GALLERY_OVERSCAN_ROWS = 2
export const CROP_MIN_ZOOM = 1
export const CROP_DEFAULT_MAX_ZOOM = 3
export const CROP_ZOOM_STEP = 0.05
export const CROP_KEYBOARD_STEP_PX = 8
export const CROP_FIXED_ASPECTS = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
} satisfies Record<Exclude<BackgroundCropAspect, 'original'>, number>
/** Gives the provider's bounded server request time to finish while keeping unreachable RPC calls recoverable. */
export const UNSPLASH_SEARCH_TIMEOUT_MS = 15_000
