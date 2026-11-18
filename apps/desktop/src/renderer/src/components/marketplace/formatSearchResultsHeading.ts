/**
 * Labels visible Marketplace results while the next query is pending or after it completes.
 * @example formatSearchResultsHeading(false, 'react', 1) // 'Found 1 skill for "react"'
 */
export function formatSearchResultsHeading(
  isSearching: boolean,
  query: string,
  count: number,
): string {
  // Visible rows still belong to the previous query during a refresh.
  if (isSearching)
    return `Showing previous results while searching for "${query}"`
  return `Found ${count} ${count === 1 ? 'skill' : 'skills'} for "${query}"`
}
