# ADR 0002: Installed Tree uses a public hierarchy model and shared bounded discovery

Status: Accepted (2026-10-24)

## Context

Installed skill cards remain useful for status and metadata, while developers also need to browse nested skill files. Tree must reuse the existing Inspector and reviewed bulk actions, preserve filtering and keyboard behavior, and avoid eager scans of large collections.

## Decision

Use `@pierre/trees` 1.0.0-beta.6 public `useFileTree` / `useFileTreeSelector` APIs as the hierarchy and focus model. Render app-owned React rows with the existing variable-height `react-window` list. No vendor DOM, shadow-root patches, private controller calls, drag/drop or rename handlers are mounted. The compiled Chromium fixture verifies StrictMode lifecycle, variable heights, visible keyboard focus and one-thousand-root virtualization before adoption.

Share discovery through one renderer-local `SkillFilesProvider` above the Tree boundary and Inspector. Publish immutable snapshots because React Compiler cannot observe mutable Map changes through an otherwise stable object. Keep file navigation transient in `skillsSlice`; a Tree file opens Files without changing the user's saved default tab. Persist only List/Tree mode in the existing per-field renderer preference transaction.

Use typed detailed listing/read outcomes, sender-scoped cancellation and bounded process-wide scheduling. Preserve legacy IPC contracts. Model IDs encode native relative path segments and map explicitly to discovered files. Bulk operations retain reviewed skill identities and never accept child IDs.

## Consequences

The app owns its visual and keyboard contract while Pierre owns hierarchy. The pinned beta remains an isolated dependency and can be replaced behind this adapter. Limits can produce an explicitly partial result; retained subsets may differ when filesystem enumeration order changes. Filesystem replacement races are mitigated, not described as an atomic sandbox. Search indexing and repository grouping remain separate follow-up work.
