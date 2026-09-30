# Changelog

## Unreleased

### Added

- Skills Desktop is now MIT licensed, with contributing and code-of-conduct guides and an architecture overview for new contributors.
- Report security issues privately through GitHub's vulnerability reporting, linked from the security policy.

### Changed

- The Markdown file preview now remembers your Code/Reading mode across file switches and app restarts instead of always reopening in Code mode.
- Adjust the whole window or each section from 0–100% background opacity while keeping text and icons solid. Settings, menus, notifications, and code previews retain opaque backgrounds.
- Existing opacity preferences migrate automatically and keep their previous transparency levels.
- Select skills in the Installed list without entering a Select mode. Every row has a checkbox, and a list header above the list selects all visible rows, shows how many are selected, and holds Delete or Unlink, Copy to…, and Clear.
- ⌘A selects every visible row the current action can use and Esc clears the selection whenever the Installed list is open. ⌘-click toggles a row, ⇧-click selects a range, and a plain click still opens the Inspector.
- Clicking a card hands the keyboard back to the list, so ⌘A and Esc work right after searching. ⌘A inside the search box now selects the search text.
- The list header says when selected rows are hidden by the search or cannot take the current action, and actions leave those rows alone.
- After a Delete or Unlink from the list header, rows that failed stay selected and flash, ready to retry.
- List header tooltips show the keyboard shortcut for their action.
- The Name sort toggle shows A→Z and Z→A icons, and the "Toolbar text" option for the Installed search count is now called "List header".
- Settings descriptions, help, status and error text are now 14px instead of 12px, the same size as row labels, so Settings is easier to read. Nested labels like "Image layout" stay the same size and are dimmed, and inline links such as "Adjust opacity" match the sentence around them.

### Fixed

- Switching files in Markdown Reading Mode now starts at the top of the document, including when two files share the same name in different folders.
- Switching files in Markdown Code Mode now also starts at the top instead of clamping the previous file's scroll position into the shorter document.
- If the Markdown preview-mode preference cannot be saved (for example, storage is full or unavailable), a notice now explains that the choice applies for the current session but resets when the app closes — instead of silently reverting later.
- The Markdown Code/Reading mode now stays in sync across windows and between same-window preview surfaces, and removing the stored preference resets to Code mode on the next read.
- Choosing a Markdown mode while viewing a non-Markdown file no longer reverts to the saved value when storage is unavailable — the session remembers the latest choice.
- The app now always uses the macOS system font (SF Pro). Before, it switched to Inter on Macs that had Inter installed, so text looked different from one machine to the next.
- Completed slider adjustments now save before navigating away or closing Settings; Reset saves immediately.
- Rapid slider adjustments keep the latest value even when an earlier save finishes late.
- Failed settings saves now show an error and recover saved values without overwriting newer changes. Both windows display recovery notifications.
- Dimmed and colored text becomes easier to read over translucent backgrounds, while 100% opacity preserves the existing palette.
- Long source repository names stay on one line in narrow windows instead of pushing a card into the next one.
- While an Installed-list Delete, Unlink, or Copy runs, the Dashboard's symlink cleanup stays disabled and a card's Unlink button does nothing, so two actions never work on the same links at once.
- Skills removed outside the app no longer stay selected after the list refreshes.
- Keyboard shortcut hints and other monospace text render in Menlo instead of falling back to Courier on macOS.
- Settings descriptions no longer lose their dimmed color when a component combines its default text styles with the Settings text size.
