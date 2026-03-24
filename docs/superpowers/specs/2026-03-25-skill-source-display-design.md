# Skill Source Display

Show where each skill was installed from (repo URL) in the Info tab and skill cards.

## Data Source

`~/.agents/.skill-lock.json` (global lock file managed by Skills CLI) contains:

```json
{
  "skills": {
    "frontend-design": {
      "source": "pbakaus/impeccable",
      "sourceType": "github",
      "sourceUrl": "https://github.com/pbakaus/impeccable.git"
    }
  }
}
```

Key fields: `source` (display text), `sourceUrl` (link target), `sourceType` (github/well-known/local).

## Data Flow

```
~/.agents/.skill-lock.json
  → skillScanner reads at scan time
  → attaches source/sourceUrl to each Skill
  → IPC → Redux store
  → renderer displays
```

## Type Changes

`src/shared/types.ts` — add to `Skill` interface:

```ts
source?: string      // e.g. "pbakaus/impeccable"
sourceUrl?: string   // e.g. "https://github.com/pbakaus/impeccable.git"
```

Both optional: local skills or skills not in lock file will have `undefined`.

## UI: Info Tab (SkillDetail.tsx)

Between the description and the Valid/Broken counts:

```
adapt
What to adapt for (mobile, tablet, ...

Info    Files
─────────────────────
pbakaus/impeccable ↗      ← external link
Valid: 2  Broken: 0
```

- `source` as link text, `sourceUrl` (minus `.git`) as href
- `shell.openExternal()` via IPC for external browser open
- Local skills: show `Local` text, no link
- No source data: show nothing
- Style: `text-xs text-muted-foreground`

## UI: Skill Card (SkillItem.tsx)

Between description and symlink badge:

```
┌────────────────────────────┐
│ adapt  ＋ Add              │
│ What to adapt for ...      │
│ pbakaus/impeccable ↗       │
│ ✓ 2                        │
└────────────────────────────┘
```

Same display rules as Info tab.

## External Link Handling

Use Electron `shell.openExternal()` via existing IPC pattern.
Strip `.git` suffix from `sourceUrl` before opening.

## Files to Modify

| File                                                 | Change                                     |
| ---------------------------------------------------- | ------------------------------------------ |
| `src/shared/types.ts`                                | Add `source?`, `sourceUrl?` to `Skill`     |
| `src/main/services/skillScanner.ts`                  | Read `.skill-lock.json`, merge source info |
| `src/renderer/src/components/skills/SkillDetail.tsx` | Source link in Info tab                    |
| `src/renderer/src/components/skills/SkillItem.tsx`   | Source link in card                        |
| `src/preload/index.ts` + `src/main/ipc/`             | `openExternal` IPC if not existing         |

## Edge Cases

- Skill not in lock file → no source displayed
- Lock file missing/corrupt → graceful fallback, no source for any skill
- `sourceUrl` without `.git` suffix → use as-is
- `sourceType` is `local` → show "Local" text
