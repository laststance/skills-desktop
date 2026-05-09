# TODOS

Deferred items captured during planning. Pick up when scope and bandwidth allow.

## Orphan filter follow-ups (2026-05-09)

### 1. Source-view orphan visibility

**Context:** The Orphan filter in `SkillTypeFilter` only renders in agent view (`selectedAgentId !== null`). In source view (no agent selected), `selectFilteredSkills` filters to `isSource: true` only — orphans are invisible there because their source dir was deleted.

**Possible directions:**

- Add a separate "Show orphans" toggle/checkbox in source view header
- Render orphans as a dedicated bottom section below sources (visually demarcated)
- Add a synthetic "Orphans" entry in the agent sidebar (treats orphans as a pseudo-agent)

**Why deferred:** Decision needs design input on where orphans live in source view conceptually — they're not sources, but they're also not agent-scoped state.

### 2. Filter persistence across agent switches

**Context:** `selectAgent` reducer in `src/renderer/src/redux/slices/uiSlice.ts:246` resets `skillTypeFilter = 'all'` whenever the user picks a different agent. With the new Orphan option, a user investigating orphans across agents has to re-select Orphan each time.

**Possible directions:**

- Persist `skillTypeFilter` across `selectAgent` (drop the reset)
- Persist Orphan specifically (`'orphan'` survives, `'symlinked'` / `'local'` reset to `'all'`)
- Surface a "Sticky filter" preference toggle in Settings

**Why deferred:** Reset behavior was a deliberate UX choice for the original 3-option filter; changing it now needs a usage-based justification rather than speculation.
