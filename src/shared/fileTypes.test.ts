import { describe, expect, it } from 'vitest'

import { classifyFile, shouldExcludeDir } from './fileTypes'

describe('classifyFile', () => {
  it('returns "text" for markdown', () => {
    expect(classifyFile('SKILL.md')).toBe('text')
  })

  it('returns "text" for python', () => {
    expect(classifyFile('helper.py')).toBe('text')
  })

  it('returns "text" for shell scripts', () => {
    expect(classifyFile('install.sh')).toBe('text')
  })

  it('returns "text" for toml', () => {
    expect(classifyFile('pyproject.toml')).toBe('text')
  })

  it('returns "text" for .env.example (multi-dot extension)', () => {
    expect(classifyFile('.env.example')).toBe('text')
  })

  it('returns "text" for svg (we prefer showing the markup)', () => {
    expect(classifyFile('logo.svg')).toBe('text')
  })

  it('returns "image" for png', () => {
    expect(classifyFile('preview.png')).toBe('image')
  })

  it('returns "image" for webp', () => {
    expect(classifyFile('hero.webp')).toBe('image')
  })

  it('returns "image" regardless of extension case', () => {
    expect(classifyFile('LOGO.PNG')).toBe('image')
  })

  it('returns "binary" for unknown extensions', () => {
    expect(classifyFile('data.bin')).toBe('binary')
  })

  it('returns "binary" for files with no extension', () => {
    expect(classifyFile('Makefile')).toBe('binary')
  })

  it('returns "binary" for executables', () => {
    expect(classifyFile('tool.exe')).toBe('binary')
  })
})

describe('shouldExcludeDir', () => {
  it('excludes node_modules', () => {
    expect(shouldExcludeDir('node_modules')).toBe(true)
  })

  it('excludes .git', () => {
    expect(shouldExcludeDir('.git')).toBe(true)
  })

  it('excludes __pycache__', () => {
    expect(shouldExcludeDir('__pycache__')).toBe(true)
  })

  it('does not exclude src', () => {
    expect(shouldExcludeDir('src')).toBe(false)
  })

  it('does not exclude scripts', () => {
    expect(shouldExcludeDir('scripts')).toBe(false)
  })

  it('is case-sensitive (NODE_MODULES does not match)', () => {
    // POSIX filesystems are case-sensitive; this mirrors that.
    expect(shouldExcludeDir('NODE_MODULES')).toBe(false)
  })
})
