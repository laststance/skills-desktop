import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  parseFormattedCount,
  parseLeaderboardHtml,
  fetchLeaderboard,
} from './leaderboardService'

describe('parseFormattedCount', () => {
  it('parses plain numbers', () => {
    expect(parseFormattedCount('927')).toBe(927)
    expect(parseFormattedCount('0')).toBe(0)
    expect(parseFormattedCount('42')).toBe(42)
  })

  it('parses K suffix', () => {
    expect(parseFormattedCount('731.2K')).toBe(731200)
    expect(parseFormattedCount('20.0K')).toBe(20000)
    expect(parseFormattedCount('1K')).toBe(1000)
    expect(parseFormattedCount('12.3K')).toBe(12300)
  })

  it('parses M suffix', () => {
    expect(parseFormattedCount('1.5M')).toBe(1500000)
    expect(parseFormattedCount('2M')).toBe(2000000)
  })

  it('parses B suffix', () => {
    expect(parseFormattedCount('1.2B')).toBe(1200000000)
  })

  it('handles case insensitive suffixes', () => {
    expect(parseFormattedCount('731.2k')).toBe(731200)
    expect(parseFormattedCount('1.5m')).toBe(1500000)
  })

  it('handles whitespace', () => {
    expect(parseFormattedCount('  731.2K  ')).toBe(731200)
    expect(parseFormattedCount(' 927 ')).toBe(927)
  })

  it('handles commas in numbers', () => {
    expect(parseFormattedCount('1,234')).toBe(1234)
  })

  it('returns 0 for invalid input', () => {
    expect(parseFormattedCount('')).toBe(0)
    expect(parseFormattedCount('abc')).toBe(0)
    expect(parseFormattedCount('---')).toBe(0)
  })
})

describe('parseLeaderboardHtml', () => {
  it('parses skill rows from anchor tags', () => {
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
    const results = parseLeaderboardHtml(html)

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

  it('parses hot page with delta counts', () => {
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
    const results = parseLeaderboardHtml(html)

    expect(results).toHaveLength(1)
    // +294 is excluded by the negative lookbehind (?<![+-])
    // So only 927 matches as the install count
    expect(results[0].installCount).toBe(927)
  })

  it('returns empty array when stability signature is missing', () => {
    const html = '<html><body><p>This page has no leaderboard</p></body></html>'
    const results = parseLeaderboardHtml(html)
    expect(results).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseLeaderboardHtml('')).toEqual([])
  })

  it('limits results to 50', () => {
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

    const results = parseLeaderboardHtml(html)
    expect(results).toHaveLength(50)
  })

  it('skips anchors without h3', () => {
    const html = `
      <a href="/owner/repo/good-skill">
        <h3>good-skill</h3>
        <span>100</span>
      </a>
      <a href="/owner/repo/bad-link">
        <span>No heading here</span>
      </a>
    `
    const results = parseLeaderboardHtml(html)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('good-skill')
  })

  it('handles table-based layout (all-time page)', () => {
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
    // The anchor is inside a td, which is fine for our regex
    const results = parseLeaderboardHtml(html)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('find-skills')
  })

  it('assigns sequential ranks', () => {
    const html = `
      <a href="/a/b/skill-one"><h3>skill-one</h3><span>100</span></a>
      <a href="/c/d/skill-two"><h3>skill-two</h3><span>50</span></a>
      <a href="/e/f/skill-three"><h3>skill-three</h3><span>25</span></a>
    `
    const results = parseLeaderboardHtml(html)
    expect(results.map((r) => r.rank)).toEqual([1, 2, 3])
  })
})

describe('fetchLeaderboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and parses leaderboard HTML', async () => {
    const mockHtml = `
      <a href="/vercel-labs/skills/find-skills">
        <h3>find-skills</h3>
        <span>731.2K</span>
      </a>
    `
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(mockHtml, { status: 200 }),
    )

    const results = await fetchLeaderboard('all-time')
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

  it('fetches correct URL for each filter', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')

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

  it('throws on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404, statusText: 'Not Found' }),
    )

    await expect(fetchLeaderboard('all-time')).rejects.toThrow(
      'Failed to fetch leaderboard: 404 Not Found',
    )
  })
})
