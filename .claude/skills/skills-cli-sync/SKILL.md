---
name: skills-cli-sync
description: Sync skills-desktop's AGENT_DEFINITIONS and UNIVERSAL_AGENT_IDS with the upstream vercel-labs/skills CLI, then update docs and validate. Use when bumping SKILLS_CLI_VERSION, mirroring a new upstream skills-CLI release, or when the agent list / universal set drifts from upstream agents.ts.
---

# Skills CLI sync (AGENT_DEFINITIONS)

This app mirrors the agent list of the upstream [`vercel-labs/skills`](https://github.com/vercel-labs/skills)
CLI. When upstream ships a release, `AGENT_DEFINITIONS`, `UNIVERSAL_AGENT_IDS`,
and `SKILLS_CLI_VERSION` in `src/shared/constants.ts` must be re-synced, the
docs refreshed, and the gates re-run. This skill encodes that procedure.

> The steps below are **invariant** — they hold for any version bump. Concrete
> counts and agent names belong only to the **"Latest run"** section at the
> bottom; never bake a count into a step.

## Source of truth

- **Upstream:** `src/agents.ts` (agent list) and `src/types.ts` (the `Agent`
  shape + home-dir helpers) in `vercel-labs/skills`.
- **This app:** the JSDoc on `AGENT_DEFINITIONS`, `UNIVERSAL_AGENT_IDS`, and
  `SKILLS_CLI_VERSION` in `src/shared/constants.ts` is authoritative — read it
  before editing. `CLAUDE.md` → **Domain Concepts → Skills CLI** lists the same
  pointers. Don't duplicate those rules here; this skill is the _procedure_.

## Phase 1 — Fetch the upstream agent list (no local clone)

Tags are **`v`-prefixed** (`v1.5.10`; bare `1.5.10` 404s). Fetch the two source
files at the version you're syncing to — reproducible on any machine:

```bash
NEW=1.5.11   # the upstream version you are syncing to
BASE="https://raw.githubusercontent.com/vercel-labs/skills/v${NEW}"
curl -fsSL "$BASE/src/agents.ts" -o /tmp/agents.ts
curl -fsSL "$BASE/src/types.ts"  -o /tmp/types.ts
```

Use `…/main/…` instead of `v${NEW}` to preview the latest unreleased list.

## Phase 2 — Extraction rules (getting these wrong breaks the sync silently)

- **Join on the upstream `name:` field** — it equals the `--agent` flag value
  and this app's `cliId`. **Not `displayName`.** Display names can match while
  ids diverge (the kimi trap).
- `name:` keys can be **quoted / hyphenated** (`'kimi-code-cli'`, `'kiro-cli'`).
  A naive `^\s+\w+: {` regex misses them — extract with `grep "name: '"`.
- `globalSkillsDir` / `skillsDir` are usually **computed** from home-dir helper
  constants at the top of `agents.ts` (e.g. `configHome=~/.config`,
  `codexHome=~/.codex`, `claudeHome=~/.claude`, plus per-vendor homes). Resolve
  each to a concrete `~/…`-relative path before deriving anything.

```bash
grep -nE "name: '" /tmp/agents.ts   # the upstream agent identifiers (= cliId)
```

For each upstream agent read: `name`, `displayName`, `globalSkillsDir`,
`skillsDir`, `showInUniversalList`. Then diff the upstream `name:` set against
the current `cliId` set in `AGENT_DEFINITIONS` to find **additions, removals,
and cliId renames**.

## Phase 3 — The two INDEPENDENT derivation rules (do not conflate)

**Rule A — `installDir` / `scanDir`** (from `globalSkillsDir`):

- `installDir` = the **parent** of `globalSkillsDir`, home-relative.
- `scanDir` = `installDir`, **except** when `globalSkillsDir` resolves to the
  universal source `~/.agents/skills` → `scanDir` diverges to `.<name>`. This is
  the **v0.13.0 guard**: if `scanDir` aliased the source, the scanner would
  surface every shared source skill as that agent's own "valid local skill".

**Rule B — `UNIVERSAL_AGENT_IDS`** (from `skillsDir`):

- An id belongs iff `skillsDir === '.agents/skills' && showInUniversalList !== false`.
- Note it keys off **`skillsDir`, not `globalSkillsDir`.** An agent can be
  universal (reads `~/.agents/skills`) yet keep its own `globalSkillsDir` (so
  **no** `scanDir` override) — that's the canonical proof the two rules are
  independent. Don't assume "universal ⇒ scanDir diverges" or vice-versa.

## Phase 4 — Exclusions

Skip an upstream agent when:

- `globalSkillsDir: undefined` — it can't be represented as an install path.
- It's a `showInUniversalList: false` pseudo-agent (a non-real aggregate entry).
- Its `globalSkillsDir` **collides** with another agent's dir → a `scanDir`
  clash that would double-count the shared directory.

`showInUniversalList: false` also excludes an otherwise-eligible agent from
`UNIVERSAL_AGENT_IDS`.

## Phase 5 — Edit `src/shared/constants.ts`

- **Add / modify `AGENT_DEFINITIONS` entries** (`id`, `cliId`, `name`,
  `installDir`, `scanDir`). Every field is required — no silent fallback.
- **Keep the internal `id` stable when only `cliId` changes.** `id` is the
  Redux/checkbox state key; changing it drops persisted user state. (kimi kept
  `id: 'kimi-cli'` while `cliId` became `kimi-code-cli`.)
- **Display-name-only rebrand:** change `name` only; leave `id` / `cliId` /
  `installDir` / `scanDir`. Then grep the renderer for the **old** display name
  and update any UI example/doc that hard-codes it (e.g. a `StatusBadge` JSDoc
  `@example`).
- Update **`UNIVERSAL_AGENT_IDS`** per Phase 3 Rule B.
- Bump **`SKILLS_CLI_VERSION`**.
- **Do not hand-edit derived values.** `AgentId` / `AGENT_IDS` (z.enum) /
  `AgentName` / `AGENT_ID_TO_CLI_NAME` / `SHARED_AGENT_PATHS` all derive from
  `AGENT_DEFINITIONS` automatically.
- The app's only CLI surface is **`find` + `add`** (`skillsCliService`). New
  upstream commands (`run` / `prompt` / `sync` / …) need no app change.

## Phase 6 — Update the docs

- **CLAUDE.md** — `SKILLS_CLI_VERSION` in the _Domain Concepts → Skills CLI_ table.
- **README.md** — the "N AI Agents Supported" count, any renamed display name,
  and the "…and X more" tail.
- **SPEC.md** — the agent table (add new rows, fix renames), every agent-count
  mention, then reflow: `npx prettier --write SPEC.md` (a wider new `cliId` can
  re-pad the whole table — that diff is expected, not churn).

## Phase 7 — Validate (all must pass, in order)

```bash
node .claude/skills/skills-cli-sync/reconcile-agents.mjs   # constants ↔ SPEC drift gate
npx prettier --check README.md SPEC.md CLAUDE.md
pnpm validate                                              # lint + test + typecheck + dead-code
pnpm test:e2e                                              # only after validate is green
```

`reconcile-agents.mjs` (shipped beside this file) asserts every
`AGENT_DEFINITIONS` entry has a matching SPEC row on `(cliId, detection-path)`
and that no SPEC row references a removed `cliId`. It exits non-zero on drift,
so it doubles as a CI / pre-PR gate.

Also confirm no stale references survive:

```bash
git grep -nE "<OLD_VERSION>" -- '*.md' '*.ts'   # e.g. 1\.5\.9 — should be only intentional history
git grep -n "<old display name>" -- '*.ts' '*.tsx'
```

## Phase 8 — Commit

One focused commit, e.g. `chore: sync skills CLI agent definitions to <NEW>`.
Summarize in the body: agents added/removed, any id/cliId migrations,
display-name rebrands, the `UNIVERSAL_AGENT_IDS` delta, and the version bump.
Do not bump `package.json` `version` — releases are owned solely by
`/electron-release`.

---

## Latest run (example — point-in-time, NOT part of the procedure)

**2026-06-24 · v1.5.11 → v1.5.13** (version pin + excluded upstream agent)

- **No app agent-list change:** upstream `name:` set is 72 and app `cliId` set
  stays 68. The only upstream addition since v1.5.11 that is not already
  mirrored is `eve`, which has `globalSkillsDir: undefined`, so Phase 4 excludes
  it. App orphans remained zero.
- **Unchanged derived sets:** `AGENT_DEFINITIONS` stayed 68,
  `UNIVERSAL_AGENT_IDS` stayed 16, with no `id`/`cliId` migrations and no
  display-name rebrands.
- **Excluded at this version:** `eve` and `promptscript`
  (`globalSkillsDir: undefined`), `universal` (`showInUniversalList: false`),
  `zenflow` (dir collides with zencoder's `~/.zencoder/skills`).
- **Edits:** bumped `SKILLS_CLI_VERSION` 1.5.11 → 1.5.13; bumped the e2e pin
  (`marketplace-install-regression.e2e.ts` literal `skills@1.5.13 add …` +
  comment); bumped the CLAUDE.md/AGENTS.md Domain-Concepts pinned-version cell;
  ignored local `.agents/**` in ESLint so repo-local skill copies do not break
  `pnpm validate`.
- Gates: `reconcile-agents.mjs` clean, prettier clean, `pnpm validate` green,
  `pnpm test:e2e` green (60 tests).

**2026-06-14 · v1.5.10 → v1.5.11** (version-only bump)

- **No agent-list change:** `src/agents.ts` is byte-identical between v1.5.10
  and v1.5.11 (`diff` clean), so `AGENT_DEFINITIONS`, `UNIVERSAL_AGENT_IDS`, and
  every doc agent-count stayed put. Drift gate confirmed: upstream `name:` set
  (71) minus app `cliId` set (68) = exactly the 3 standing exclusions below;
  zero app orphans.
- **Edits:** bumped `SKILLS_CLI_VERSION` 1.5.10 → 1.5.11; bumped the e2e pin
  (`marketplace-install-regression.e2e.ts` literal `skills@1.5.11 add …` +
  comment); bumped the CLAUDE.md Domain-Concepts pinned-version cell.
- **Unchanged history kept verbatim:** the "CLI 1.5.10" / "added in v1.5.10"
  comments in `constants.ts` and the `*.test.ts` files are accurate history of
  _when_ kimi migrated / agents landed — not bumped.
- **Excluded at this version** (still valid, agents.ts unchanged): `promptscript`
  (`globalSkillsDir: undefined`), `universal` (`showInUniversalList: false`),
  `zenflow` (dir collides with zencoder's `~/.zencoder/skills`).
- Gates: `reconcile-agents.mjs` clean, prettier clean, `pnpm validate` +
  `pnpm test:e2e` green.

**2026-06-05 · v1.5.5 → v1.5.10** (PR #204, commit `41b455e`)

- **+14 community agents:** antigravity-cli, astrbot, autohand-code,
  inference.sh, jazz, lingma, loaf, moxby, ona, qoder-cn, reasonix, terramind,
  tinycloud, zed.
- **kimi migration:** `cliId` kimi-cli → kimi-code-cli; `installDir`
  .config/agents → .agents; `scanDir` → .kimi. Internal `id` kept `kimi-cli`
  (state preservation).
- **Windsurf → Devin Desktop:** display name only; the `.codeium/windsurf`
  install/scan path is unchanged (upstream CLI was not renamed).
- **Counts:** `AGENT_DEFINITIONS` 54 → 68; `UNIVERSAL_AGENT_IDS` 13 → 16
  (+antigravity-cli, loaf, zed).
- **`scanDir`-divergent at this version** (Rule A exceptions): cline, dexto,
  kimi-code-cli, loaf, warp, zed.
- **Excluded at this version:** `promptscript` (`globalSkillsDir: undefined`),
  `universal` (`showInUniversalList: false`), `zenflow` (dir collides with
  zencoder's `~/.zencoder/skills`).
- Gates: `pnpm validate` (1376 tests) + `pnpm test:e2e` (55 tests) green.
