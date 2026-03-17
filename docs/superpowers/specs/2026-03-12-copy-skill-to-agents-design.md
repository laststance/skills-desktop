# Copy Skill to Agents

Copy a skill from one agent to another via right-click context menu in Agent View.

## Behavior

| Source Skill Type | Copy Action                                       |
| ----------------- | ------------------------------------------------- |
| Symlink           | `fs.readlink` → `fs.symlink` (same source target) |
| Local folder      | `fs.cp` recursive (independent copy)              |

## IPC Contract

### Channel: `skills:copyToAgents`

```ts
// Input
interface CopyToAgentsOptions {
  skillName: string
  linkPath: string // path in source agent
  targetAgentIds: AgentId[]
}

// Output
interface CopyToAgentsResult {
  success: boolean
  copied: number
  failures: Array<{ agentId: AgentId; error: string }>
}
```

### Backend Logic

1. `fs.lstat(linkPath)` to detect type
2. If symlink: `fs.readlink(linkPath)` → get real target → `fs.symlink(target, destPath)` per agent
3. If directory: `fs.cp(linkPath, destPath, { recursive: true })` per agent
4. Pre-check: `fs.lstat(destPath)` → if exists, skip with "Already exists" failure
5. Ensure agent dir: `fs.mkdir(agentPath, { recursive: true })`

## UI Components

### SkillItem.tsx — Right-click Context Menu

- Agent View only (`selectedAgentId` set, not `'universal'`)
- Radix DropdownMenu, same pattern as AgentItem.tsx
- Menu item: "Copy to..." → `dispatch(setSkillToCopy(skill))`

### CopyToAgentsModal.tsx (new)

- Same structure as AddSymlinkModal
- Agent list with checkboxes
- Source agent: hidden
- Agents with existing skill: disabled + "already exists"
- [Cancel] [Copy] buttons
- On success: refresh skills, close modal, show success toast
- On partial failure: close modal, show warning toast with per-agent error details

### Redux (skillsSlice)

```ts
skillToCopy: Skill | null
copying: boolean
// Actions: setSkillToCopy
// Thunk: copyToAgents
```

`linkPath` derived in modal: `skill.symlinks.find(s => s.agentId === selectedAgentId)?.linkPath`

## Edge Cases

| Case                      | Handling                                                    |
| ------------------------- | ----------------------------------------------------------- |
| Target already has skill  | Skip + "Already exists" in failures                         |
| Agent skills dir missing  | `fs.mkdir(recursive: true)`                                 |
| Broken symlink source     | Copy as-is (broken symlink reproduced)                      |
| Permission error mid-copy | Add to failures, continue others                            |
| Universal agent target    | Copies to `~/.agents/skills/`, affects all universal agents |
| All targets fail          | `success: false, copied: 0`                                 |

## Changes by Layer

| Layer    | Files                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| Shared   | `ipc-contract.ts`, `types.ts` — new channel + types                                     |
| Main     | `ipc/skills.ts` — new handler                                                           |
| Preload  | Expose `skills:copyToAgents` via context bridge                                         |
| Renderer | `SkillItem.tsx` (context menu), `CopyToAgentsModal.tsx` (new), `skillsSlice.ts` (state) |
| Tests    | IPC contract type test, pure function tests                                             |
