import assert from 'node:assert/strict'
import test from 'node:test'

import {
  materializeRequestBody,
  normalizeWireRequest,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/normalize-request.js'
import { validateEvidenceArtifact } from '../tools/oracle-lab/phase3b-evidence-sufficiency/schemas.js'

const literals = {
  'model.test': 'claude-synthetic-1',
  'prompt.alpha': 'SYNTHETIC PROMPT ALPHA',
  'system.alpha': 'SYNTHETIC SYSTEM ALPHA',
  'tool.name': 'safe_lookup',
  'tool.description': 'Synthetic lookup only',
}

test('request normalizer preserves header order and multiplicity without values', () => {
  const body = Buffer.from(JSON.stringify({
    model: literals['model.test'],
    max_tokens: 16,
    messages: [{ role: 'user', content: [{ type: 'text', text: literals['prompt.alpha'] }] }],
    system: [{ type: 'text', text: literals['system.alpha'] }],
    stream: true,
  }))
  const normalized = normalizeWireRequest({
    method: 'POST',
    request_target: '/v1/messages?beta=one&beta=two',
    raw_headers: [
      'X-Trace', 'first',
      'Authorization', 'Bearer SYNTHETIC-AUTH-A',
      'X-Trace', 'second',
      'Content-Type', 'application/json; charset=utf-8',
      'Content-Length', String(body.length),
    ],
    body,
    literal_table: literals,
    synthetic_auth_markers: { api_key_a: 'Bearer SYNTHETIC-AUTH-A' },
    limits: { body_bytes: 8_388_608, headers: 256 },
  })

  assert.deepEqual(normalized.ordered_header_names, ['x-trace', 'authorization', 'x-trace', 'content-type', 'content-length'])
  assert.deepEqual(normalized.header_multiplicity, { authorization: 1, 'content-length': 1, 'content-type': 1, 'x-trace': 2 })
  assert.equal(normalized.safe_header_value_classes[1], 'synthetic-marker:api_key_a')
  assert.equal(normalized.auth_marker_winner_class, 'api_key_a')
  assert.equal(normalized.raw_material_persisted, false)
  assert.doesNotMatch(JSON.stringify(normalized), /SYNTHETIC-AUTH-A|SYNTHETIC PROMPT ALPHA/)
})

test('typed request AST materializes to the canonical body digest', () => {
  const body = Buffer.from('{"stream":true,"messages":[{"role":"user","content":"SYNTHETIC PROMPT ALPHA"}],"model":"claude-synthetic-1"}')
  const normalized = normalizeWireRequest({
    method: 'POST', request_target: '/v1/messages',
    raw_headers: ['Content-Type', 'application/json'], body,
    literal_table: literals, synthetic_auth_markers: {},
    limits: { body_bytes: 8_388_608, headers: 256 },
  })
  const materialized = materializeRequestBody(normalized.typed_request_ast, literals)
  assert.equal(materialized.sha256, normalized.canonical_body_sha256)
  assert.equal(materialized.materializable, true)
  assert.deepEqual(normalized.typed_request_ast.top_level_order, ['stream', 'messages', 'model'])
  assert.deepEqual(validateEvidenceArtifact('request-ast.schema.json', normalized.typed_request_ast), { allowed: true, code: 'admission_allow' })
  assert.deepEqual(validateEvidenceArtifact('request-ast.schema.json', {
    ...normalized.typed_request_ast,
    root: { ...normalized.typed_request_ast.root, unexpected: true },
  }), { allowed: false, code: 'schema_invalid' })
})

test('unmatched credential and unmatched body literal fail closed', () => {
  assert.throws(() => normalizeWireRequest({
    method: 'POST', request_target: '/v1/messages',
    raw_headers: ['Authorization', 'Bearer not-campaign-owned'],
    body: Buffer.from('{}'), literal_table: literals, synthetic_auth_markers: {},
    limits: { body_bytes: 8_388_608, headers: 256 },
  }), (error: unknown) => (error as { code?: string }).code === 'leak_detected')

  const normalized = normalizeWireRequest({
    method: 'POST', request_target: '/v1/messages', raw_headers: ['Content-Type', 'application/json'],
    body: Buffer.from('{"model":"unmatched-client-value"}'), literal_table: literals,
    synthetic_auth_markers: {}, limits: { body_bytes: 8_388_608, headers: 256 },
  })
  assert.equal(normalized.typed_request_ast.materializable, false)
  assert.doesNotMatch(JSON.stringify(normalized), /unmatched-client-value/)
  assert.throws(() => materializeRequestBody(normalized.typed_request_ast, literals),
    (error: unknown) => (error as { code?: string }).code === 'request_literal_unmaterializable')
})
