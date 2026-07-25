import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  spawnNormalizedSafeReceiver,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/wire-receiver.js'
import { validateEvidenceArtifact } from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'
import { buildActiveAnchorFixture } from './oracle-phase3b-evidence-anchor-fixture.js'

const ACTIVE_STATIC_ANCHOR_SHA256 = 'd'.repeat(64)

const literals = {
  'model.test': 'claude-synthetic-1',
  'prompt.alpha': 'SYNTHETIC PROMPT ALPHA',
  'output.complete': 'SYNTHETIC OUTPUT COMPLETE',
  'error.synthetic': 'SYNTHETIC ERROR',
}

test('receiver rejects caller-only fabricated anchor before binding loopback', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-receiver-unbound-anchor-'))
  mkdirSync(path.join(root, 'capsules/P3B-ES1/observations/receiver'), { recursive: true, mode: 0o700 })
  let outcome: 'rejected' | 'resolved' = 'rejected'
  try {
    const receiver = await spawnNormalizedSafeReceiver({
      evidence_root: root,
      output_relative_prefix: 'capsules/P3B-ES1/observations/receiver',
      campaign_id: 'p3b-es1-test', cell_id: 'cell-unbound', pair_id: 'wire-unbound', arm: 'uninstrumented',
      repetition: 0, deterministic_seed: 215001, sequence_index: 0,
      active_static_anchor_sha256: ACTIVE_STATIC_ANCHOR_SHA256,
      base_url_provenance_ref: 'control/campaign-input.json', scenario_id: 'complete_sse', literal_table: literals,
      synthetic_auth_markers: {}, limits: { body_bytes: 8_388_608, headers: 256, events: 1024, attempts: 8 }, max_requests: 1,
    })
    outcome = 'resolved'
    await receiver.close()
  } catch (error) {
    assert.equal((error as { code?: string }).code, 'source_binding_invalid')
  }
  assert.equal(outcome, 'rejected')
})

function sendRaw(port: number, request: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => socket.end(request))
    socket.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    socket.once('end', () => resolve(Buffer.concat(chunks)))
    socket.once('error', reject)
  })
}

test('loopback receiver is sole wire leaf writer and emits normalized-safe observation', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-receiver-'))
  const fixture = buildActiveAnchorFixture(root)
  const receiver = await spawnNormalizedSafeReceiver({
    evidence_root: root,
    output_relative_prefix: 'capsules/P3B-ES1/observations/receiver',
    campaign_id: 'p3b-es1-test', cell_id: 'cell-1', pair_id: 'wire-prompt-only',
    arm: 'uninstrumented', repetition: 0, deterministic_seed: 215001, sequence_index: 0,
    active_static_anchor_sha256: fixture.anchorFile.sha256,
    base_url_provenance_ref: 'control/campaign-input.json',
    scenario_id: 'complete_sse', literal_table: literals,
    synthetic_auth_markers: { api_key_a: 'Bearer SYNTHETIC-AUTH-A' },
    limits: { body_bytes: 8_388_608, headers: 256, events: 1024, attempts: 8 },
    max_requests: 1,
  })
  assert.equal(receiver.host, '127.0.0.1')

  const body = Buffer.from(JSON.stringify({ model: literals['model.test'], messages: [{ role: 'user', content: literals['prompt.alpha'] }], stream: true }))
  const requestHead = Buffer.from([
    'POST /v1/messages HTTP/1.1',
    'X-Trace: one',
    'Authorization: Bearer SYNTHETIC-AUTH-A',
    'X-Trace: two',
    'Content-Type: application/json',
    `Content-Length: ${body.length}`,
    'Host: 127.0.0.1',
    'Connection: close',
    '',
    '',
  ].join('\r\n'))
  const responseBytes = await sendRaw(receiver.port, Buffer.concat([requestHead, body]))
  assert.match(responseBytes.toString('utf8', 0, Math.min(responseBytes.length, 64)), /^HTTP\/1\.1 200 /)
  responseBytes.fill(0)
  await receiver.done

  const observation = JSON.parse(readFileSync(path.join(root, receiver.observation_relative_paths[0]), 'utf8')) as Record<string, unknown>
  assert.deepEqual(observation.ordered_header_names, ['x-trace', 'authorization', 'x-trace', 'content-type', 'content-length', 'host', 'connection'])
  assert.equal(observation.raw_material_persisted, false)
  assert.equal(observation.receiver_authority, 'wire-leaf-exclusive')
  assert.equal(observation.receiver_process_digest, fixture.identity.digest)
  assert.equal(observation.receiver_source_sha256, fixture.identity.source_sha256)
  assert.equal(observation.active_static_anchor_sha256, fixture.anchorFile.sha256)
  assert.doesNotMatch(JSON.stringify(observation), /SYNTHETIC-AUTH-A|SYNTHETIC PROMPT ALPHA|SYNTHETIC OUTPUT COMPLETE/)
  assert.deepEqual(validateEvidenceArtifact('receiver-observation.schema.json', observation), { allowed: true, code: 'admission_allow' })
  const responseProjection = observation.response_projection as Record<string, unknown>
  assert.deepEqual(validateEvidenceArtifact('receiver-observation.schema.json', {
    ...observation,
    response_projection: { ...responseProjection, unexpected: true },
  }), { allowed: false, code: 'schema_invalid' })
})

test('receiver rejects body and attempt overflow with stable codes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-receiver-limit-'))
  const fixture = buildActiveAnchorFixture(root)
  const receiver = await spawnNormalizedSafeReceiver({
    evidence_root: root,
    output_relative_prefix: 'capsules/P3B-ES1/observations/receiver',
    campaign_id: 'p3b-es1-test', cell_id: 'cell-limit', pair_id: 'wire-limit', arm: 'uninstrumented',
    repetition: 0, deterministic_seed: 215001, sequence_index: 0,
    active_static_anchor_sha256: fixture.anchorFile.sha256,
    base_url_provenance_ref: 'control/campaign-input.json', scenario_id: 'complete_sse', literal_table: literals,
    synthetic_auth_markers: {}, limits: { body_bytes: 8, headers: 256, events: 1024, attempts: 1 }, max_requests: 1,
  })
  const overflowRequest = Buffer.from('POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 9\r\nConnection: close\r\n\r\n123456789')
  const overflowResponse = await sendRaw(receiver.port, overflowRequest)
  assert.match(overflowResponse.toString('utf8'), /^HTTP\/1\.1 413 /)
  assert.match(overflowResponse.toString('utf8'), /x-oracle-deny-code: receiver_body_overflow/i)
  overflowResponse.fill(0)
  await receiver.done
})

test('campaign receiver runs as a separate process and remains the exclusive writer', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'p3b-es-receiver-child-'))
  const fixture = buildActiveAnchorFixture(root)
  const receiver = await spawnNormalizedSafeReceiver({
    evidence_root: root,
    output_relative_prefix: 'capsules/P3B-ES1/observations/receiver',
    campaign_id: 'p3b-es1-test', cell_id: 'cell-child', pair_id: 'wire-child', arm: 'instrumented',
    repetition: 0, deterministic_seed: 215001, sequence_index: 1,
    active_static_anchor_sha256: fixture.anchorFile.sha256,
    base_url_provenance_ref: 'control/campaign-input.json', scenario_id: 'complete_sse', literal_table: literals,
    synthetic_auth_markers: {}, limits: { body_bytes: 8_388_608, headers: 256, events: 1024, attempts: 8 }, max_requests: 1,
  })
  assert.notEqual(receiver.child.pid, process.pid)
  const body = Buffer.from(JSON.stringify({ model: literals['model.test'], messages: [], stream: true }))
  const head = Buffer.from(`POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`)
  const response = await sendRaw(receiver.port, Buffer.concat([head, body]))
  assert.match(response.toString('utf8', 0, Math.min(64, response.length)), /^HTTP\/1\.1 200 /)
  response.fill(0)
  await receiver.done
  assert.deepEqual(receiver.observation_relative_paths, ['capsules/P3B-ES1/observations/receiver/cell-child-attempt-0.json'])
})
