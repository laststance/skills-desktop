import { describe, expect, it } from 'vitest'

import {
  isMarkdownPreview,
  languageForPreview,
  languageFromExtension,
} from './filePreviewLanguage'

describe('filePreviewLanguage', () => {
  it('maps common skill file extensions to Shiki language ids', () => {
    expect(languageFromExtension('.ts')).toBe('typescript')
    expect(languageFromExtension('.tsx')).toBe('tsx')
    expect(languageFromExtension('.env.example')).toBe('dotenv')
    expect(languageFromExtension('.svg')).toBe('xml')
  })

  it('falls back to safe text highlighting for unknown extensions', () => {
    expect(
      languageForPreview({
        name: 'notes.custom',
        extension: '.custom',
      }),
    ).toBe('text')
  })

  it('detects Markdown files for Reading Mode', () => {
    expect(isMarkdownPreview({ name: 'SKILL.md', extension: '.md' })).toBe(true)
    expect(
      isMarkdownPreview({ name: 'component.tsx', extension: '.tsx' }),
    ).toBe(false)
  })
})
