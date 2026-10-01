import { describe, expect, test } from 'vitest'

import { toHttpUrl, tryHttpUrl } from './types'

describe('toHttpUrl', () => {
  test('brands a valid https URL unchanged', () => {
    // Arrange
    const value = 'https://github.com/vercel-labs/skills.git'

    // Act
    const url = toHttpUrl(value)

    // Assert
    expect(url).toBe('https://github.com/vercel-labs/skills.git')
  })

  test('brands a valid http URL unchanged', () => {
    // Arrange — plain http is legal: localhost preview servers use it.
    const value = 'http://localhost:3000/skill'

    // Act
    const url = toHttpUrl(value)

    // Assert
    expect(url).toBe('http://localhost:3000/skill')
  })

  test.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    '//github.com/vercel-labs/skills',
    'not a url',
    '',
  ])('throws instead of branding %s', (value) => {
    // Assert — the brand must never sit on a non-http(s) string: a
    // `javascript:` URL behind `HttpUrl` would defeat the anchor's downstream
    // gates by pretending to be safe.
    expect(() => toHttpUrl(value)).toThrow(TypeError)
  })

  test('accepts an uppercase scheme (new URL normalizes to lowercase)', () => {
    // Act
    const url = toHttpUrl('HTTPS://example.com/x')

    // Assert — still branded; the string is preserved, the check saw https:.
    expect(url).toBe('HTTPS://example.com/x')
  })
})

describe('tryHttpUrl', () => {
  test('returns the branded URL for a valid https string', () => {
    // Act
    const url = tryHttpUrl('https://skills.sh/task')

    // Assert
    expect(url).toBe('https://skills.sh/task')
  })

  test.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script></script>',
    'mailto:a@b.c',
    '//protocol-relative.example',
    'not a url',
    '',
  ])('returns undefined instead of throwing for %s', (value) => {
    // Assert — untrusted-input boundaries degrade, they must not throw mid-scan.
    expect(tryHttpUrl(value)).toBeUndefined()
  })
})
