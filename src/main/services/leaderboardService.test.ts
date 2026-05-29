import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  parseFormattedCount,
  parseLeaderboardHtml,
  fetchLeaderboard,
} from './leaderboardService'

describe('parseFormattedCount', () => {
  it('reads a plain integer install count unchanged', () => {
    // Act & Assert
    expect(parseFormattedCount('927')).toBe(927)
    expect(parseFormattedCount('0')).toBe(0)
    expect(parseFormattedCount('42')).toBe(42)
  })

  it('expands a K suffix to thousands (731.2K -> 731200)', () => {
    // Act & Assert
    expect(parseFormattedCount('731.2K')).toBe(731200)
    expect(parseFormattedCount('20.0K')).toBe(20000)
    expect(parseFormattedCount('1K')).toBe(1000)
    expect(parseFormattedCount('12.3K')).toBe(12300)
  })

  it('expands an M suffix to millions (1.5M -> 1500000)', () => {
    // Act & Assert
    expect(parseFormattedCount('1.5M')).toBe(1500000)
    expect(parseFormattedCount('2M')).toBe(2000000)
  })

  it('expands a B suffix to billions (1.2B -> 1200000000)', () => {
    // Act & Assert
    expect(parseFormattedCount('1.2B')).toBe(1200000000)
  })

  it('expands lowercase k and m suffixes the same as uppercase', () => {
    // Act & Assert
    expect(parseFormattedCount('731.2k')).toBe(731200)
    expect(parseFormattedCount('1.5m')).toBe(1500000)
  })

  it('ignores surrounding whitespace around the count', () => {
    // Act & Assert
    expect(parseFormattedCount('  731.2K  ')).toBe(731200)
    expect(parseFormattedCount(' 927 ')).toBe(927)
  })

  it('drops thousands separators from a comma-grouped number', () => {
    // Act & Assert
    expect(parseFormattedCount('1,234')).toBe(1234)
  })

  it('counts unparseable input as zero', () => {
    // Act & Assert
    expect(parseFormattedCount('')).toBe(0)
    expect(parseFormattedCount('abc')).toBe(0)
    expect(parseFormattedCount('---')).toBe(0)
  })
})

describe('parseLeaderboardHtml', () => {
  it('extracts each skill row (rank, name, repo, url, install count) from anchor tags', () => {
    // Arrange
    const html = `
      <div>
        <a href="/vercel-labs/skills/find-skills">
          <div><span>#</span><span>1</span></div>
          <div><h3>find-skills</h3></div>
          <div><span>vercel-labs/skills</span></div>
          <div><span>731.2K</span></div>
        </a>
        <a href="/owner/repo/my-skill">
          <div><span>#</span><span>2</span></div>
          <div><h3>my-skill</h3></div>
          <div><span>owner/repo</span></div>
          <div><span>42</span></div>
        </a>
      </div>
    `

    // Act
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      rank: 1,
      name: 'find-skills',
      repo: 'vercel-labs/skills',
      url: 'https://skills.sh/vercel-labs/skills/find-skills',
      installCount: 731200,
    })
    expect(results[1]).toEqual({
      rank: 2,
      name: 'my-skill',
      repo: 'owner/repo',
      url: 'https://skills.sh/owner/repo/my-skill',
      installCount: 42,
    })
  })

  it('reads the absolute count and ignores the delta on a hot-page row', () => {
    // Arrange
    const html = `
      <a href="/vercel-labs/skills/find-skills">
        <div>
          <span>#</span><span>1</span>
        </div>
        <div><h3>find-skills</h3></div>
        <div><span>vercel-labs/skills</span></div>
        <div><span>927</span><span>+294</span></div>
      </a>
    `

    // Act
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results).toHaveLength(1)
    // +294 is excluded by the negative lookbehind (?<![+-])
    // So only 927 matches as the install count
    expect(results[0].installCount).toBe(927)
  })

  it('throws when the page lacks the leaderboard stability signature', () => {
    // Arrange
    const html = '<html><body><p>This page has no leaderboard</p></body></html>'

    // Act & Assert
    expect(() => parseLeaderboardHtml(html)).toThrow(
      'Leaderboard HTML structure mismatch',
    )
  })

  it('throws when handed an empty HTML string', () => {
    // Act & Assert
    expect(() => parseLeaderboardHtml('')).toThrow(
      'Leaderboard HTML structure mismatch',
    )
  })

  it('caps the leaderboard at 50 entries even when more rows are present', () => {
    // Arrange
    // Generate 60 skill anchors
    const anchors = Array.from(
      { length: 60 },
      (_, i) => `
      <a href="/owner/repo/skill-${i}">
        <h3>skill-${i}</h3>
        <span>${i * 100}</span>
      </a>
    `,
    ).join('\n')
    const html = `<div>${anchors}</div>`

    // Act
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results).toHaveLength(50)
  })

  it('discards anchors that have no h3 heading', () => {
    // Arrange
    const html = `
      <a href="/owner/repo/good-skill">
        <h3>good-skill</h3>
        <span>100</span>
      </a>
      <a href="/owner/repo/bad-link">
        <span>No heading here</span>
      </a>
    `

    // Act
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('good-skill')
  })

  it('still parses rows when the all-time page wraps anchors in a table', () => {
    // Arrange
    const html = `
      <table>
        <tr>
          <td>
            <a href="/vercel-labs/skills/find-skills">
              <h3>find-skills</h3>
            </a>
          </td>
          <td>731.2K</td>
        </tr>
      </table>
    `

    // Act
    // The anchor is inside a td, which is fine for our regex
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('find-skills')
  })

  it('numbers rows sequentially from 1 regardless of order', () => {
    // Arrange
    const html = `
      <a href="/a/b/skill-one"><h3>skill-one</h3><span>100</span></a>
      <a href="/c/d/skill-two"><h3>skill-two</h3><span>50</span></a>
      <a href="/e/f/skill-three"><h3>skill-three</h3><span>25</span></a>
    `

    // Act
    const results = parseLeaderboardHtml(html)

    // Assert
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3])
  })
})

describe('fetchLeaderboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches the leaderboard page and returns its parsed rows with the app User-Agent', async () => {
    // Arrange
    const mockHtml = `
      <a href="/vercel-labs/skills/find-skills">
        <h3>find-skills</h3>
        <span>731.2K</span>
      </a>
    `
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(mockHtml, { status: 200 }),
    )

    // Act
    const results = await fetchLeaderboard('all-time')

    // Assert
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('find-skills')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://skills.sh/',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'skills-desktop/1.0',
        }),
      }),
    )
  })

  it('requests the matching skills.sh URL for the all-time, trending, and hot filters', async () => {
    // Arrange
    const spy = vi.spyOn(globalThis, 'fetch')

    // Act & Assert
    spy.mockResolvedValueOnce(new Response('<h3>x</h3>', { status: 200 }))
    await fetchLeaderboard('all-time')
    expect(spy).toHaveBeenLastCalledWith(
      'https://skills.sh/',
      expect.anything(),
    )

    spy.mockResolvedValueOnce(new Response('<h3>x</h3>', { status: 200 }))
    await fetchLeaderboard('trending')
    expect(spy).toHaveBeenLastCalledWith(
      'https://skills.sh/trending',
      expect.anything(),
    )

    spy.mockResolvedValueOnce(new Response('<h3>x</h3>', { status: 200 }))
    await fetchLeaderboard('hot')
    expect(spy).toHaveBeenLastCalledWith(
      'https://skills.sh/hot',
      expect.anything(),
    )
  })

  it('surfaces a descriptive error when the leaderboard request fails', async () => {
    // Arrange
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )

    // Act & Assert
    await expect(fetchLeaderboard('all-time')).rejects.toThrow(
      'Failed to fetch leaderboard: 404 Not Found',
    )
  })
})
