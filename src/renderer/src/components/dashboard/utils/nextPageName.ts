import type {
  DashboardPage,
  DashboardPageName,
} from '@/renderer/src/components/dashboard/types'

/**
 * Compute a collision-free default page name of the form `Page N`. Exists
 * because both `addPage` and `addWidget`'s overflow path mint default names,
 * and a naive `Page <count+1>` can repeat a name after a middle page is
 * deleted (ids stay unique, but two tabs would then read identically). Starts
 * from the historical `Page <count+1>` and bumps the suffix until it is free.
 *
 * @param pages - the dashboard's current pages
 * @returns a `Page N` name guaranteed not to equal any `pages[i].name`
 * @example
 * // 4 preset pages (Overview/Discovery/Actions/Personal), none named "Page N"
 * nextPageName(presetPages) // => "Page 5"
 * @example
 * // Overview, Discovery, Actions, Personal, "Page 6"  ("Page 5" was deleted)
 * nextPageName(pages) // => "Page 7"  (skips the still-present "Page 6")
 */
export function nextPageName(
  pages: readonly DashboardPage[],
): DashboardPageName {
  const existingNames = new Set(pages.map((page) => page.name))
  // Preserve the familiar "next number" starting point, then step past any
  // suffix that a surviving page already occupies so the result is unique.
  let suffix = pages.length + 1
  while (existingNames.has(`Page ${suffix}`)) {
    suffix += 1
  }
  return `Page ${suffix}`
}
