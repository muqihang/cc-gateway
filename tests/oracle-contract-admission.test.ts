import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { decideBehaviorAdmission } from '../src/oracle-contract/admission.js'
import { canonicalizeJsonValue, sha256Hex } from '../src/oracle-contract/canonical.js'
import type { AdmissionContext, BehaviorCoherenceCertificate } from '../src/oracle-contract/types.js'

type Mutation = { target: 'certificate' | 'context'; set?: string; remove?: string; add?: string; value?: unknown }
type Corpus = {
  base_certificate: BehaviorCoherenceCertificate
  base_context: AdmissionContext
  negative_capabilities: AdmissionContext['negativeCapabilities']
  cases: Array<{ id: string; mutation: Mutation | null; expected_code: string }>
}

const corpus = JSON.parse(readFileSync(path.resolve('contracts/oracle-lab/v1/coherence-corpus.json'), 'utf8')) as Corpus

function payloadDigest(certificate: unknown, context: AdmissionContext): string {
  return sha256Hex(canonicalizeJsonValue({
    certificate,
    negative_capabilities: context.negativeCapabilities,
    signals: context.signals,
  }))
}

function parentAt(root: Record<string, unknown>, dotted: string): { parent: Record<string, unknown>; key: string } {
  const parts = dotted.split('.')
  const key = parts.pop() as string
  let current: unknown = root
  for (const part of parts) {
    current = Array.isArray(current) ? current[Number(part)] : (current as Record<string, unknown>)[part]
  }
  return { parent: current as Record<string, unknown>, key }
}

test('admission rejects a certificate or signals not bound by the verified manifest payload digest', () => {
  const certificate = structuredClone(corpus.base_certificate)
  const context = structuredClone(corpus.base_context)
  context.negativeCapabilities = structuredClone(corpus.negative_capabilities)
  ;(context.expected as AdmissionContext['expected'] & { manifest_payload_digest: string }).manifest_payload_digest = payloadDigest(certificate, context)
  certificate.persona_ref = 'persona:attacker-selected'
  const decision = decideBehaviorAdmission(certificate, context)
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, 'admission_manifest_payload_mismatch')
})

function mutate(root: Record<string, unknown>, mutation: Mutation): void {
  if (mutation.remove) {
    const target = parentAt(root, mutation.remove)
    delete target.parent[target.key]
  } else if (mutation.add) {
    root[mutation.add] = true
  } else if (mutation.set) {
    const target = parentAt(root, mutation.set)
    target.parent[target.key] = structuredClone(mutation.value)
  }
}

for (const fixture of corpus.cases) {
  test(`admission corpus: ${fixture.id}`, () => {
    const certificate = structuredClone(corpus.base_certificate) as unknown as Record<string, unknown>
    const context = structuredClone(corpus.base_context) as unknown as Record<string, unknown>
    context.negativeCapabilities = structuredClone(corpus.negative_capabilities)
    if (fixture.mutation) mutate(fixture.mutation.target === 'certificate' ? certificate : context, fixture.mutation)
    ;((context as unknown as AdmissionContext).expected).manifest_payload_digest = payloadDigest(certificate, context as unknown as AdmissionContext)
    let boundaryCalls = 0
    const decision = decideBehaviorAdmission(
      certificate,
      context as unknown as AdmissionContext,
      () => { boundaryCalls += 1 },
    )
    assert.equal(decision.code, fixture.expected_code)
    assert.equal(decision.allowed, fixture.expected_code === 'admission_allow')
    assert.equal(boundaryCalls, decision.allowed ? 1 : 0)
    if (!decision.allowed) assert.ok(decision.action === 'disable' || decision.action === 'rollback')
  })
}
