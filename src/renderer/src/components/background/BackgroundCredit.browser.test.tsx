import { expect, test } from 'vitest'
import { render } from 'vitest-browser-react'

import '@/renderer/src/styles/globals.css'

import { BackgroundCredit } from './BackgroundCredit'

test('invalid attribution metadata remains readable without crashing the gallery or exposing unsafe links', async () => {
  // Arrange / Act
  const screen = await render(
    <BackgroundCredit
      credit={{
        photographerName: 'Saved photographer',
        photographerUrl: 'not a URL',
        photoUrl: 'javascript:alert(1)',
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
})

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
