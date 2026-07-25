import assert from 'node:assert/strict'
import { chmodSync, linkSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { comparePairedObservations } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import {
  assertActiveStaticAnchorAuthorityStable,
  assertReceiverExecutableIdentity,
  receiverExecutableIdentityFromFiles,
  resolveActiveStaticAnchorAuthority,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/static-anchor.js'
import { buildActiveAnchorFixture } from './oracle-phase3b-evidence-anchor-fixture.js'

const fakeSha = (character: string) => character.repeat(64)
const root = (label: string) => mkdtempSync(path.join(os.tmpdir(), `p3b-es-anchor-${label}-`))

function verify(fixture: ReturnType<typeof buildActiveAnchorFixture>, expected = fixture.anchorFile.sha256) {
  return resolveActiveStaticAnchorAuthority({
    evidence_root: fixture.root,
    expected_campaign_id: fixture.campaign_id,
    expected_active_static_anchor_sha256: expected,
  })
}

function deny(action: () => unknown, code?: string): void {
  assert.throws(action, (error: unknown) => !code || (error as { code?: string }).code === code)
}

function observation(binding: ReturnType<typeof verify>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    arm: 'uninstrumented', cell_id: 'cell-a', sequence_index: 0, repetition: 0, connection_ordinal: 0,
    receiver_process_digest: binding.receiver_identity.digest, receiver_source_sha256: binding.receiver_identity.source_sha256,
    active_static_anchor_sha256: binding.active_static_anchor_sha256, pair_id: 'wire-pair', deterministic_seed: 215001,
    authority_class: 'synthetic-loopback', method: 'POST', path: '/v1/messages', ordered_header_names: ['content-type'],
    header_multiplicity: { 'content-type': 1 }, auth_marker_winner_class: 'absent', canonical_body_sha256: fakeSha('a'),
    typed_request_ast: { safe: true }, attempt_ordinal: 0, scenario_action_ordinal: 0, response_program_ref: 'complete_sse',
    response_projection: { terminal_event: 'message_stop' }, wire_action_completed: true, raw_material_persisted: false,
    ...overrides,
  }
}

test('valid selection derives the active anchor and exact receiver runtime tuple', () => {
  const fixture = buildActiveAnchorFixture(root('valid'))
  const binding = verify(fixture)
  assert.equal(binding.active_static_anchor_sha256, fixture.anchorFile.sha256)
  assert.equal(binding.selection_sha256, fixture.selectionFile.sha256)
  assert.deepEqual(binding.receiver_identity, fixture.identity)
  assert.doesNotThrow(() => assertActiveStaticAnchorAuthorityStable(binding))
})

test('same fabricated caller SHA is rejected for both arms', () => {
  const fixture = buildActiveAnchorFixture(root('fabricated'))
  for (const _arm of ['instrumented', 'uninstrumented']) deny(() => verify(fixture, fakeSha('0')), 'paired_perturbation')
})

test('stale caller digest and selected anchor digest mismatch remain distinct failures', () => {
  const staleCaller = buildActiveAnchorFixture(root('stale-caller'))
  deny(() => verify(staleCaller, fakeSha('1')), 'paired_perturbation')

  const staleSelection = buildActiveAnchorFixture(root('stale-selection'), {
    mutators: { selection: (value) => { value.active_anchor.sha256 = fakeSha('2') } },
  })
  deny(() => verify(staleSelection, fakeSha('2')), 'paired_perturbation')
})

test('missing selection and missing selected anchor fail before receiver authority exists', () => {
  const missingSelection = buildActiveAnchorFixture(root('missing-selection'), { materialize_selection: 'missing' })
  deny(() => verify(missingSelection), 'source_binding_invalid')
  const missingAnchor = buildActiveAnchorFixture(root('missing-anchor'), { materialize_anchor: 'missing' })
  deny(() => verify(missingAnchor), 'source_binding_invalid')
})

test('malformed and noncanonical selection or anchor bytes fail closed', () => {
  const malformedSelection = buildActiveAnchorFixture(root('malformed-selection'), { mutators: { selection: (value) => { value.unexpected = true } } })
  deny(() => verify(malformedSelection), 'schema_invalid')
  const malformedAnchor = buildActiveAnchorFixture(root('malformed-anchor'), { mutators: { anchor: (value) => { value.unexpected = true } } })
  deny(() => verify(malformedAnchor), 'schema_invalid')
  const noncanonicalSelection = buildActiveAnchorFixture(root('noncanonical-selection'), { materialize_selection: 'noncanonical' })
  deny(() => verify(noncanonicalSelection), 'json_noncanonical')
  const noncanonicalAnchor = buildActiveAnchorFixture(root('noncanonical-anchor'), { materialize_anchor: 'noncanonical' })
  deny(() => verify(noncanonicalAnchor), 'json_noncanonical')
})

test('selection and selected anchor symlinks or unsafe paths fail closed', () => {
  const selectionLink = buildActiveAnchorFixture(root('selection-link'), { materialize_selection: 'symlink' })
  deny(() => verify(selectionLink), 'source_binding_invalid')
  const anchorLink = buildActiveAnchorFixture(root('anchor-link'), { materialize_anchor: 'symlink' })
  deny(() => verify(anchorLink), 'source_binding_invalid')
  const traversal = buildActiveAnchorFixture(root('path-traversal'), { mutators: { selection: (value) => { value.active_anchor.relative_path = '../escape.json' } } })
  deny(() => verify(traversal), 'source_binding_invalid')
  const backslash = buildActiveAnchorFixture(root('path-backslash'), { mutators: { selection: (value) => { value.active_anchor.relative_path = 'capsules\\P3B-ES1\\control\\static-anchor.json' } } })
  deny(() => verify(backslash), 'source_binding_invalid')
})

test('selection and anchor require 0600 single-link files beneath 0700 directories', () => {
  const looseSelection = buildActiveAnchorFixture(root('selection-mode'))
  chmodSync(looseSelection.selectionFile.path, 0o644)
  deny(() => verify(looseSelection), 'source_binding_invalid')
  const looseAnchor = buildActiveAnchorFixture(root('anchor-mode'))
  chmodSync(looseAnchor.anchorFile.path, 0o644)
  deny(() => verify(looseAnchor), 'source_binding_invalid')
  const linkedSelection = buildActiveAnchorFixture(root('selection-hardlink'))
  linkSync(linkedSelection.selectionFile.path, `${linkedSelection.selectionFile.path}.alias`)
  deny(() => verify(linkedSelection), 'source_binding_invalid')
  const linkedAnchor = buildActiveAnchorFixture(root('anchor-hardlink'))
  linkSync(linkedAnchor.anchorFile.path, `${linkedAnchor.anchorFile.path}.alias`)
  deny(() => verify(linkedAnchor), 'source_binding_invalid')
})

test('superseded active anchor is rejected', () => {
  const fixture = buildActiveAnchorFixture(root('superseded'), {
    mutators: { selection: (value) => { value.superseded_anchors = [structuredClone(value.active_anchor)] } },
  })
  deny(() => verify(fixture), 'paired_perturbation')
})

test('anchor receiver identity mismatch and source tuple drift are rejected', () => {
  const mismatch = buildActiveAnchorFixture(root('receiver-mismatch'), {
    mutators: { anchor: (value) => { value.receiver_executable_sha256 = fakeSha('4') } },
  })
  deny(() => verify(mismatch), 'paired_perturbation')

  const runtimeRoot = root('runtime-drift')
  const files = {
    source_file: path.join(runtimeRoot, 'receiver.ts'), launcher_file: path.join(runtimeRoot, 'node'), loader_file: path.join(runtimeRoot, 'loader.mjs'),
  }
  for (const file of Object.values(files)) writeFileSync(file, 'frozen', { mode: 0o600, flag: 'wx' })
  const identity = receiverExecutableIdentityFromFiles(files)
  writeFileSync(files.source_file, 'changed', { mode: 0o600 })
  deny(() => assertReceiverExecutableIdentity(identity, files), 'paired_perturbation')
})

test('wrong campaign, repository, artifact, or schema bundle binding is rejected', () => {
  const cases = [
    buildActiveAnchorFixture(root('wrong-campaign'), { mutators: { anchor: (value) => { value.campaign_id = 'p3b-es1-other' } } }),
    buildActiveAnchorFixture(root('wrong-repository'), { mutators: { anchor: (value) => { value.repositories.cc_gateway.commit = '5'.repeat(40) } } }),
    buildActiveAnchorFixture(root('wrong-artifact'), { mutators: { anchor: (value) => { value.artifact.entrypoint_sha256 = fakeSha('6') } } }),
    buildActiveAnchorFixture(root('wrong-schema-bundle'), { mutators: { anchor: (value) => { value.schema_bundle.sha256 = fakeSha('7'); value.schema_bundle_sha256 = fakeSha('7') } } }),
  ]
  for (const fixture of cases) deny(() => verify(fixture))
})

test('validated authority replacement is detected before later use', () => {
  const fixture = buildActiveAnchorFixture(root('toctou'))
  const binding = verify(fixture)
  writeFileSync(fixture.selectionFile.path, `${JSON.stringify(fixture.selection)}\n`, { mode: 0o600 })
  deny(() => assertActiveStaticAnchorAuthorityStable(binding), 'source_binding_invalid')
})

test('same verified anchor permits run identity differences, different verified anchors deny', () => {
  const firstFixture = buildActiveAnchorFixture(root('pair-first'))
  const first = verify(firstFixture)
  const peer = observation(first, { arm: 'instrumented', cell_id: 'cell-b', sequence_index: 9, repetition: 4, connection_ordinal: 7 })
  assert.deepEqual(comparePairedObservations(observation(first), peer), { equivalent: true, differing_pointers: [] })

  const secondFixture = buildActiveAnchorFixture(root('pair-second'), {
    mutators: { anchor: (value) => { value.probe_copy.patch_after_sha256 = fakeSha('8') } },
  })
  const second = verify(secondFixture)
  deny(() => comparePairedObservations(observation(first), observation(second, { arm: 'instrumented' })), 'paired_perturbation')
})
