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
    expect(languageFromExtension('.TS')).toBe('typescript')
    expect(languageFromExtension('.TSX')).toBe('tsx')
    expect(languageFromExtension('ts')).toBe('typescript')
    expect(languageFromExtension('.env.example')).toBe('dotenv')
    expect(languageFromExtension('.svg')).toBe('xml')
    expect(languageFromExtension('')).toBeUndefined()
    expect(languageFromExtension(null)).toBeUndefined()
    expect(languageFromExtension(undefined)).toBeUndefined()
  })

  it('maps known file extensions to correct Shiki language IDs for preview', () => {
    expect(languageForPreview({ name: 'file.ts', extension: '.ts' })).toBe(
      'typescript',
    )
    expect(languageForPreview({ name: 'file.tsx', extension: '.tsx' })).toBe(
      'tsx',
    )
    expect(languageForPreview({ name: 'file.js', extension: '.js' })).toBe(
      'javascript',
    )
    expect(languageForPreview({ name: 'file.json', extension: '.json' })).toBe(
      'json',
    )
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
      isMarkdownPreview({ name: 'README.markdown', extension: '.markdown' }),
    ).toBe(true)
    expect(
      isMarkdownPreview({ name: 'README.mdown', extension: '.mdown' }),
    ).toBe(true)
    expect(isMarkdownPreview({ name: 'SKILL.MD', extension: '.MD' })).toBe(true)
    expect(isMarkdownPreview({ name: 'Skill.Md', extension: '.Md' })).toBe(true)
    expect(isMarkdownPreview({ name: 'SKILL.md', extension: 'md' })).toBe(true)
    expect(isMarkdownPreview({ name: 'README', extension: '' })).toBe(true)
    expect(
      isMarkdownPreview({ name: 'component.tsx', extension: '.tsx' }),
    ).toBe(false)
    expect(
      isMarkdownPreview({ name: 'readme.md.txt', extension: '.txt' }),
    ).toBe(false)
    expect(isMarkdownPreview({ name: 'notes', extension: '' })).toBe(false)
    expect(isMarkdownPreview({ name: 'notes', extension: null })).toBe(false)
    expect(isMarkdownPreview({ name: 'notes', extension: undefined })).toBe(
      false,
    )
  })
})
