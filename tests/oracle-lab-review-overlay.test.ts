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

const registryV2 = 'docs/superpowers/registry/oracle-lab-requirements-v2.json'
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

function read(relativePath: string): string {
  return readFileSync(path.resolve(relativePath), 'utf8')
}

function statusOverlay(markdown: string): string {
  const match = markdown.match(/^## Status\s*$([\s\S]*?)(?=^##\s|\Z)/m)
  assert.ok(match, 'missing ## Status overlay')
  return match[1]
}

function assertInOrder(haystack: string, needles: readonly string[], message: string): void {
  let cursor = -1
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1)
    assert.ok(next > cursor, `${message}: missing or out of order: ${needle}`)
    cursor = next
  }
}

test('every specification Status overlay names all authorities and Registry v2', () => {
  for (const [name, relativePath] of Object.entries(documents)) {
    const overlay = statusOverlay(read(relativePath))
    for (const requiredPath of [...precedence, registryV2]) {
      assert.ok(overlay.includes(requiredPath), `${name} Status overlay missing ${requiredPath}`)
    }
    assertInOrder(overlay, precedence, `${name} precedence`)
    assert.match(overlay, /conflict[^\n]*(?:register|registry)/i, `${name} must register conflicts explicitly`)
    assert.match(overlay, /(?:no|never)[^\n]*silently/i, `${name} must prohibit silent replacement`)
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
