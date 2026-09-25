import { pluralize } from '@/renderer/src/utils/pluralize'

/**
 * Formats the Installed visible-skill count shared by the tab badge's accessible
 * name and the {@link InstalledListHeader} rest-state count, so both read alike.
 * @param count - Current `selectFilteredSkills.length` after all Installed filters.
 * @returns Short count label with singular/plural skill copy.
 * @example
 * formatInstalledSearchCount(1) // => "1 skill"
 * formatInstalledSearchCount(24) // => "24 skills"
 */
export function formatInstalledSearchCount(count: number): string {
  return `${count} ${pluralize(count, 'skill')}`
}
