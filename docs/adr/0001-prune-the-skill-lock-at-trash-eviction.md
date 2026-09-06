# Prune the skill lock at trash eviction

Deleting a skill in this app left its record in `~/.agents/.skill-lock.json`, so
the next `skills -g update` reinstalled the skill the user had just deleted. We
prune stale lock entries by shelling out to `skills remove --global`, called from
`evict()` in the trash service — the moment a deletion becomes final.

## Considered options

**Prune when the delete is requested.** Rejected. Deletion is a staged move into
`~/.agents/.trash` with a 15-second undo window, and restoring has to put the
lock record back with its original `skillFolderHash` and `installedAt`. Nothing
can supply those: the app never writes the lock, and `skills add` would
re-download the skill. Eviction is the first point where restore is no longer
possible, so hooking there removes the conflict rather than solving it.

**Write the lock file directly.** Rejected. The lock carries an explicit
`"version"` field, so its shape is expected to change; owning a parser means
tracking the CLI forever. Delegating costs one `npx` spawn on a path that runs
at most a few times a day.

## Consequences

Pruning is best-effort. If the CLI is missing or fails, the skill stays deleted
and the lock keeps the entry. There is no periodic scan to fall back on, so the
recovery surface is explicit: a listener rescans `UNDO_WINDOW_MS +
LOCK_RESCAN_GRACE_MS` after each delete, and the survivor shows up in Symlink
Health with a "Prune lock" CTA. Without that listener the failure would stay
invisible until the user navigated away from the dashboard and back.

The scan drains any queued prune before reading, so it reports the lock as it
settles rather than racing the eviction it is waiting on. Prune children are
also kept out of `skillsCliService.cancel()`: closing the install dialog sends
SIGTERM to every tracked child, and the CLI rewrites `.skill-lock.json` with a
plain `writeFile`, so a kill landing mid-write would truncate the lock into
what parses as an empty one.

Scope is the lock only. Symlinks left pointing at a deleted skill are a broken
slot and belong to Symlink Health. Delegation cannot cover them anyway: for
universal-source agents the CLI's `globalSkillsDir` is `~/.agents/skills` while
this app scans the agent's own directory, so `skills remove` never sees, for
example, `~/.warp/skills/<name>`.

`skills remove` does more than edit the lock: it walks every target agent's
directory and calls `rm(path, { recursive: true, force: true })` on each match,
then removes the canonical path the same way. That is acceptable here only
because of what we prune. A target is always a skill the CLI installed whose
`~/.agents/skills/<name>` is already gone, so every agent-side match is a
symlink into a directory that no longer exists. Nothing with contents is at
risk. Widening the target set past that would change this conclusion.

The CLI exits 0 even when every removal failed: `remove.ts` logs the failures
and falls through to its normal outro without calling `process.exit(1)`. Success
is therefore decided by re-reading the lock afterwards and treating any surviving
target as a failure, not by the child process's exit code.
