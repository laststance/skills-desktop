import { expect, test } from 'vitest'

import { formatSearchResultsHeading } from './formatSearchResultsHeading'

test.each([
  {
    pending: true,
    count: 2,
    expected: 'Showing previous results while searching for "react"',
  },
  { pending: false, count: 1, expected: 'Found 1 skill for "react"' },
  { pending: false, count: 2, expected: 'Found 2 skills for "react"' },
])(
  'labels visible Marketplace results as "$expected"',
  ({ pending, count, expected }) => {
    // Arrange
    const query = 'react'

    // Act
    const heading = formatSearchResultsHeading(pending, query, count)

    // Assert
    expect(heading).toBe(expected)
  },
)
