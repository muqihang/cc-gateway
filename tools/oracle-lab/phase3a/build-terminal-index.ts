import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { buildArtifactIndex, type ArtifactIndexInput, writeArtifactIndex } from './artifact-index.js'
import { validateAuthoritativeC4RunIds } from './c4-evidence.js'
import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'

const TOOLCHAIN = '6f86c18ddf1f22095d5817ee82ee1ff1d6babae689c1f0ebbe51bb2b8217fd6d'
const EXPIRY = '2026-08-03T00:00:00.000Z'
const TIER_A_VERSIONS = ['2.1.214', '2.1.212', '2.1.211', '2.1.208', '2.1.207']

function safeId(value: string): string { return value.replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 120) }

function jsonFilesBelow(root: string, relativeRoot: string): string[] {
  const directory = path.join(root, relativeRoot)
  if (!existsSync(directory)) return []
  const files: string[] = []
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(path.relative(root, child).split(path.sep).join('/'))
    }
  }
  visit(directory)
  return files
}

export function terminalArtifactInputs(root: string): ArtifactIndexInput[] {
  const rows: ArtifactIndexInput[] = []
  const add = (artifactId: string, relativePath: string, scope: string, disposition: ArtifactIndexInput['disposition'] = 'retain', parents: string[] = []): void => {
    if (!existsSync(path.join(root, relativePath))) return
    rows.push({
      artifact_id: safeId(artifactId), relative_path: relativePath, media_type: 'application/json', source_url: null, scope,
      requirement_ids: scope === 'P3A-2' ? ['HA-P1-001', 'HA-P1-002'] : ['HA-P1-001'], sensitivity: 'normalized-safe', redaction_transform: 'phase3a-safe-summary-v1',
      retention_class: 'normalized-until-phase3b', expiry: EXPIRY, disposition,
      parser_name: 'phase3a-terminal-index', parser_version: '2', parser_agreement: 'agreed', parent_artifact_ids: parents,
    })
  }
  add('p3a0-artifact-index', 'capsules/P3A-0/artifact-index.json', 'P3A-0')
  add('p3a1-static-summary', 'capsules/P3A-1/static-summary.json', 'P3A-1', 'retain', ['p3a1-inventory', 'p3a1-extraction-a', 'p3a1-extraction-b'])
  const staticRoot = 'static/90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58'
  add('p3a1-inventory', `${staticRoot}/inventory-v2.json`, 'P3A-1', 'retain', ['p3a0-artifact-index'])
  add('p3a1-extraction-a', `${staticRoot}/bun-extract-a/extraction-index.json`, 'P3A-1', 'retain', ['p3a1-inventory'])
  add('p3a1-extraction-b', `${staticRoot}/bun-extract-b/extraction-index.json`, 'P3A-1', 'retain', ['p3a1-inventory'])
  for (const lane of ['ast-small-a', 'ast-small-b']) {
    const directory = path.join(root, staticRoot, lane)
    if (!existsSync(directory)) continue
    for (const name of readdirSync(directory).filter((entry) => entry.endsWith('.json')).sort()) {
      add(`p3a1-${lane}-${name.replace(/\.json$/, '')}`, `${staticRoot}/${lane}/${name}`, 'P3A-1', 'retain', [lane.endsWith('-a') ? 'p3a1-extraction-a' : 'p3a1-extraction-b'])
    }
  }
  const invalidAst = `${staticRoot}/ast-a/module-0.json`
  if (existsSync(path.join(root, invalidAst))) rows.push({ artifact_id: 'p3a1-invalid-ast-superseded', relative_path: invalidAst, media_type: 'application/json', source_url: null, scope: 'P3A-1-invalid', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-superseded', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'superseded-non-reproducible', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'disagreed', negative_result: 'canonical AST traversal short-circuited and is invalid', parent_artifact_ids: ['p3a1-extraction-a'] })
  for (let run = 2; run <= 7; run += 1) {
    const id = `active-baseline-${String(run).padStart(3, '0')}`
    add(`p3a2-${id}-manifest`, `capsules/P3A-2/${id}/manifest.json`, 'P3A-2', 'retain', ['p3a0-artifact-index'])
    add(`p3a2-${id}-guard`, `capsules/P3A-2/${id}/guard.json`, 'P3A-2', 'retain', [`p3a2-${id}-manifest`])
    add(`p3a2-${id}-observer`, `capsules/P3A-2/${id}/observer.json`, 'P3A-2', 'retain', [`p3a2-${id}-manifest`])
    add(`p3a2-${id}-result`, `capsules/P3A-2/${id}/result.json`, 'P3A-2', 'retain', [`p3a2-${id}-guard`, `p3a2-${id}-observer`])
    add(`p3a2-${id}-summary`, `capsules/P3A-2/${id}/summary.json`, 'P3A-2', 'retain', [`p3a2-${id}-result`])
  }
  const capsuleRoot = path.join(root, 'capsules/P3A-2')
  const c4RunIds = validateAuthoritativeC4RunIds(existsSync(capsuleRoot)
    ? readdirSync(capsuleRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name.startsWith('c4-')).map((entry) => entry.name)
    : [])
  for (const id of c4RunIds) {
    add(`p3a2-${id}-manifest`, `capsules/P3A-2/${id}/manifest.json`, 'P3A-2', 'retain', ['p3a0-artifact-index'])
    add(`p3a2-${id}-guard`, `capsules/P3A-2/${id}/guard.json`, 'P3A-2', 'retain', [`p3a2-${id}-manifest`])
    add(`p3a2-${id}-observer`, `capsules/P3A-2/${id}/observer.json`, 'P3A-2', 'retain', [`p3a2-${id}-manifest`])
    add(`p3a2-${id}-result`, `capsules/P3A-2/${id}/result.json`, 'P3A-2', 'retain', [`p3a2-${id}-guard`, `p3a2-${id}-observer`])
    add(`p3a2-${id}-summary`, `capsules/P3A-2/${id}/summary.json`, 'P3A-2', 'retain', [`p3a2-${id}-result`])
    add(`p3a2-${id}-normalized`, `normalized/P3A-2/${id}.json`, 'P3A-2', 'retain', [`p3a2-${id}-summary`])
  }
  const c4PairIds = [...new Set(c4RunIds.map((id) => id.replace(/-r\d{2}-(?:control|treatment)$/, '')))].sort()
  for (const pairId of c4PairIds) {
    const pairRuns = c4RunIds.filter((id) => id.startsWith(`${pairId}-r`))
    const inputId = `p3a2-${pairId}-campaign-input`
    add(inputId, `campaign/P3A-2/${pairId}/input.json`, 'P3A-2', 'retain', pairRuns.map((id) => `p3a2-${id}-manifest`))
    add(`p3a2-${pairId}-campaign-result`, `campaign/P3A-2/${pairId}/result.json`, 'P3A-2', 'retain', [inputId, ...pairRuns.map((id) => `p3a2-${id}-normalized`)])
  }
  const dynamicParents = Array.from({ length: 6 }, (_, index) => `p3a2-active-baseline-${String(index + 2).padStart(3, '0')}-summary`)
  add('p3a4-normalized-observations', 'capsules/P3A-4/normalized-observations.json', 'P3A-4', 'retain', dynamicParents)
  add('p3a4-artifact-identity-graph', 'normalized/P3A-4/artifact-identity-graph.json', 'P3A-4', 'retain', ['p3a0-artifact-index', 'p3a1-static-summary', ...dynamicParents])
  add('p3a4-artifact-identity-graph-c4', 'normalized/P3A-4/artifact-identity-graph-c4.json', 'P3A-4', 'retain', ['p3a0-artifact-index', 'p3a1-static-summary', ...c4RunIds.map((id) => `p3a2-${id}-summary`)])
  add('p3a4-artifact-identity-graph-closure', 'normalized/P3A-4/artifact-identity-graph-closure-v1.json', 'P3A-4', 'retain', ['p3a0-artifact-index', 'p3a1-static-summary', ...c4RunIds.map((id) => `p3a2-${id}-summary`)])
  add('p3a4-artifact-identity-graph-closure-v2', 'normalized/P3A-4/artifact-identity-graph-closure-v2.json', 'P3A-4', 'retain', ['p3a0-artifact-index', 'p3a1-static-summary', ...c4RunIds.map((id) => `p3a2-${id}-summary`)])
  add('p3a2-closure-probe', 'capsules/P3A-2/closure-r2-capability-probe-copy-v7/summary.json', 'P3A-2', 'retain', ['p3a1-static-summary'])
  add('p3a2-closure-environment', 'capsules/P3A-2/closure-r2-environment-matrix-closure-v1.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-saturation', 'capsules/P3A-2/closure-r2-saturation-v1.json', 'P3A-2', 'retain', ['p3a2-closure-environment'])
  add('p3a2-closure-scenarios', 'capsules/P3A-2/closure-r2-scenario-closure-v1.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-config', 'capsules/P3A-2/closure-r2-config-precedence-v2/summary.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-auth-primary', 'capsules/P3A-2/closure-r2-auth-lifecycle-v1/summary.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-auth-supplement', 'capsules/P3A-2/closure-r2-auth-coexistence-v2/summary.json', 'P3A-2', 'retain', ['p3a2-closure-auth-primary'])
  add('p3a2-closure-coverage', 'capsules/P3A-2/closure-r2-coverage-v1.json', 'P3A-2', 'retain', ['p3a2-closure-environment', 'p3a2-closure-saturation', 'p3a2-closure-scenarios', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'])
  add('p3a2-closure-environment-v2', 'capsules/P3A-2/closure-r2-environment-matrix-closure-v2.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-environment-v3', 'capsules/P3A-2/closure-r2-environment-matrix-closure-v3.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-scenarios-v2', 'capsules/P3A-2/closure-r2-scenario-closure-v2.json', 'P3A-2', 'retain', ['p3a2-closure-probe'])
  add('p3a2-closure-coverage-v2', 'capsules/P3A-2/closure-r2-coverage-v2.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v2', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'])
  add('p3a2-closure-coverage-v3', 'capsules/P3A-2/closure-r2-coverage-v3.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v2', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'])
  add('p3a2-closure-coverage-v4', 'capsules/P3A-2/closure-r2-coverage-v4.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v3', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement'])
  const gapCellIds: string[] = []
  for (let index = 0; index < 5; index += 1) {
    const cell = `capsules/P3A-2/closure-r2-gap-campaign-v1/cells/${String(index).padStart(2, '0')}`
    const manifestId = `p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-manifest`
    const guardId = `p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-guard`
    const observerId = `p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-observer`
    const resultId = `p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-result`
    const summaryId = `p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-summary`
    add(manifestId, `${cell}/manifest.json`, 'P3A-2', 'retain', ['p3a2-closure-probe'])
    add(guardId, `${cell}/guard.json`, 'P3A-2', 'retain', [manifestId])
    add(observerId, `${cell}/observer.json`, 'P3A-2', 'retain', [manifestId])
    add(resultId, `${cell}/result.json`, 'P3A-2', 'retain', [guardId, observerId])
    add(summaryId, `${cell}/summary.json`, 'P3A-2', 'retain', [resultId])
    add(`p3a2-gap-v1-cell-${String(index).padStart(2, '0')}-normalized`, `${cell}/normalized.json`, 'P3A-2', 'retain', [summaryId])
    gapCellIds.push(summaryId)
  }
  add('p3a2-gap-campaign-v1', 'capsules/P3A-2/closure-r2-gap-campaign-v1/summary.json', 'P3A-2', 'retain', gapCellIds)
  const gapV2CellIds: string[] = []
  for (let index = 0; index < 5; index += 1) {
    const cell = `capsules/P3A-2/closure-r2-gap-campaign-v2/cells/${String(index).padStart(2, '0')}`
    const manifestId = `p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-manifest`
    const guardId = `p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-guard`
    const observerId = `p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-observer`
    const resultId = `p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-result`
    const summaryId = `p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-summary`
    add(manifestId, `${cell}/manifest.json`, 'P3A-2', 'retain', ['p3a2-closure-probe'])
    add(guardId, `${cell}/guard.json`, 'P3A-2', 'retain', [manifestId])
    add(observerId, `${cell}/observer.json`, 'P3A-2', 'retain', [manifestId])
    add(resultId, `${cell}/result.json`, 'P3A-2', 'retain', [guardId, observerId])
    add(summaryId, `${cell}/summary.json`, 'P3A-2', 'retain', [resultId])
    add(`p3a2-gap-v2-cell-${String(index).padStart(2, '0')}-normalized`, `${cell}/normalized.json`, 'P3A-2', 'retain', [summaryId])
    gapV2CellIds.push(summaryId)
  }
  add('p3a2-gap-campaign-v2', 'capsules/P3A-2/closure-r2-gap-campaign-v2/summary.json', 'P3A-2', 'retain', gapV2CellIds)
  add('p3a2-closure-coverage-v5', 'capsules/P3A-2/closure-r2-coverage-v5.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v3', 'p3a2-closure-saturation', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement', 'p3a2-gap-campaign-v1'])
  add('p3a2-closure-coverage-v6', 'capsules/P3A-2/closure-r2-coverage-v6.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v3', 'p3a2-closure-saturation', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement', 'p3a2-gap-campaign-v1'])
  add('p3a2-closure-coverage-v7', 'capsules/P3A-2/closure-r2-coverage-v7.json', 'P3A-2', 'retain', ['p3a2-closure-environment-v3', 'p3a2-closure-saturation', 'p3a2-closure-scenarios-v2', 'p3a2-closure-config', 'p3a2-closure-auth-primary', 'p3a2-closure-auth-supplement', 'p3a2-gap-campaign-v2'])
  add('p3a1-r1-static-closure', 'capsules/P3A-1/r1-static-closure-v1.json', 'P3A-1', 'retain', ['p3a1-static-summary'])
  add('p3a1-cross-platform-static-corroboration-v2', 'capsules/P3A-1/cross-platform-static-corroboration-v2.json', 'P3A-1', 'retain', ['p3a1-r1-static-closure'])
  const addFocusedRepair = (version: 'v1' | 'v5', cells: number, includeUpdateBoundaryFiles = false): void => {
    const repair = version === 'v1' ? 'closure-r2-gap-repair-v1' : 'closure-r2-gap-update-repair-v5'
    const prefix = version === 'v1' ? 'p3a2-gap-repair-v1' : 'p3a2-gap-update-repair-v5'
    const cellSummaryIds: string[] = []
    for (let index = 0; index < cells; index += 1) {
      const cell = `capsules/P3A-2/${repair}/cells/${String(index).padStart(2, '0')}`
      const manifestId = `${prefix}-cell-${String(index).padStart(2, '0')}-manifest`
      const guardId = `${prefix}-cell-${String(index).padStart(2, '0')}-guard`
      const observerId = `${prefix}-cell-${String(index).padStart(2, '0')}-observer`
      const resultId = `${prefix}-cell-${String(index).padStart(2, '0')}-result`
      const summaryId = `${prefix}-cell-${String(index).padStart(2, '0')}-summary`
      add(manifestId, `${cell}/manifest.json`, 'P3A-2', 'retain', ['p3a1-r1-static-closure'])
      add(guardId, `${cell}/guard.json`, 'P3A-2', 'retain', [manifestId])
      add(observerId, `${cell}/observer.json`, 'P3A-2', 'retain', [manifestId])
      add(resultId, `${cell}/result.json`, 'P3A-2', 'retain', [guardId, observerId])
      if (includeUpdateBoundaryFiles) {
        add(`${prefix}-cell-${String(index).padStart(2, '0')}-fixture-self-test`, `${cell}/fixture-self-test.json`, 'P3A-2', 'retain', [manifestId])
        add(`${prefix}-cell-${String(index).padStart(2, '0')}-update-proxy`, `${cell}/update-proxy.json`, 'P3A-2', 'retain', [manifestId])
      }
      add(summaryId, `${cell}/summary.json`, 'P3A-2', 'retain', [resultId])
      add(`${prefix}-cell-${String(index).padStart(2, '0')}-normalized`, `${cell}/normalized.json`, 'P3A-2', 'retain', [summaryId])
      cellSummaryIds.push(summaryId)
    }
    add(prefix, `capsules/P3A-2/${repair}/summary.json`, 'P3A-2', 'retain', cellSummaryIds)
  }
  addFocusedRepair('v1', 3)
  addFocusedRepair('v5', 1, true)
  add('p3a2-closure-coverage-v8', 'capsules/P3A-2/closure-r2-coverage-v8.json', 'P3A-2', 'retain', ['p3a2-closure-coverage-v7', 'p3a1-r1-static-closure', 'p3a2-gap-repair-v1', 'p3a2-gap-update-repair-v5'])
  add('p3a2-local-tls-connect-v1', 'capsules/P3A-2/closure-r2-local-tls-connect-v1/summary.json', 'P3A-2', 'retain', ['p3a2-closure-coverage-v8'])
  add('p3a3-closure-tier-a', 'capsules/P3A-3/closure-r3-tier-a-v1.json', 'P3A-3', 'retain', ['p3a2-closure-coverage'])
  add('p3a3-closure-tier-a-v2', 'capsules/P3A-3/closure-r3-tier-a-v2.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v2'])
  add('p3a3-closure-tier-a-v3', 'capsules/P3A-3/closure-r3-tier-a-v3.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v4'])
  const tierAProjectionIds: string[] = []
  for (const version of ['214', '212', '211', '208', '207']) {
    const projectionId = `p3a3-tier-a-v4-${version}-projection`
    add(projectionId, `capsules/P3A-3/tier-a-dynamic-projection-v1-${version}.json`, 'P3A-3', 'retain', ['p3a2-closure-coverage-v5'])
    tierAProjectionIds.push(projectionId)
  }
  add('p3a3-closure-tier-a-v6', 'capsules/P3A-3/closure-r3-tier-a-v6.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v5', ...tierAProjectionIds])
  const tierAProjectionV2Ids: string[] = []
  for (const version of ['214', '212', '211', '208', '207']) {
    const projectionId = `p3a3-tier-a-v5-${version}-projection`
    add(projectionId, `capsules/P3A-3/tier-a-dynamic-projection-v2-${version}.json`, 'P3A-3', 'retain', ['p3a2-closure-coverage-v6'])
    tierAProjectionV2Ids.push(projectionId)
  }
  add('p3a3-closure-tier-a-v7', 'capsules/P3A-3/closure-r3-tier-a-v7.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v6', ...tierAProjectionV2Ids])
  add('p3a3-closure-tier-a-v8', 'capsules/P3A-3/closure-r3-tier-a-v8.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v6', ...tierAProjectionV2Ids])
  const tierAProjectionV3Ids: string[] = []
  for (const version of ['214', '212', '211', '208', '207']) {
    const projectionId = `p3a3-tier-a-v6-${version}-projection`
    add(projectionId, `capsules/P3A-3/tier-a-dynamic-projection-v3-${version}.json`, 'P3A-3', 'retain', ['p3a2-closure-coverage-v7'])
    tierAProjectionV3Ids.push(projectionId)
  }
  add('p3a3-closure-tier-a-v9', 'capsules/P3A-3/closure-r3-tier-a-v9.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v7', ...tierAProjectionV3Ids])
  const tierAProjectionV4Ids: string[] = []
  for (const version of ['214', '212', '211', '208', '207']) {
    const projectionId = `p3a3-tier-a-v7-${version}-projection`
    add(projectionId, `capsules/P3A-3/tier-a-dynamic-projection-v4-${version}.json`, 'P3A-3', 'retain', ['p3a2-closure-coverage-v7'])
    tierAProjectionV4Ids.push(projectionId)
  }
  add('p3a3-closure-tier-a-v10', 'capsules/P3A-3/closure-r3-tier-a-v10.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v7', ...tierAProjectionV4Ids])
  const tierABindingV3Ids = new Map<string, string[]>()
  for (const version of TIER_A_VERSIONS) {
    const bindingRoot = `capsules/P3A-3/tier-a-cell-bindings-v3/${version}`
    const bindingIds: string[] = []
    for (const relativePath of jsonFilesBelow(root, bindingRoot)) {
      const relativeName = relativePath.slice(`${bindingRoot}/`.length).replace(/\.json$/, '')
      const bindingId = `p3a3-tier-a-binding-v3-${safeId(version)}-${safeId(relativeName)}-${sha256Bytes(relativePath).slice(0, 12)}`
      add(bindingId, relativePath, 'P3A-3', 'retain', ['p3a1-r1-static-closure'])
      bindingIds.push(bindingId)
    }
    tierABindingV3Ids.set(version, bindingIds)
  }
  const tierAProjectionV5Ids: string[] = []
  for (const version of TIER_A_VERSIONS) {
    const projectionId = `p3a3-tier-a-projection-v5-${version}`
    add(projectionId, `capsules/P3A-3/tier-a-dynamic-projections-v5/tier-a-dynamic-projection-v5-${version}.json`, 'P3A-3', 'retain', tierABindingV3Ids.get(version) ?? [])
    tierAProjectionV5Ids.push(projectionId)
  }
  add('p3a3-closure-tier-a-v11', 'capsules/P3A-3/closure-r3-tier-a-v11.json', 'P3A-3', 'retain', ['p3a2-closure-coverage-v8', ...tierAProjectionV5Ids])
  add('p3a3-tier-a-rerun-terminal-unknown-v1', 'capsules/P3A-3/tier-a-rerun-terminal-unknown-v1.json', 'P3A-3', 'retain', ['p3a3-closure-tier-a-v11'])
  rows.push(
    { artifact_id: 'raw-intake-index-quarantine', relative_path: 'intake/artifact-index.json', media_type: 'application/json', source_url: null, scope: 'P3A-0-raw', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-quarantined', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'quarantined', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'not-applicable', parent_artifact_ids: [] },
    { artifact_id: 'raw-release-intake-record-quarantine', relative_path: 'intake/release/2.1.215/artifact.json', media_type: 'application/json', source_url: null, scope: 'P3A-0-raw', requirement_ids: ['HA-P1-001'], sensitivity: 'quarantine', redaction_transform: 'none-quarantined', retention_class: 'quarantine-24h', expiry: EXPIRY, disposition: 'quarantined', parser_name: 'phase3a-terminal-index', parser_version: '1', parser_agreement: 'not-applicable', parent_artifact_ids: [] },
  )
  return rows.sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
}

export function parseTerminalIndexArgs(argv: string[]): Record<string, string> {
  const values = argv[0] === '--' ? argv.slice(1) : argv
  const output: Record<string, string> = {}
  const allowed = new Set(['evidence-root', 'previous-index', 'out'])
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || !values[index + 1] || values[index + 1].startsWith('--')) throw new Phase3AError('invalid_arguments', 'arguments must be --name value pairs')
    const name = values[index].slice(2)
    if (!allowed.has(name)) throw new Phase3AError('invalid_arguments', `unknown argument: --${name}`)
    if (output[name] !== undefined) throw new Phase3AError('invalid_arguments', `duplicate argument: --${name}`)
    output[name] = values[index + 1]
  }
  return output
}

export function artifactSetDigest(rows: Array<Record<string, any>>, sensitivity?: string): string {
  const selected = rows
    .filter((row) => sensitivity === undefined || row.sensitivity === sensitivity)
    .map((row) => ({ artifact_id: row.artifact_id, sha256: row.sha256, byte_size: row.byte_size, parent_artifact_ids: row.parent_artifact_ids }))
    .sort((left, right) => left.artifact_id.localeCompare(right.artifact_id))
  return sha256Bytes(canonicalJson(selected))
}

export function assertAppendOnlyArtifactRows(previous: Array<Record<string, any>>, current: Array<Record<string, any>>): void {
  const byId = new Map(current.map((row) => [String(row.artifact_id), row]))
  for (const old of previous) {
    const row = byId.get(String(old.artifact_id))
    if (!row) throw new Phase3AError('artifact_index_not_append_only', `artifact row disappeared: ${String(old.artifact_id)}`)
    if (canonicalJson(row) !== canonicalJson(old)) throw new Phase3AError('artifact_index_not_append_only', `artifact row changed: ${String(old.artifact_id)}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const values = parseTerminalIndexArgs(process.argv.slice(2))
    const rootInput = values['evidence-root']; const outInput = values.out
    if (!rootInput || !outInput) throw new Phase3AError('invalid_arguments', '--evidence-root and --out are required')
    const root = ensureEvidenceRoot(rootInput)
    const out = assertEvidencePath(root, outInput)
    const previousArgument = values['previous-index']
    if (!previousArgument) throw new Phase3AError('invalid_arguments', '--previous-index is required for append-only terminal indexing')
    const previous = assertEvidencePath(root, previousArgument)
    const candidates = readdirSync(path.dirname(out)).filter((name) => /^artifact-index-v\d+\.json$/.test(name) && path.resolve(path.dirname(out), name) !== out)
    const latest = candidates.sort((left, right) => Number(right.match(/\d+/)?.[0]) - Number(left.match(/\d+/)?.[0]))[0]
    if (!latest || previous !== path.join(path.dirname(out), latest)) throw new Phase3AError('artifact_index_not_append_only', 'previous index must be the latest versioned index in the output directory')
    const index = buildArtifactIndex({ evidenceRoot: root, evidenceRootId: path.basename(root), generatedAt: '2026-07-20T12:00:00.000Z', previousIndexSha256: sha256File(previous), toolchainDigest: TOOLCHAIN, artifacts: terminalArtifactInputs(root) })
    const previousValue = JSON.parse(readFileSync(previous, 'utf8')) as { artifacts?: Array<Record<string, any>> }
    if (!Array.isArray(previousValue.artifacts)) throw new Phase3AError('artifact_index_not_append_only', 'previous artifact index is invalid')
    assertAppendOnlyArtifactRows(previousValue.artifacts, index.artifacts as Array<Record<string, any>>)
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
    const digest = writeArtifactIndex(index, out)
    const artifacts = index.artifacts as Array<Record<string, any>>
    process.stdout.write(`${canonicalJson({
      artifacts: artifacts.length, sha256: digest, indexed_bytes: artifacts.reduce((total, row) => total + Number(row.byte_size), 0),
      all_evidence_digest: artifactSetDigest(artifacts), normalized_safe_digest: artifactSetDigest(artifacts, 'normalized-safe'), raw_quarantine_digest: artifactSetDigest(artifacts, 'quarantine'),
      aggregate_algorithm: 'canonical-artifact-set-v1',
    })}\n`)
  } catch (error) { process.stderr.write(`${canonicalJson(stableError(error))}\n`); process.exitCode = 1 }
}
