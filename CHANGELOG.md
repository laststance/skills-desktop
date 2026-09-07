# Changelog

## Unreleased

### Changed

- Adjust the whole window or each section from 0–100% background opacity while keeping text and icons solid. Settings, menus, notifications, and code previews retain opaque backgrounds.
- Existing opacity preferences migrate automatically and keep their previous transparency levels.

### Fixed

- Completed slider adjustments now save before navigating away or closing Settings; Reset saves immediately.
- Rapid slider adjustments keep the latest value even when an earlier save finishes late.
- Failed settings saves now show an error and recover saved values without overwriting newer changes. Both windows display recovery notifications.
- Dimmed and colored text becomes easier to read over translucent backgrounds, while 100% opacity preserves the existing palette.
