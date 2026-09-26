import { describe, expect, test } from 'vitest'

import {
  DEFAULT_BACKGROUND_CROP,
  type BackgroundDisplay,
} from '@/shared/backgrounds'

import { getVisibleBackgroundCredit } from './getVisibleBackgroundCredit'

const unsplashDisplay: BackgroundDisplay = {
  selection: {
    source: { kind: 'builtin', builtinId: 'alpine-lake' },
    displayId: '00000000-0000-4000-8000-000000000001',
    crop: DEFAULT_BACKGROUND_CROP,
    aspect: 'original',
  },
  image: {
    url: 'https://images.unsplash.com/photo-1',
    width: 3840,
    height: 2160,
  },
  crop: DEFAULT_BACKGROUND_CROP,
  title: 'Alpine lake',
  credit: {
    photographerName: 'Kellen Riggin',
    photographerUrl: 'https://unsplash.com/@kellenriggin',
    photoUrl: 'https://unsplash.com/photos/alpine-lake',
  },
}

describe('main-window background credit visibility', () => {
  test('credits the Unsplash photographer while the applied image is on screen', () => {
    // Arrange
    const failedUrl = null

    // Act
    const credit = getVisibleBackgroundCredit(unsplashDisplay, failedUrl)

    // Assert
    expect(credit).toEqual({
      photographerName: 'Kellen Riggin',
      photographerUrl: 'https://unsplash.com/@kellenriggin',
      photoUrl: 'https://unsplash.com/photos/alpine-lake',
    })
  })

  test('hides the credit while the applied image fails to load, leaving the corner to Retry', () => {
    // Arrange
    const failedUrl = 'https://images.unsplash.com/photo-1'

    // Act
    const credit = getVisibleBackgroundCredit(unsplashDisplay, failedUrl)

    // Assert
    expect(credit).toBeNull()
  })

  test('keeps crediting the current image when only a previously applied image failed', () => {
    // Arrange
    const failedUrl = 'https://images.unsplash.com/photo-previous'

    // Act
    const credit = getVisibleBackgroundCredit(unsplashDisplay, failedUrl)

    // Assert
    expect(credit).toEqual({
      photographerName: 'Kellen Riggin',
      photographerUrl: 'https://unsplash.com/@kellenriggin',
      photoUrl: 'https://unsplash.com/photos/alpine-lake',
    })
  })

  test('shows no credit for an uploaded image, which carries no attribution', () => {
    // Arrange
    const uploadDisplay: BackgroundDisplay = {
      ...unsplashDisplay,
      selection: {
        ...unsplashDisplay.selection,
        source: {
          kind: 'upload',
          uploadId: '00000000-0000-4000-8000-000000000002',
        },
      },
      image: {
        url: 'data:image/webp;base64,UklGRg==',
        width: 3840,
        height: 2160,
      },
      title: 'My photo',
      credit: null,
    }

    // Act
    const credit = getVisibleBackgroundCredit(uploadDisplay, null)

    // Assert
    expect(credit).toBeNull()
  })

  test('shows no credit before any background image is applied', () => {
    // Arrange
    const display = null

    // Act
    const credit = getVisibleBackgroundCredit(display, null)

    // Assert
    expect(credit).toBeNull()
  })
})
