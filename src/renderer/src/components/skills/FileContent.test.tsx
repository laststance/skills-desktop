import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { renderPlainTextCode } from './FileContent'

describe('renderPlainTextCode', () => {
  it('preserves source order, numbered rows, blank lines, and the selected font size', () => {
    // Arrange
    const lines = ['first line', '', 'third line']

    // Act
    const markup = renderToStaticMarkup(renderPlainTextCode(lines, 16))

    // Assert
    expect(markup).toContain('font-size:16px')
    expect(markup).toMatch(/>1<\/td>.*first line/s)
    expect(markup).toMatch(/>2<\/td>.*> <\/td>/s)
    expect(markup).toMatch(/>3<\/td>.*third line/s)
    expect(markup.indexOf('first line')).toBeLessThan(
      markup.indexOf('third line'),
    )
  })
})
