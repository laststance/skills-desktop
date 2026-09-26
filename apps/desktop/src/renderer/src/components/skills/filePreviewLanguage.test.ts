import { describe, expect, test } from 'vitest'

import { toFileExtension, toFileName } from '@/shared/types'

import {
  isMarkdownPreview,
  languageForPreview,
  languageFromExtension,
} from './filePreviewLanguage'

describe('filePreviewLanguage', () => {
  test('highlights each common skill file extension with the right Shiki language, case- and dot-insensitively', () => {
    // Arrange — common extensions in mixed case, with and without a leading dot,
    // plus the empty/null/undefined inputs that must yield no language.
    // Act
    const dotTs = languageFromExtension('.ts')
    const dotTsx = languageFromExtension('.tsx')
    const upperDotTs = languageFromExtension('.TS')
    const upperDotTsx = languageFromExtension('.TSX')
    const bareTs = languageFromExtension('ts')
    const dotEnvExample = languageFromExtension('.env.example')
    const dotSvg = languageFromExtension('.svg')
    const empty = languageFromExtension('')
    const nullExtension = languageFromExtension(null)
    const undefinedExtension = languageFromExtension(undefined)

    // Assert
    expect(dotTs).toBe('typescript')
    expect(dotTsx).toBe('tsx')
    expect(upperDotTs).toBe('typescript')
    expect(upperDotTsx).toBe('tsx')
    expect(bareTs).toBe('typescript')
    expect(dotEnvExample).toBe('dotenv')
    expect(dotSvg).toBe('xml')
    expect(empty).toBeUndefined()
    expect(nullExtension).toBeUndefined()
    expect(undefinedExtension).toBeUndefined()
  })

  test('highlights a preview file with the Shiki language that matches its extension', () => {
    // Arrange — known preview files spanning TS, TSX, JS, and JSON.
    // Act
    const tsLanguage = languageForPreview({
      name: toFileName('file.ts'),
      extension: toFileExtension('.ts'),
    })
    const tsxLanguage = languageForPreview({
      name: toFileName('file.tsx'),
      extension: toFileExtension('.tsx'),
    })
    const jsLanguage = languageForPreview({
      name: toFileName('file.js'),
      extension: toFileExtension('.js'),
    })
    const jsonLanguage = languageForPreview({
      name: toFileName('file.json'),
      extension: toFileExtension('.json'),
    })

    // Assert
    expect(tsLanguage).toBe('typescript')
    expect(tsxLanguage).toBe('tsx')
    expect(jsLanguage).toBe('javascript')
    expect(jsonLanguage).toBe('json')
  })

  test('falls back to plain text highlighting for an unknown extension instead of failing', () => {
    // Arrange — a preview file with an extension Shiki does not recognize.
    // Act
    const language = languageForPreview({
      name: toFileName('notes.custom'),
      extension: toFileExtension('.custom'),
    })

    // Assert
    expect(language).toBe('text')
  })

  test('highlights an extensionless Makefile with Make syntax', () => {
    // Arrange — a Makefile has no extension, so the language must come from its name.
    // Act
    const language = languageForPreview({
      name: toFileName('Makefile'),
      extension: toFileExtension(''),
    })

    // Assert
    expect(language).toBe('make')
  })

  test('highlights an extensionless Dockerfile with Dockerfile syntax', () => {
    // Arrange — a Dockerfile has no extension, so the language must come from its name.
    // Act
    const language = languageForPreview({
      name: toFileName('Dockerfile'),
      extension: toFileExtension(''),
    })

    // Assert
    expect(language).toBe('dockerfile')
  })

  test('opens Markdown variants and extensionless READMEs in Reading Mode, but not look-alike files', () => {
    // Arrange — Markdown extensions in several spellings/cases plus an
    // extensionless README (all should be Markdown), alongside non-Markdown
    // look-alikes (.tsx, a ".md.txt" name, and missing/null/undefined
    // extensions that should NOT be Markdown).
    // Act
    const dotMd = isMarkdownPreview({
      name: toFileName('SKILL.md'),
      extension: '.md',
    })
    const dotMarkdown = isMarkdownPreview({
      name: toFileName('README.markdown'),
      extension: '.markdown',
    })
    const dotMdown = isMarkdownPreview({
      name: toFileName('README.mdown'),
      extension: '.mdown',
    })
    const upperDotMd = isMarkdownPreview({
      name: toFileName('SKILL.MD'),
      extension: '.MD',
    })
    const mixedDotMd = isMarkdownPreview({
      name: toFileName('Skill.Md'),
      extension: '.Md',
    })
    const bareMd = isMarkdownPreview({
      name: toFileName('SKILL.md'),
      extension: 'md',
    })
    const extensionlessReadme = isMarkdownPreview({
      name: toFileName('README'),
      extension: '',
    })
    const tsxFile = isMarkdownPreview({
      name: toFileName('component.tsx'),
      extension: '.tsx',
    })
    const mdDotTxtFile = isMarkdownPreview({
      name: toFileName('readme.md.txt'),
      extension: '.txt',
    })
    const extensionlessNotes = isMarkdownPreview({
      name: toFileName('notes'),
      extension: '',
    })
    const nullExtensionNotes = isMarkdownPreview({
      name: toFileName('notes'),
      extension: null,
    })
    const undefinedExtensionNotes = isMarkdownPreview({
      name: toFileName('notes'),
      extension: undefined,
    })

    // Assert
    expect(dotMd).toBe(true)
    expect(dotMarkdown).toBe(true)
    expect(dotMdown).toBe(true)
    expect(upperDotMd).toBe(true)
    expect(mixedDotMd).toBe(true)
    expect(bareMd).toBe(true)
    expect(extensionlessReadme).toBe(true)
    expect(tsxFile).toBe(false)
    expect(mdDotTxtFile).toBe(false)
    expect(extensionlessNotes).toBe(false)
    expect(nullExtensionNotes).toBe(false)
    expect(undefinedExtensionNotes).toBe(false)
  })
})
