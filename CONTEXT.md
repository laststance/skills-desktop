# Skills Desktop

Desktop app for viewing and managing which Skills each AI agent has available.

The core entities the app displays — Skill, Agent, Symlink, Universal — are
defined in the Domain Concepts table in `CLAUDE.md`. This glossary covers the
vocabulary those entities are not enough to express.

## Language

**Drift**:
Disagreement between what a skill actually is on disk and what some record says
it is. Health is the app's view of drift; a stale lock entry and a broken slot
are two kinds of it.
_Avoid_: inconsistency, desync, corruption

### Skill lock

**Skill lock**:
The record the skills CLI keeps of every skill it installed, and the sole input
to an update run. Distinct from the skills themselves: a skill can exist without
a lock record, and a lock record without a skill.
_Avoid_: lock file, manifest, registry

**Stale lock entry**:
A lock record whose skill no longer exists and cannot be brought back. An update
run reinstalls it, so a stale entry is how a deleted skill comes back. A skill
waiting in the trash does not qualify: it is still restorable, and its record is
still doing its job.
_Avoid_: orphan, ghost, dangling entry

**Untracked skill**:
A skill that exists but has no lock record, because something other than the
skills CLI put it there. Out of scope for the app: it is not the app's to
adopt.
_Avoid_: local skill, manual skill, unmanaged skill

**Prune**:
Removing stale lock entries so the lock and the skills agree. One-directional
by definition: pruning never creates a lock record. Concerns the lock only —
leftover symlinks are a broken slot, and cleaning those is Symlink Health's job.
_Avoid_: sync, reconcile, clean

> **`sync` is reserved, twice over.** The skills CLI owns `skills sync`
> (discovering skills inside `node_modules`), and this app's Quick Actions
> already labels a tile "Sync" (previewing conflicts). Neither means lock
> maintenance, so lock work never borrows the word.
