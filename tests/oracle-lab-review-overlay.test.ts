import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const documents = {
  review: 'docs/superpowers/specs/2026-07-12-claude-code-2.1.207-oracle-lab-review-amendments.md',
  hardening: 'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-hardening-amendments.md',
  adversarial: 'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-adversarial-validation-v2.md',
  design: 'docs/superpowers/specs/2026-07-11-claude-code-2.1.207-oracle-lab-design.md',
} as const

const canonicalRegistry = 'docs/superpowers/registry/oracle-lab-requirements.json'
const preservedRegistryV1 = 'docs/superpowers/registry/oracle-lab-requirements-v1.json'
const forbiddenVersionedRegistryV2 = 'docs/superpowers/registry/oracle-lab-requirements-v2.json'
const roadmapPath = 'docs/superpowers/roadmaps/2026-07-11-claude-code-2.1.207-oracle-lab-roadmap.md'
const precedence = [
  documents.review,
  documents.hardening,
  documents.adversarial,
  documents.design,
]
const authoritativeDag = [
  'P0 -> P1 --------------------------+',
  '  \\-> P2 -> P3A -> P3B/3.5 -------+-> P4 -> P5 -> P6A -> approval -> P6B',
].join('\n')
const staleRegistryStatus = /pending[^\n]*Task 2[^\n]*Task 3|canonical (?:requirement )?registry[^\n]*(?:schema )?v1/i

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8')
}

function statusOverlay(markdown: string): string {
  const match = markdown.match(/^## Status\s*$([\s\S]*?)(?=^##\s|\Z)/m)
  assert.ok(match, 'missing ## Status overlay')
  return match[1]
}

function section(markdown: string, start: string, end: string): string {
  const startIndex = markdown.indexOf(start)
  const endIndex = markdown.indexOf(end, startIndex + start.length)
  assert.ok(startIndex >= 0, `missing section start: ${start}`)
  assert.ok(endIndex > startIndex, `missing section end: ${end}`)
  return markdown.slice(startIndex, endIndex)
}

function assertInOrder(haystack: string, needles: readonly string[], message: string): void {
  let cursor = -1
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1)
    assert.ok(next > cursor, `${message}: missing or out of order: ${needle}`)
    cursor = next
  }
}

function assertCompletedRegistryAdoption(name: string, overlay: string): void {
  for (const requiredPath of [...precedence, canonicalRegistry, preservedRegistryV1]) {
    assert.ok(overlay.includes(requiredPath), `${name} Status overlay missing ${requiredPath}`)
  }
  assert.ok(!overlay.includes(forbiddenVersionedRegistryV2), `${name} invents a versioned Registry v2 path`)
  assertInOrder(overlay, precedence, `${name} precedence`)
  assert.match(overlay, /schema v2[^\n]*exactly 41 homogeneous records/i, `${name} must bind the canonical 41-record Registry v2`)
  assert.match(overlay, /immutable 23-row migration source and evidence/i, `${name} must preserve the immutable Registry v1 migration source`)
  assert.match(overlay, /Tasks 2 and 3 completed[^\n]*Registry v2 migration[^\n]*explicit conflict registration[^\n]*exact 18 RA records/i, `${name} must record completed reviewed adoption`)
  assert.match(overlay, /all 18 RA records remain `deferred`[^\n]*does not imply implementation, production verification, canary approval, or runtime authority/i, `${name} must keep RA authority deferred`)
  assert.match(overlay, /no conflict, requirement, or authority statement may be silently replaced or superseded/i, `${name} must prohibit silent replacement`)
  assert.doesNotMatch(overlay, staleRegistryStatus, `${name} retains stale pending or canonical-v1 wording`)
}

test('every specification Status overlay records completed Registry v2 governance adoption', () => {
  for (const [name, relativePath] of Object.entries(documents)) {
    assertCompletedRegistryAdoption(name, statusOverlay(read(relativePath)))
  }
})

test('roadmap preserves seven top-level phases and the authoritative dependency DAG', () => {
  const roadmap = read(roadmapPath)
  const topLevelPhases = [...roadmap.matchAll(/^## Phase ([0-6]):/gm)].map((match) => match[1])
  assert.deepEqual(topLevelPhases, ['0', '1', '2', '3', '4', '5', '6'])
  assert.match(roadmap, /^### Phase 3A:/m)
  assert.match(roadmap, /^### Phase 3B\/3\.5:/m)
  assert.match(roadmap, /mandatory bridge/i)
  assert.ok(roadmap.includes(authoritativeDag), 'roadmap is missing the authoritative P0-P6B DAG')
})

test('roadmap assigns boundary work and work-package slices to the owning phase', () => {
  const roadmap = read(roadmapPath)
  assert.match(roadmap, /B1-B3[^\n]*Phase 1/i)
  assert.match(roadmap, /loopback[^\n]*remote-listen[^\n]*fail-closed/i)
  assert.match(roadmap, /B4-B6[^\n]*Phase 2[^\n]*contract/i)
  assert.match(roadmap, /B4-B6[^\n]*Phase 4[^\n]*runtime/i)
  assert.match(roadmap, /traceability umbrellas/i)
  assert.match(roadmap, /no plan may cross a phase gate/i)
  for (let index = 0; index <= 9; index += 1) {
    assert.match(roadmap, new RegExp('\\| `WP-R' + index + '` \\|'), `missing WP-R${index} phase slice`)
  }
})

test('roadmap assigns AV-B4 evidence only to the CC Gateway direct-egress fixture', () => {
  const roadmap = read(roadmapPath)
  const avB4 = roadmap.split('\n').find((line) => line.startsWith('| AV-B4-001 |'))
  assert.ok(avB4, 'missing AV-B4 decision row')
  assert.match(avB4, /`cc-b4-b6-red` result/)
  assert.match(avB4, /Local CC Gateway formal-pool direct-egress fixture/)
  assert.doesNotMatch(avB4, /sidecar-b4-b6-red|sidecar-owner/)
})

test('Phase 1 owns only B1-B3 and the fail-closed listener startup boundary', () => {
  const roadmap = read(roadmapPath)
  const phase1 = section(roadmap, '## Phase 1:', '## Phase 2:')
  assert.match(phase1, /B1-B3/i)
  assert.match(phase1, /loopback[^\n]*remote-listen[^\n]*fail-closed/i)
  assert.doesNotMatch(phase1, /\bB[456]\b|direct-egress|sidecar|destination|DNS|resolve|pin|dial/i)
})

test('Phase 3B local conformance is separate from signed staging and canary approval', () => {
  const roadmap = read(roadmapPath)
  assert.match(roadmap, /Phase 3B\/3\.5[^\n]*(?:compiler|config|fixture|local conformance)/i)
  assert.match(roadmap, /Phase 6A[^\n]*signed[^\n]*(?:complete|full)[^\n]*staging/i)
  assert.match(roadmap, /Phase 6B[^\n]*(?:separate|separately)[^\n]*approv[^\n]*canary/i)
  assert.match(roadmap, /environment fingerprint[^\n]*Phase 3A/i)
})

test('roadmap records the exact P0.1 to P1 integration sequence', () => {
  const roadmap = read(roadmapPath)
  assert.ok(roadmap.includes('P0.1 branch receipt -> merge both repository branches -> prove local main equals muqihang/main -> verify P0.1 artifact/fix ancestry on integrated heads -> fresh P1 entry baseline/context -> P1 detailed plan'))
})

test('roadmap treats Phase 0 planning as completed history and keeps only the P0.1-to-P1 next plan', () => {
  const roadmap = read(roadmapPath)
  for (const activeImperative of [
    'Write the Phase 0 implementation plan only.',
    'Review and execute Phase 0.',
    'the first detailed plan is limited to Phase 0',
  ]) {
    assert.ok(!roadmap.includes(activeImperative), `roadmap reopens completed Phase 0: ${activeImperative}`)
  }
  assert.match(roadmap, /historical Phase 0 planning record[^\n]*complete/i)
  assert.match(roadmap, /current next plan[^\n]*P0\.1 branch receipt/i)
})

test('protected Gateway consumes an independently issued transport capability without owning authorization', () => {
  const amendment = read(documents.review)
  const executive = section(amendment, '## 1. Executive Decision', '## 2. Evidence and Claim Boundary')
  assert.ok(!executive.includes('single-request transport authorization authority'))
  assert.match(executive, /Gateway[^\n]*consumes[^\n]*constrains[^\n]*independently issued[^\n]*single-request transport capabilit/i)
  assert.match(amendment, /broker and sidecar produce independently verifiable transport-authorization/i)
})

test('roadmap records completed conflict registration and Registry v2 RA governance adoption', () => {
  const roadmap = read(roadmapPath)
  const overlay = statusOverlay(roadmap)
  const relationship = section(roadmap, '## Normative Relationship', '## Delivery Rules')
  assertCompletedRegistryAdoption('roadmap', overlay)
  assert.match(relationship, /Tasks 2 and 3 completed[^\n]*Registry v2 migration[^\n]*explicit conflict registration[^\n]*exact 18 RA records/i)
  assert.match(relationship, /all 18 RA records remain `deferred`[^\n]*does not imply implementation, production verification, canary approval, or runtime authority/i)
  assert.match(relationship, /no conflict, requirement, or authority statement may be silently replaced or superseded/i)
  assert.doesNotMatch(relationship, staleRegistryStatus)
  assert.ok(overlay.includes('P0.1 implementation candidate; completion is controlled exclusively by the successor receipt; P1 remains blocked by the integrated-main entry gates.'))
})
