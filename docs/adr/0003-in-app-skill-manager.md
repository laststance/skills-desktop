# Replace the skills CLI subprocess with an in-app skill manager

Marketplace installs silently failed for any user whose `npx` was not on the
GUI-inherited PATH (Finder-launched macOS apps get only
`/usr/bin:/bin:/usr/sbin:/sbin`). Even a perfect PATH fallback list cannot fix
this class of failure: any user without Node.js at all gets nothing, and no
enumerated list can cover every version manager. The app was a shell around a
CLI it could not guarantee exists, and its tests mocked the shell-out, so the
failure shipped green.

We port the skills CLI's install/remove/update/search behavior into the main
process as a deep module, the **skill manager** (`skillManager`), and delete
the subprocess delegation. The module's interface is small: `install`,
`remove`, `update`, `search`, progress events, and structured per-item results.
Everything else — source parsing, tarball fetching, skill discovery, lock IO,
symlink layout, hashing — sits behind the seam as implementation.

## Considered options

**Keep the CLI subprocess, expand PATH fallbacks.** Rejected. Whack-a-mole over
unknowable user environments; users without Node at all are unservable; the
spawn boundary is exactly what made failures silent and untestable.

**Bundle the CLI and run it with `ELECTRON_RUN_AS_NODE`.** Rejected. Removes
the Node dependency but keeps the wrong architecture: progress parsing over
ANSI stdout, exit-code-0-on-partial-failure semantics, no cancellation better
than SIGTERM, and an upstream bundle whose interactive/telemetry code we still
ship. The CLI's own failure semantics ("log per-item failure, exit 0") are
wrong for a UI.

**Shell out to git for cloning.** Rejected. `/usr/bin/git` needs Xcode CLT;
same environment-dependency class, smaller probability. GitHub serves any ref
as a tarball over HTTPS (`codeload.github.com`), extractable in pure
TypeScript, so the fetch path needs no external binary at all. Initial scope:
GitHub sources (`owner/repo` shorthand, github.com URLs incl. `/tree/`).
GitLab/SSH/private/well-known/download/notion sources are out of scope — the
manager reports them as unsupported instead of silently misbehaving.

## Decision details

- **Fetch**: resolve default branch via `api.github.com/repos/<o>/<r>` when
  needed, download `codeload.github.com/<o>/<r>/tar.gz/<ref>` into memory with
  a size cap, extract with a pure-JS tar reader. No git, no gh, no ssh.
- **Lock file**: keep the CLI's version-3 schema and location
  (`$XDG_STATE_HOME/skills/.skill-lock.json` else `~/.agents/.skill-lock.json`)
  so users can still use `npx skills` interchangeably. Writes become atomic
  (write temp + fsync + rename) — backward compatible, and removes the
  truncation-corruption mode the CLI's plain `writeFile` has.
- **Hashing**: `computeSkillFolderHash` replicated byte-exact (sha256 over
  path+content concatenations, posix paths, localeCompare sort, excluding
  `.git`/`node_modules`). New installs always store the content hash. Update
  compares dual-mode for lock compat: 40-hex stored hash compares against the
  folder's git tree SHA from the GitHub API; 64-hex compares content hash.
- **Discovery**: replicate the CLI's rules — root SKILL.md short-circuit,
  priority container dirs, depth limits, skip dirs, frontmatter name+description
  validation, `sanitizeName` folder derivation.
- **Layout**: canonical `~/.agents/skills/<sanitized>` copy (wipe-and-recopy,
  excluding `.git`, `__pycache__`, `__pypackages__`, `metadata.json`), relative
  symlinks into non-universal agents, universal agents need none.
- **Dropped**: telemetry (`skills.sh/tele/*`), the security-audit lookup,
  interactive prompts, agent auto-detection, the find-skills upsell, eve/
  promptscript special-casing, project scope (the app is global-only),
  `experimental_sync`, `use`.
- **Failure semantics**: per-item structured results `{success, error}`. A
  mutation either leaves the expected filesystem state or reports failure;
  install verifies its own writes before reporting success.

## Consequences

The app's core operations become testable end-to-end in-process: unit and
integration tests run the real manager against a real filesystem in an
isolated HOME, with a local fixture tarball server instead of the network.
E2E tests operate on the real filesystem with throwaway skills. The final QA
gate is a pattern matrix (add/remove/copy/update/rename/out-of-band edits)
executed a thousand times, asserting displayed state equals filesystem truth
after every operation.

The app no longer inherits upstream CLI features automatically; porting a new
source type is deliberate work. The blob-install fast path and tree-API
shortcuts are skipped: correctness first, bandwidth optimization later if
measurement says so.
