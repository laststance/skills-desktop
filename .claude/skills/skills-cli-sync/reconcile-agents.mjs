#!/usr/bin/env node
// Drift gate for the skills-cli-sync skill: asserts every AGENT_DEFINITIONS
// entry in src/shared/constants.ts has a matching SPEC.md agent-table row on
// (cliId, detection-path), and vice-versa. Run after editing constants.ts +
// SPEC.md during a Skills CLI sync. Exits non-zero on any drift so it can act
// as a validation gate (CI or pre-PR). Machine-independent: resolves the repo
// root from this file's own location, so it runs from any CWD.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// This file lives at <repo>/.claude/skills/skills-cli-sync/ — root is three up.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Extracts (cliId, detection-path) for every AGENT_DEFINITIONS entry. The
 * detection path is `~/<scanDir>/skills/` — the dir the app scans for that
 * agent's own symlinks (see the AGENT_DEFINITIONS JSDoc in constants.ts).
 */
function readConstants() {
  const src = readFileSync(`${ROOT}/src/shared/constants.ts`, 'utf-8')
  const start = src.indexOf('export const AGENT_DEFINITIONS = [')
  const end = src.indexOf('] as const', start)
  if (start === -1 || end === -1) {
    throw new Error('Could not locate AGENT_DEFINITIONS array in constants.ts')
  }
  // Split into object blocks on '},' boundaries; each carries cliId + scanDir.
  const blocks = src.slice(start, end).split(/\},/)
  const entries = []
  for (const block of blocks) {
    const cliId = block.match(/cliId:\s*'([^']+)'/)?.[1]
    const scanDir = block.match(/scanDir:\s*'([^']+)'/)?.[1]
    if (cliId && scanDir) entries.push({ cliId, path: `~/${scanDir}/skills/` })
  }
  return entries
}

/**
 * Extracts (name, cliId, path) from the SPEC.md agent table. The table is
 * delimited by the `| Agent ` header row and the `**Detection Logic` heading
 * that follows it. Each data row is `| Name | \`cliId\` | \`path\` |`.
 */
function readSpec() {
  const lines = readFileSync(`${ROOT}/SPEC.md`, 'utf-8').split('\n')
  const headerIndex = lines.findIndex((line) => line.startsWith('| Agent '))
  const tableEndIndex = lines.findIndex((line) =>
    line.startsWith('**Detection Logic'),
  )
  if (headerIndex === -1 || tableEndIndex === -1) {
    throw new Error(
      'Could not locate the agent table in SPEC.md (expected a "| Agent " ' +
        'header and a "**Detection Logic" heading after it)',
    )
  }
  const rows = []
  // +2 skips the header row and the markdown separator row beneath it.
  for (let i = headerIndex + 2; i < tableEndIndex; i++) {
    const line = lines[i]
    if (!line.startsWith('| ')) continue
    const match = line.match(
      /^\|\s*(.+?)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/,
    )
    if (match) rows.push({ name: match[1], cliId: match[2], path: match[3] })
  }
  return rows
}

const constants = readConstants()
const spec = readSpec()
console.log(`constants entries: ${constants.length}, spec rows: ${spec.length}`)

const constantsByCliId = new Map(constants.map((e) => [e.cliId, e.path]))
const specByCliId = new Map(spec.map((e) => [e.cliId, e.path]))
let problemCount = 0

// Every constants entry must have a matching SPEC row with the same path.
for (const { cliId, path } of constants) {
  if (!specByCliId.has(cliId)) {
    console.log(`❌ MISSING in SPEC: cliId='${cliId}' (expected ${path})`)
    problemCount++
  } else if (specByCliId.get(cliId) !== path) {
    console.log(
      `❌ PATH MISMATCH cliId='${cliId}': constants='${path}' SPEC='${specByCliId.get(cliId)}'`,
    )
    problemCount++
  }
}
// No SPEC row may reference a cliId that no longer exists in constants.
for (const { cliId } of spec) {
  if (!constantsByCliId.has(cliId)) {
    console.log(
      `❌ EXTRA/STALE in SPEC: cliId='${cliId}' not in AGENT_DEFINITIONS`,
    )
    problemCount++
  }
}
// Guard against an accidentally duplicated SPEC row.
const specCliIds = spec.map((e) => e.cliId)
const duplicateCliIds = [
  ...new Set(specCliIds.filter((c, i) => specCliIds.indexOf(c) !== i)),
]
if (duplicateCliIds.length) {
  console.log(`❌ DUPLICATE cliId in SPEC: ${duplicateCliIds.join(', ')}`)
  problemCount++
}

if (problemCount === 0) {
  console.log(
    `\n✅ RECONCILED: all ${constants.length} agents match on (cliId, detection-path). No drift.`,
  )
  process.exit(0)
}
console.log(
  `\n⚠️ ${problemCount} problem(s) found — fix constants.ts / SPEC.md and re-run.`,
)
process.exit(1)
