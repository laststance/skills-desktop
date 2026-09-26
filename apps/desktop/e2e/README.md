# e2e harness

Playwright drives the built Electron app against an isolated, throwaway `HOME`
so specs never touch the developer's real `~/.claude`, `~/.cursor`, etc.

## Snapshot fixture (hermetic global-setup)

`global-setup.ts` needs a `HOME` populated with the seven `microsoft/azure-skills`
skills before any spec runs. Installing them live (`npx skills add`) costs ~30s of
cold-cache network time per run and turns any registry/DNS hiccup into a failed
run. To stay fast and offline-proof, the install is captured **once** into a
committed tarball that setup untars instead of hitting the network.

| Artifact                                   | Purpose                                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `fixtures/azure-skills-snapshot.tar.gz`    | gzip tarball of the azure-\* install (symlinks normalized HOME-relative, mtimes pinned → byte-reproducible) |
| `fixtures/azure-skills-snapshot.meta.json` | provenance sidecar: `{cliVersion, repo, skillNames}`                                                        |
| `helpers/snapshot-fixture.ts`              | restore / capture / symlink-normalize logic                                                                 |

### Three setup paths (priority order)

1. `E2E_SKIP_INSTALL=1` — empty snapshot, no skills (smoke tests).
2. **Committed fixture matches the constants** → untar it. Fully hermetic: no
   DNS, no `npx`. This is the default on a clean checkout, so an air-gapped box
   still runs the azure-\* specs instead of skipping them.
3. **Otherwise** (fixture missing, or `meta.json` no longer matches the
   constants) → live-install via the skills CLI, then normalize symlinks so the
   live tree behaves identically to the fixture tree.

### Cache invalidation

`isCommittedFixtureUsable()` deep-equals `meta.json` against the **e2e**
constants (`SKILLS_CLI_VERSION`, `AZURE_SKILLS_REPO`, `AZURE_SKILL_NAMES` in
`e2e/constants.ts` — these are independent of the app's runtime
`src/shared/constants.ts` version). On any mismatch it returns `false` and setup
falls back to a live install — so a drifted fixture is never silently served.

> **Note:** the gate keys off _provenance_ (version + repo + skill list), not the
> tarball's _contents_. If `microsoft/azure-skills` changes upstream while the
> pinned version stays the same, regenerate manually (below).

### Regenerating the fixture

Run after bumping `SKILLS_CLI_VERSION` / changing `AZURE_SKILL_NAMES` in
`e2e/constants.ts`, or to pick up upstream skill content changes:

```bash
pnpm gen:e2e-snapshot   # = E2E_GEN_SNAPSHOT=1 pnpm test:e2e
```

This does a live install, normalizes symlinks + lock timestamps + file mtimes for
byte-reproducibility, drops the transient npm cache, writes the tarball + meta
sidecar, then runs the full suite against the freshly-captured fixture. Commit the
regenerated `fixtures/azure-skills-snapshot.*` pair.

## Running

```bash
pnpm test:e2e          # build + run (uses the committed fixture, hermetic)
pnpm test:e2e:headed   # same, headed
```
