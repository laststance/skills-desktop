import { describe, expect, it } from 'vitest'

import { classifyFile, shouldExcludeDir } from './fileTypes'

describe('classifyFile', () => {
  it('renders a markdown file as readable text', () => {
    // Arrange
    const fileName = 'SKILL.md'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders a python file as readable text', () => {
    // Arrange
    const fileName = 'helper.py'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders a shell script as readable text', () => {
    // Arrange
    const fileName = 'install.sh'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders a toml file as readable text', () => {
    // Arrange
    const fileName = 'pyproject.toml'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders a multi-dot .env.example file as readable text', () => {
    // Arrange
    const fileName = '.env.example'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders an svg as text so the user sees the markup', () => {
    // Arrange
    const fileName = 'logo.svg'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('text')
  })

  it('renders a png as an image preview', () => {
    // Arrange
    const fileName = 'preview.png'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('image')
  })

  it('renders a webp as an image preview', () => {
    // Arrange
    const fileName = 'hero.webp'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('image')
  })

  it('renders an uppercase image extension as an image preview', () => {
    // Arrange
    const fileName = 'LOGO.PNG'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('image')
  })

  it('treats an unknown extension as a non-previewable binary', () => {
    // Arrange
    const fileName = 'data.bin'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('binary')
  })

  it('treats an extensionless file as a non-previewable binary', () => {
    // Arrange
    const fileName = 'Makefile'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('binary')
  })

  it('treats an executable as a non-previewable binary', () => {
    // Arrange
    const fileName = 'tool.exe'
    // Act
    const kind = classifyFile(fileName)
    // Assert
    expect(kind).toBe('binary')
  })
})

describe('shouldExcludeDir', () => {
  it('skips node_modules when walking a skill tree', () => {
    // Arrange
    const dirName = 'node_modules'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(true)
  })

  it('skips .git when walking a skill tree', () => {
    // Arrange
    const dirName = '.git'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(true)
  })

  it('skips __pycache__ when walking a skill tree', () => {
    // Arrange
    const dirName = '__pycache__'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(true)
  })

  it('walks into a src directory', () => {
    // Arrange
    const dirName = 'src'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(false)
  })

  it('walks into a scripts directory', () => {
    // Arrange
    const dirName = 'scripts'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(false)
  })

  it('walks into an uppercase NODE_MODULES directory because matching is case-sensitive', () => {
    // POSIX filesystems are case-sensitive; this mirrors that.
    // Arrange
    const dirName = 'NODE_MODULES'
    // Act
    const excluded = shouldExcludeDir(dirName)
    // Assert
    expect(excluded).toBe(false)
  })
})
