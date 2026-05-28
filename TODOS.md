# TODOS

Deferred items captured during planning. Pick up when scope and bandwidth allow.

## Symlink Health cleanup subagent review follow-ups (2026-05-28)

### P0. Orphan cleanup must not reuse source skill deletion

**Status:** Fixed in this branch.

**Finding:** The Symlink Health dialog currently calls the generic source-delete flow for orphan cleanup. If a source skill is restored between scan and cleanup, or if the reviewed display name does not match the destructive link name, cleanup can delete a live source skill instead of unlinking only dangling agent links.

**Fix direction:** Add an orphan-only main-process IPC path that revalidates selected dangling symlink paths, refuses when source/local copies exist, and only unlinks confirmed orphan agent links.

### P0. Stale-plan guard must compare reviewed cleanup snapshots

**Status:** Fixed in this branch.

**Finding:** The stale-plan check only verifies that selected item IDs still exist. The same ID can later represent a different agent/link path/target, so cleanup can act on rows the user did not review.

**Fix direction:** Compare full selected snapshots against the fresh plan before mutation, and execute from the fresh matched rows.

### P1. Inaccessible symlink targets must not be treated as cleanup-ready broken links

**Status:** Fixed in this branch.

**Finding:** `access()` failures are all classified as `broken`, including `EACCES`, `EPERM`, and `ELOOP`. The cleanup UI can then offer a symlink to a real but inaccessible target for unlinking.

**Fix direction:** Classify only `ENOENT` and `ENOTDIR` as cleanup-eligible broken targets. Represent other access failures as non-cleanup-safe and exclude them from cleanup.

### P1. Relative target resolution must match between scan and destructive cleanup

**Status:** Fixed in this branch.

**Finding:** The scanner resolves relative readlink targets against the physical parent directory, but the orphan sweep in `trashService` still resolves against the logical symlink path parent. Under symlinked parents, scan and cleanup can disagree.

**Fix direction:** Share the physical-parent resolver between scanner and cleanup code and cover it with a real filesystem test.

### P1. Add missing destructive-flow regression tests

**Status:** Fixed in this branch.

**Finding:** Current E2E covers a valid Devin symlink under symlinked `~/.config` and a generic cleanup unlink, but not the combined case: broken Devin symlink under symlinked `~/.config` cleaned through the UI.

**Fix direction:** Add E2E coverage that cleans a broken Devin slot under symlinked `~/.config`, preserves the source skill, preserves the `~/.config` symlink, and removes only the selected agent link.

### P1. Add stale-plan and partial-failure dialog coverage

**Status:** Fixed in this branch.

**Finding:** Stale plan and partial failure branches are destructive-flow guards, but dialog-level tests do not cover them.

**Fix direction:** Add browser/component tests proving stale cleanup does not call destructive IPC, and partial failure keeps failed rows selected with visible row errors.

### P2. Dialog state and accessibility polish

**Status:** Fixed in this branch.

**Finding:** Partial failure renders from the old plan after refresh, scans are not generation-guarded, the close button remains focusable during cleaning, close autofocus can fall through when the trigger disappears, and the live region wraps the whole interactive body.

**Fix direction:** Rebuild error state from fresh plan, guard late scan results, hide/disable the close affordance while cleaning, always prevent close autofocus with a stable fallback target, and move live announcements to status/error-only nodes.

### P0. Broken-slot cleanup must revalidate exact reviewed symlink in main

**Status:** Fixed in follow-up amend.

**Finding:** The post-fix subagent review found that non-orphan broken-slot cleanup still called generic `unlinkManyFromAgent` with only `agentId + linkName`. A source/target restored after renderer fresh-scan could turn a reviewed dangling slot into a live symlink before main unlinks it.

**Fix direction:** Add a broken-slot cleanup IPC that receives exact `agentId`, `linkName`, `linkPath`, and `targetPath`, then main revalidates slot path, symlink kind, resolved target equality, and missing-target error before unlinking.

### P1. Partial-failure retry state must compare fresh row snapshots

**Status:** Fixed in follow-up amend.

**Finding:** Partial failure rendering rebuilt from fresh plan but only retained failed row IDs. If the same ID now represented a different path/target, row errors and retry selection could attach to the wrong target.

**Fix direction:** Compare failed attempted rows against the post-cleanup plan with the same full snapshot matcher; stale out if any failed row no longer matches.

### P2. Inaccessible-only health state must not say Healthy

**Status:** Fixed in follow-up amend.

**Finding:** HealthWidget counted inaccessible slots in the amber/degraded health ratio but still rendered `Healthy` when `broken === 0`.

**Fix direction:** Render a non-cleanup manual-review state for inaccessible-only attention and add browser coverage.

### P0. Missing-path helper must not parse path text for ENOENT

**Status:** Fixed after second subagent review.

**Finding:** `isMissingPathError` falls back to `error.message.includes('ENOENT')`, so an `EACCES`/`EPERM` path containing the text `ENOENT` can be misclassified as a missing target and become cleanup-eligible.

**Fix direction:** Trust Node filesystem `error.code` only, and add a regression where `code: 'EACCES'` plus an `ENOENT` path returns inaccessible/manual-review.

### P0. Broken-slot cleanup results must preserve reviewed row identity

**Status:** Fixed after second subagent review.

**Finding:** `skills:clearBrokenSymlinkSlots` returns only `skillName`, and the dialog reconstructs failed row ownership with `find(linkName)`. Two agents with the same broken basename can attach an error/retry selection to the wrong row.

**Fix direction:** Return `agentId` and `linkPath` for each broken-slot result and group renderer summaries by the returned agent identity, not by skill name.

### P1. Inaccessible slots must not render as unlinked in skill views

**Status:** Fixed after second subagent review.

**Finding:** `SkillItem` and `SkillDetail` count only `valid` and `broken`, so a skill with only `inaccessible` slots can say `Not linked to any agent` and under-report the manual-review state.

**Fix direction:** Count and display inaccessible slots as their own amber/manual-review status in both summary and detail views.

### P2. Dialog live-region and pending-cleaning coverage

**Status:** Fixed after second subagent review.

**Finding:** The ready live region is always mounted, including scan/clean phases, and browser tests do not hold cleanup pending to assert the cleaning state.

**Fix direction:** Render the ready announcement only while the review list is shown, and add a deferred-IPC browser test for pending cleanup UI.

### P1. HealthWidget must not label inaccessible slots as broken

**Status:** Fixed after final subagent review.

**Finding:** The HealthWidget footer correctly says `Manual review` for inaccessible-only state, but the health bar aria-label and legend still aggregate `broken + inaccessible` under the word `broken`.

**Fix direction:** Use neutral `needs review` wording for the amber segment and add browser coverage so inaccessible-only state is not announced as broken.

### P1. Orphan cleanup must revalidate reviewed target identity

**Status:** Fixed after final parallel subagent review.

**Finding:** Orphan cleanup sends only `agentId + linkPath` for each reviewed agent link. If that same slot is replaced with a different dangling symlink before cleanup, main still unlinks it because the current target is missing.

**Fix direction:** Carry reviewed orphan `targetPath` through the cleanup plan, IPC schema, shared contract, and main handler, then reject cleanup when the current resolved target differs from the reviewed target.

### P1. Inaccessible agent slots must not use the normal unlink affordance

**Status:** Fixed after final parallel subagent review.

**Finding:** In agent view, `inaccessible` symlinks still qualify for the row X button and `UnlinkDialog` falls through to the valid-link copy. Users can be told the removal is a normal safe unlink even though the target could not be verified.

**Fix direction:** Keep inaccessible slots visible as amber manual-review state, hide the normal unlink button for non-local inaccessible links, and make `UnlinkDialog` treat inaccessible as a separate manual-review variant if it is ever reached defensively.

### P1. Stale and partial-failure dialog tests must cover same-id snapshot drift

**Status:** Fixed after final parallel subagent review.

**Finding:** Browser tests cover disappearing rows and matching failed rows, but not the fixed guard where a row keeps the same id while `linkPath`, `targetPath`, or preserved source identity changes.

**Fix direction:** Add dialog browser tests where the second/final scan keeps the same row id but changes `targetPath`; stale cleanup must not call destructive IPC and partial failure must switch to rescan-required state.

### P2. Pending destructive cleanup must prove close affordances are blocked

**Status:** Fixed after final parallel subagent review.

**Finding:** Pending-cleanup coverage asserts the loading title and disabled buttons, but not the corner close button or Escape/outside dismissal guards.

**Fix direction:** While cleanup IPC is unresolved, assert the close button is hidden and Escape leaves the dialog in the cleaning phase.

### P2. Broken-slot cleanup rows must show destructive link identity first

**Status:** Fixed after final parallel subagent review.

**Finding:** When metadata skill name differs from the agent-side link basename, cleanup row labels and checkbox accessible names use only the display skill name, while main unlinks by the link basename.

**Fix direction:** Show the agent-side `linkName` first and include the metadata display name when it differs; add browser coverage for the mismatch case.

### P1. Global orphan Delete must use reviewed target identity

**Status:** Fixed after post-fix subagent review.

**Finding:** The global orphan row Delete / bulk delete path still routes through `deleteSelectedSkills(skillName)`, which rescans by name and calls `clearOrphanSymlinks` from fresh name matches. That bypasses the reviewed `linkPath + targetPath` identity now used by the Symlink Health dialog.

**Fix direction:** Route selected global orphan deletes through the exact reviewed orphan cleanup IPC payload (`skillName`, `agentId`, `linkPath`, `targetPath`) and never fall back to name-only orphan sweeping for orphan rows. Added MainContent browser coverage for the IPC payload and deleteSkills bypass.

### P2. Symlink cleanup should avoid check-then-unlink races

**Status:** Fixed after post-fix subagent review.

**Finding:** Broken-slot and orphan cleanup now revalidate the reviewed target immediately before unlinking, but the unlink is still a separate filesystem operation. A concurrent replacement between check and unlink could still remove a slot that was not reviewed.

**Fix direction:** Use an atomic same-directory quarantine/rename cleanup path that validates the quarantined symlink and unlinks that exact entry, with conservative restoration behavior when validation fails.

### P2. HealthWidget must distinguish cleanup-ready and manual-review counts

**Status:** Fixed after post-fix subagent review.

**Finding:** Mixed health states compress cleanup-ready `broken` slots and non-cleanup-safe `inaccessible` slots into one "needs review" count, while the cleanup dialog only shows cleanup-eligible broken rows. Users can see a higher widget count than the dialog can clean without an explanation.

**Fix direction:** Split the widget footer/accessible copy into cleanup issue and manual-review counts while keeping the dialog button scoped to cleanup-ready rows. Added mixed-state browser coverage.

### P2. E2E must assert removed symlink paths with `lstat`

**Status:** Fixed after post-fix subagent review.

**Finding:** The destructive cleanup E2E asserts removed symlink paths with `existsSync`, which follows symlinks. A broken symlink also returns false, so the test can pass when the symlink itself remains.

**Fix direction:** Assert `lstatSync(path)` throws `ENOENT` after cleanup for both Devin and Codex cleanup E2E paths.

### P2. Mismatched cleanup-row browser test must assert destructive payload

**Status:** Fixed after post-fix subagent review.

**Finding:** The mismatch test checks that the row label shows `linkName` first, but it does not prove the cleanup IPC payload uses that destructive link identity.

**Fix direction:** Extend the browser test to click cleanup and assert `clearBrokenSymlinkSlots` receives the exact `skillName`, `linkPath`, and `targetPath` from the reviewed row.

### P3. IPC schema tests must cover cleanup target paths

**Status:** Fixed after post-fix subagent review.

**Finding:** `ipc-schemas.test.ts` does not include the new cleanup IPC channels in the skill-name rejection coverage, and does not verify that cleanup `targetPath` values are required absolute paths.

**Fix direction:** Add cleanup channel cases to the malicious skill-name table and add required/absolute `targetPath` schema tests for orphan and broken-slot cleanup payloads.

### P1. Scanner orphan rows must carry reviewed target identity

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Real scanner-created orphan slots only carry `status` and `linkPath`, while cleanup eligibility now requires `targetPath`. Fixture-based tests passed because they manually populated `targetPath`, but real orphan rows can disappear from Symlink Health cleanup and global orphan Delete can fall into the rescan-required preflight error.

**Fix direction:** Carry resolved `targetPath` through agent symlink status hits into `scanOrphanSymlinks`, and add scanner-to-plan regression coverage.

### P1. Quarantine cleanup must restore non-symlink replacements

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Atomic quarantine currently restores only after `readlink` succeeds. If a reviewed symlink is replaced by a local folder or regular file between precheck and `rename`, cleanup can move that replacement to `.cleanup-*`, throw stale, and leave the original slot missing.

**Fix direction:** Restore quarantined non-symlink entries back to the reviewed path on validation failure when possible, and cover the swap-before-rename race.

### P1. Cleanup mutation success must not become cleanup failure after refresh failure

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** `SymlinkCleanupDialog` runs destructive cleanup and post-cleanup refresh in the same `try`. If cleanup succeeds but `fetchSkills`, `fetchAgents`, or `fetchSourceStats` later rejects, the dialog reports `Cleanup failed`, encouraging a retry of a mutation that already happened.

**Fix direction:** Finalize cleanup results first, refresh with `Promise.allSettled`, preserve success/partial-failure state, and surface refresh failures as secondary copy.

### P1. Global orphan Delete confirm copy must not promise trash undo

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Global Delete confirmation still says rows move to app trash and can be restored within 15 seconds, but orphan rows now call orphan symlink cleanup and return no tombstone or undo path.

**Fix direction:** Derive confirmation copy from the selected delete/orphan split, advertise undo only for tombstoned rows, and describe orphan rows as dangling symlink cleanup with no undo window.

### P2. Agent-only inaccessible symlinks must stay visible

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Agent-only `inaccessible` symlink hits are dropped because linked scan keeps only `valid` and orphan scan keeps only `broken`. A manual-review symlink with no source skill can disappear from Health/manual-review UI.

**Fix direction:** Group agent-only inaccessible symlinks into visible non-orphan skill records with inaccessible slots and no cleanup action, plus scanner coverage.

### P2. Cleanup rows must expose full reviewed path identity

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Cleanup rows truncate the path detail and orphan checkbox labels omit the exact paths. Long links that differ only near the end can look identical, and screen-reader users cannot audit the reviewed destructive identity.

**Fix direction:** Render full wrapped `linkPath -> targetPath` details, include orphan agent path pairs, and connect details to the checkbox via accessible description.

### P2. E2E ambient cleanup contract must include targetPath

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** `e2e/types.d.ts` still types `clearOrphanSymlinks` agent records without `targetPath`, even though shared IPC types and Zod require it.

**Fix direction:** Update the E2E ambient type or reuse the shared contract so Playwright `page.evaluate` cleanup calls cannot type-check with stale payloads.

### P3. Broken-slot cleanup request should name link identity explicitly

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** `ClearBrokenSymlinkSlotsOptions.skillName` is semantically the agent-side link basename, not necessarily the visible source skill name. Future callers can reasonably pass the display skill name and trigger a false stale-path rejection.

**Fix direction:** Rename the request field to `linkName` or derive it from `linkPath` in main; keep result identity backward-compatible where useful.

### P3. Scan failure states need a retry affordance

**Status:** Fixed after second post-fix subagent review follow-up.

**Finding:** Initial scan failures show an error body but only Cancel plus disabled Clean; Rescan is gated to stale-plan states.

**Fix direction:** Show Rescan for error states as well, especially when no actionable plan is available.

### P1. Mixed global Delete must preserve failed source rows

**Status:** Fixed after third post-fix subagent review follow-up.

**Finding:** Mixed global delete batches that include orphan cleanup clear selection and leave bulk mode before source-backed deletion resolves. If a source delete fails, the failed row no longer stays selected for retry.

**Fix direction:** Clear selection eagerly only for true orphan-only batches, or reconcile final selection after both source delete and orphan cleanup so failed source rows remain selected.

### P1. Complete-but-stale cleanup state needs a Rescan action

**Status:** Fixed after third post-fix subagent review follow-up.

**Finding:** When destructive cleanup succeeds but the post-cleanup dashboard refresh fails, the dialog says `Rescan to refresh the dashboard state` but the footer exposes only `Done`.

**Fix direction:** Surface `Rescan` in the complete footer when the summary contains a post-cleanup refresh failure.

### P1. Reviewed cleanup must not quarantine an unreviewed replacement

**Status:** Fixed after third post-fix subagent review follow-up.

**Finding:** The atomic quarantine path renames whatever currently occupies `linkPath` before proving it is still the reviewed symlink. If another process swaps in a local folder, a crash or restore failure can strand the user's folder under `.cleanup-*`.

**Fix direction:** Avoid rename-first cleanup for paths that can become non-symlinks. Revalidate the reviewed symlink target immediately before unlinking, and treat non-symlink unlink failures as stale/manual rescan.

### P2. Global Delete confirm copy must separate stale orphan rows

**Status:** Fixed after third post-fix subagent review follow-up.

**Finding:** The global delete confirmation counts preflight `orphanErrors` as actionable orphan cleanup, so stale orphan rows can be described as if they will remove reviewed dangling symlinks.

**Fix direction:** Count only cleanup-ready orphan records as orphan cleanup and add a separate rescan warning for stale orphan rows.

### P1. Reviewed cleanup must revalidate immediately before unlink

**Status:** Fixed after fourth post-fix subagent review follow-up.

**Finding:** `unlinkReviewedDanglingSymlink` verifies the reviewed symlink and missing target, then awaits blocker probes before unlinking by path. A same-path symlink replacement or target restore during that window can make cleanup remove a slot that is no longer the reviewed dangling entry.

**Fix direction:** Re-read `lstat + readlink + targetPath` immediately before unlink and repeat the missing-target probe, with integration tests for symlink-to-symlink replacement and target restore after the first probe.

### P1. Refresh-failed cleanup Rescan must retry every failed dashboard source

**Status:** Fixed after fourth post-fix subagent review follow-up.

**Finding:** The complete-but-refresh-failed footer shows `Rescan`, but that action only reruns `fetchSkills`; if `fetchAgents` or `fetchSourceStats` failed, the dashboard state can remain stale after the advertised retry.

**Fix direction:** In refresh-failed complete state, make Rescan retry `fetchSkills`, `fetchAgents`, and `fetchSourceStats` before rebuilding the cleanup plan.

### P1. Stale orphan preflight failures must not become retry loops

**Status:** Fixed after fourth post-fix subagent review follow-up.

**Finding:** Global Delete mixes preflight `orphanErrors` into normal failed rows and reselects them. A stale orphan that requires rescan can stay selected and fail repeatedly, while the toast summary hides the rescan requirement.

**Fix direction:** Separate rescan-required orphan failures from retryable failures, exclude them from retry selection, and append explicit rescan-required copy to the post-action summary.

### P1. Mixed Delete rejection must restore unresolved selection

**Status:** Fixed after fourth post-fix subagent review follow-up.

**Finding:** If source delete rejects at the thunk level in a mixed source+orphan batch, the handler returns before orphan cleanup and does not restore source/orphan selection for retry.

**Fix direction:** On rejected source delete with orphan cleanup involved, re-enter bulk mode and reselect unresolved source names plus not-yet-run cleanup-ready orphan records.

### P1. Delete reducer must treat orphan-cleared as successful removal

**Status:** Fixed after fourth post-fix subagent review follow-up.

**Finding:** `deleteSelectedSkills.fulfilled` removes only `deleted` names from selection. If main returns `orphan-cleared`, a ghost selected row and anchor can remain until another context switch.

**Fix direction:** Treat both `deleted` and `orphan-cleared` as successful removal outcomes in selection and anchor reconciliation, with reducer coverage.

### P1. Cleanup commit must not path-unlink a post-validation replacement

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Final symlink/target revalidation still commits with `fs.unlink(linkPath)`. A replacement after final validation but before unlink can delete an unreviewed same-path symlink/file.

**Fix direction:** Use a guarded commit step: rename the reviewed slot to a private same-directory path, revalidate that moved entry and missing target, restore on mismatch/stale target, and unlink only the verified temp entry.

### P1. Restore must resolve relative symlink targets through physical parents

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Undo restore resolves recorded relative symlink targets against the logical `linkPath` parent. For Devin under symlinked `~/.config`, this can resolve to `/Users/.agents/...` and skip restoring the symlink.

**Fix direction:** Use `resolveRawSymlinkTarget(link.linkPath, link.target)` during restore and add a real filesystem symlinked-`.config` restore regression.

### P1. Agent-row broken cleanup must not use generic unlink

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Agent view exposes normal unlink for broken non-local rows, routing through generic `unlinkFromAgent` without reviewed `targetPath` revalidation. A broken row that becomes live after scan can be removed as if still broken.

**Fix direction:** Hide the normal unlink affordance for non-local broken rows unless routed through `clearBrokenSymlinkSlots`; add browser/helper coverage.

### P2. CopyToAgents must resolve symlinked-parent relative targets physically

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** `copyToAgents` resolves a source symlink's raw target with `resolve(dirname(sourcePath), rawTarget)`, reproducing the symlinked `~/.config` physical-parent bug for valid Devin links.

**Fix direction:** Use `resolveRawSymlinkTarget(sourcePath, rawTarget)` and add an integration test for copying a valid Devin symlink under symlinked `.config`.

### P2. Orphan cleanup thunk must set bulk busy state

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Global orphan-only Delete dispatches `clearSelectedOrphanSymlinks`, but the slice never sets `bulkDeleting` or `inFlightDeleteNames`; toolbar controls stay enabled and duplicate submissions are possible.

**Fix direction:** Add pending/fulfilled/rejected reducers and UI pending handling for `clearSelectedOrphanSymlinks`.

### P2. Inaccessible rows must not expose Add or Copy fan-out

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Inaccessible symlinks are manual-review rows but still expose Add/Copy actions, allowing the UI to replicate a target the app could not verify.

**Fix direction:** Gate Add/Copy on `!isInaccessibleSkill` and add helper/browser coverage.

### P2. Refresh-failed Rescan must not lose dashboard retry context

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** If the first refresh-failed Rescan retries `fetchAgents`/`fetchSourceStats` and one fails again, the dialog enters error state; future Rescan calls become skills-only.

**Fix direction:** Treat auxiliary dashboard refresh failures as secondary when `fetchSkills` succeeds, keeping the scan result usable and avoiding downgrade to skills-only retry.

### P2. Mixed Delete rejection must refresh sticky error state

**Status:** Fixed in `fix: close symlink cleanup fifth-review findings`.

**Finding:** Mixed Delete source thunk rejection restores selection but does not refetch, leaving `skills.error` set and hiding the restored retry state behind the SkillsList error view.

**Fix direction:** Call `refreshAllData(dispatch)` in the mixed rejection path after restoring unresolved selection.

### P1. Agent-view bulk Unlink must not bypass reviewed cleanup

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** Per-row Unlink is hidden for broken/inaccessible agent rows, but bulk selection still allows those rows and `MainContent` routes agent bulk actions through name-only `unlinkSelectedFromAgent`. That bypasses reviewed `linkPath`/`targetPath` revalidation and can remove a symlink that became live after scan.

**Fix direction:** Exclude broken/inaccessible non-local rows from agent-view bulk-select names and checkbox rendering, with selector/browser coverage.

### P1. Name-rescan orphan delete must not direct-unlink stale links

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** `moveToTrash` orphan branch still scans by name and then `fs.unlink(orphan.linkPath)` directly. If the target/source is restored between scan and unlink, a live symlink can be removed outside the guarded cleanup path.

**Fix direction:** Carry resolved reviewed target identity from orphan scan and commit through the same guarded rename/revalidate/unlink model, returning `ESTALE` when the target is restored.

### P1. Restore loop must not abort after source restore when one symlink parent is missing

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** `restoreSourceBacked` calls `resolveRawSymlinkTarget` before ensuring the agent skills directory exists and lets resolver failures escape the per-link skip loop. A missing agent dir can abort restore after the source has already been moved back.

**Fix direction:** Resolve absolute targets without parent realpath, create the agent skills dir before relative resolution, and treat per-link resolver failures as skipped symlinks.

### P1. Guarded stale cleanup needs E2E coverage

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** E2E covers immediate cleanup but not the stale-after-review case where the selected slot changes before mutation. The lower-level race tests do not prove the UI preserves replacements and asks for rescan.

**Fix direction:** Add an Electron E2E that opens Symlink Health cleanup, mutates the selected slot, clicks Clean, and asserts rescan/error copy plus preserved replacement.

### P1. Orphan-only Delete rejection must refresh and restore retry state

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** If `clearSelectedOrphanSymlinks` rejects before per-item results and no source delete ran, `MainContent` shows a toast and returns without refresh or re-entering bulk mode.

**Fix direction:** On orphan cleanup thunk rejection with no prior delete items, reselect unresolved orphan rows, refresh all data, and add browser coverage.

### P2. Broken cleanup thunk must update Redux busy state

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** `clearSelectedBrokenSymlinkSlots` is dispatched by Symlink Cleanup but has no pending/fulfilled/rejected reducers, so global busy/error/ephemeral UI state can remain stale during broken-only cleanup.

**Fix direction:** Add reducer and UI pending handling mirroring unlink cleanup state, with slice tests.

### P2. Stale-only orphan confirm must not enable a no-op destructive Delete

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** A selection containing only stale orphan rows shows "No selected orphan skills are cleanup-ready" but still enables the destructive Delete button. Clicking it does nothing because `deleteItems.length === 0`.

**Fix direction:** Disable the confirm primary action when there are no source deletes and no cleanup-ready orphan records.

### P2. Refresh-failed Rescan should preserve auxiliary refresh failure warning

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** `runScan({ refreshDashboard: true })` now ignores `fetchAgents`/`fetchSourceStats` rejection when `fetchSkills` succeeds. That avoids a hard error but can make the stale-dashboard warning disappear.

**Fix direction:** Keep the scan usable while surfacing an auxiliary refresh failure message and keeping a Rescan affordance.

### P2. Inaccessible destination labels must not say "broken link"

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** Add/Copy modal occupancy maps inaccessible destinations to the same `broken link` label, collapsing manual-review and cleanup-ready states.

**Fix direction:** Add an `inaccessible` occupancy reason and label it as manual review required.

### P2. Orphan cleanup needs route-specific guarded-race coverage

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** Broken-slot guarded races are covered, but orphan cleanup has its own source/local-copy blocker and lacks analogous integration tests.

**Fix direction:** Add orphan cleanup tests for target restored, local folder/source appearing, and commit-time replacement preservation.

### P2. Symlink Cleanup orphan-record path needs E2E coverage

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** Symlink Cleanup E2E covers broken slots, not source-absent orphan-record cleanup, busy controls, or no-undo/tombstone behavior.

**Fix direction:** Add an Electron E2E with a dangling agent symlink and no source, asserting cleanup removes the orphan without creating undo affordance.

### P2. Inaccessible/manual-review affordances need E2E coverage

**Status:** Fixed after sixth post-fix subagent review follow-up.

**Finding:** Unit/browser tests cover hidden Add/Copy/Unlink, but E2E does not assert the manual-review surface and absence of destructive affordances.

**Fix direction:** Add or extend E2E coverage for inaccessible state if a stable fixture can create it without touching protected user paths.

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
