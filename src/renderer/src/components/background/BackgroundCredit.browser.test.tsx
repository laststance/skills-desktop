import { expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import { BackgroundCredit } from './BackgroundCredit'

test.each([
  { photographerUrl: 'not a URL', photoUrl: 'javascript:alert(1)' },
  {
    photographerUrl: 'https://name:secret@unsplash.com/@saved', // gitleaks:allow -- intentional invalid credential-bearing URL fixture
    photoUrl: 'https://example.com/photos/lake',
  },
])(
  'invalid attribution metadata $photographerUrl remains readable without unsafe links',
  async ({ photographerUrl, photoUrl }) => {
    // Arrange / Act
    const screen = await render(
      <BackgroundCredit
        credit={{
          photographerName: 'Saved photographer',
          photographerUrl,
          photoUrl,
        }}
      />,
    )
    try {
      // Assert
      await expect.element(screen.getByText('Saved photographer')).toBeVisible()
      await expect
        .element(screen.getByText('Unsplash', { exact: true }))
        .toBeVisible()
      expect(screen.getByRole('link').elements()).toHaveLength(0)
    } finally {
      await screen.unmount()
    }
  },
)

test('valid credit links retain existing tracking and add the required provider referral parameters', async () => {
  // Arrange / Act
  const screen = await render(
    <BackgroundCredit
      credit={{
        photographerName: 'Saved photographer',
        photographerUrl: 'https://unsplash.com/@saved?tracking=kept',
        photoUrl: 'https://unsplash.com/photos/lake',
      }}
    />,
  )
  try {
    // Assert
    await expect
      .element(screen.getByRole('link', { name: 'Saved photographer' }))
      .toHaveAttribute(
        'href',
        'https://unsplash.com/@saved?tracking=kept&utm_source=skills-desktop&utm_medium=referral',
      )
    await expect
      .element(screen.getByRole('link', { name: 'Unsplash', exact: true }))
      .toHaveAttribute(
        'href',
        'https://unsplash.com/photos/lake?utm_source=skills-desktop&utm_medium=referral',
      )
  } finally {
    await screen.unmount()
  }
})

test('non-middle auxiliary clicks never open an attribution link externally', async () => {
  // Arrange
  const openExternal = vi.fn()
  vi.stubGlobal('electron', { shell: { openExternal } })
  const screen = await render(
    <BackgroundCredit
      credit={{
        photographerName: 'Saved photographer',
        photographerUrl: 'https://unsplash.com/@saved',
        photoUrl: 'https://unsplash.com/photos/lake',
      }}
    />,
  )
  try {
    // Act
    screen
      .getByRole('link', { name: 'Saved photographer' })
      .element()
      .dispatchEvent(
        new MouseEvent('auxclick', {
          button: 2,
          bubbles: true,
          cancelable: true,
        }),
      )
    // Assert
    expect(openExternal).not.toHaveBeenCalled()
  } finally {
    await screen.unmount()
    vi.unstubAllGlobals()
  }
})
