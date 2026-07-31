import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { connect, createServer, type Server } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { main as campaignMain } from '../tools/oracle-lab/phase3b-evidence-sufficiency/campaign.js'
import { executionCompletedAllRows, readPredecessorConclusion, runExecuteFromSealedPrelaunch, sealExecutionAttemptFailure, sealPredecessorConclusion } from '../tools/oracle-lab/phase3b-evidence-sufficiency/campaign-controller.js'
import { SUPPORT_PATHS, deriveCuration, enforcePairAndRepetitionStability, inventoryNamespace, predecessorSupportSourceSha256, projectValidatedObservationForControlStability, runCloseout, validateArtifactIndexCoverage, validateConclusionSupport, validateExternalSet, validateLocalAuthCellTerminal, validateObservationForControlStability, validateObservationRouteAuthorityBindings, validateReceiverAuthorityClosureBindings, validateReceiverOrdinalBindings } from '../tools/oracle-lab/phase3b-evidence-sufficiency/closeout.js'
import { canonicalBytes, canonicalJson, sha256Bytes, sha256Canonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { deriveExecutionCounts, openExecutionStore, readCampaignFailure, readExecutionReceipts, sealPreSpawnFailure } from '../tools/oracle-lab/phase3b-evidence-sufficiency/execution-store.js'
import { BOOTSTRAP_CONTRACT_SCHEMA, CLAUDE_MESSAGES_PATH, CLAUDE_MESSAGES_QUERY_ITEMS, CLAUDE_MESSAGES_QUERY_ORDER, CLAUDE_MESSAGES_REQUEST_TARGET, ES7_REQUEST_FIELDS, ES7_RESPONSE_FIELDS, FIXED_STDIN_LITERAL, FIXED_STDIN_LITERAL_REF, LOCAL_AUTH_RESULT_LITERAL, LOCAL_AUTH_RESULT_SHA256, TARGET_PROFILE, buildCampaignLedger, buildResponseProgram, crossRepoAuthority, materializeResponseBody, observationCoverageMatrix, validateCampaignLedger } from '../tools/oracle-lab/phase3b-evidence-sufficiency/ledger.js'
import { REQUEST_AST_MATERIALIZER, classifyReceiverRequestBoundary, createHardenedReceiverServer, normalizeRequestAst, sendClaudeBootstrapProbeResponse } from '../tools/oracle-lab/phase3b-evidence-sufficiency/receiver.js'
import { classifySyntheticAuthHeader, expectedAuthMarkerClass, prepareScenarioFilesystem } from '../tools/oracle-lab/phase3b-evidence-sufficiency/scenario-input.js'
import { buildSandboxProfile } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sandbox-policy.js'
import { assertPrivateRuntimeRoot, createPrivateDirectory, readCanonical, readCanonicalTransport, stableRead, writeExclusiveCanonical } from '../tools/oracle-lab/phase3b-evidence-sufficiency/sealed-fs.js'
import { expectedBootstrapRoute, expectedSelectedRoute } from '../tools/oracle-lab/phase3b-evidence-sufficiency/route-policy.js'
import { validateCampaignReviewerRegistry, verifyTrustedSignature } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'
import { classifyTargetOutput, sampleOwnedExternalSocketCount } from '../tools/oracle-lab/phase3b-evidence-sufficiency/spawn-adapter.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TEST_C1 = crossRepoAuthority('c'.repeat(64))

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('test listener did not bind'))
      else resolve(address.port)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

test('receiver accepts one empty Claude bootstrap HEAD before the counted messages POST', async () => {
  const row = buildCampaignLedger('p3b-bootstrap-boundary', TEST_C1).rows[0]
  let bootstrapCount = 0
  let observationCount = 0
  const server = createHttpServer((request, response) => {
    try {
      const kind = classifyReceiverRequestBoundary(request, row, bootstrapCount, observationCount)
      if (kind === 'bootstrap_probe') {
        bootstrapCount += 1
        sendClaudeBootstrapProbeResponse(response)
        return
      }
      observationCount += 1
      response.writeHead(200, { 'content-length': '0', connection: 'close' })
      response.end()
    } catch {
      response.destroy()
    }
  })
  const port = await listen(server)
  const exchange = (method: string, requestPath: string, body = ''): Promise<number | null> => new Promise((resolve) => {
    const request = httpRequest({ host: '127.0.0.1', port, method, path: requestPath, headers: body.length === 0 ? undefined : { 'content-length': String(Buffer.byteLength(body)) } }, (response) => {
      response.resume()
      response.once('end', () => resolve(response.statusCode ?? null))
    })
    request.once('error', () => resolve(null))
    request.end(body)
  })
  try {
    assert.equal(await exchange('HEAD', '/'), 200)
    assert.equal(await exchange('POST', '/v1/messages?beta=true', '{}'), 200)
    assert.equal(await exchange('HEAD', '/'), null)
    assert.deepEqual({ bootstrapCount, observationCount }, { bootstrapCount: 1, observationCount: 1 })
  } finally {
    await close(server)
  }
})

test('receiver rejects malformed, repeated, out-of-order, or non-exact bootstrap probes', () => {
  const row = buildCampaignLedger('p3b-bootstrap-rejections', TEST_C1).rows[0]
  assert.equal(CLAUDE_MESSAGES_PATH, '/v1/messages')
  assert.equal(CLAUDE_MESSAGES_REQUEST_TARGET, '/v1/messages?beta=true')
  assert.deepEqual(CLAUDE_MESSAGES_QUERY_ORDER, ['beta'])
  assert.deepEqual(CLAUDE_MESSAGES_QUERY_ITEMS, [{ name: 'beta', value: 'true' }])
  const request = (method: string, requestPath: string, headers: Record<string, string> = {}) => ({ method, url: requestPath, headers })
  assert.throws(() => classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/', { 'content-length': '1' }), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/', { 'transfer-encoding': 'chunked' }), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/', { expect: '100-continue' }), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/', { connection: 'upgrade', upgrade: 'websocket' }), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/health'), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('GET', '/'), row, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/'), row, 1, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/'), row, 1, 1), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.equal(classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), row, 1, 0), 'messages')
  for (const requestPath of ['/v1/messages', '/v1/messages?beta=false', '/v1/messages?beta=True', '/v1/messages?beta=true&beta=true', '/v1/messages?beta=true&other=1', '/v1/messages?%62eta=true', '/v1/messages?beta=%74rue', 'http://receiver.invalid/v1/messages?beta=true']) {
    assert.throws(() => classifyReceiverRequestBoundary(request('POST', requestPath), row, 1, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  }
})

test('bootstrap contract derives exact HEAD count and route from the winning config source', () => {
  const ledger = buildCampaignLedger('p3b-official-da1d2d2d-4168-4e37-af7f-f668944861f2', TEST_C1)
  const userWinner = ledger.rows.find((row) => row.family === 'config'
    && row.schedule_id === 'config-precedence-project-vs-user'
    && row.arm === 'control/instrumented')!
  const projectWinner = ledger.rows.find((row) => row.family === 'config'
    && row.schedule_id === 'config-precedence-project-vs-user'
    && row.arm === 'treatment/instrumented')!
  const localWinner = ledger.rows.find((row) => row.family === 'config'
    && row.schedule_id === 'config-precedence-local-vs-project'
    && row.arm === 'treatment/instrumented')!
  const processEnv = ledger.rows.find((row) => row.family === 'config'
    && row.schedule_id === 'config-precedence-process-env-vs-local'
    && row.arm === 'treatment/instrumented')!
  const request = (method: string, requestPath: string, headers: Record<string, string> = {}) => ({ method, url: requestPath, headers })
  const contract = (row: typeof userWinner): unknown => (row as unknown as { bootstrap_contract?: unknown }).bootstrap_contract

  assert.equal(userWinner.sequence_index, 150)
  assert.equal(processEnv.sequence_index, 130)
  assert.deepEqual(contract(userWinner), { expected_count: 1, expected_route_ordinal: 0 })
  assert.deepEqual(contract(projectWinner), { expected_count: 0, expected_route_ordinal: null })
  assert.deepEqual(contract(localWinner), { expected_count: 0, expected_route_ordinal: null })
  assert.deepEqual(contract(processEnv), { expected_count: 1, expected_route_ordinal: 1 })
  assert.equal(classifyReceiverRequestBoundary(request('HEAD', '/'), userWinner, 0, 0), 'bootstrap_probe')
  assert.equal(classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), userWinner, 1, 0), 'messages')
  assert.equal(classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), projectWinner, 0, 0), 'messages')
  assert.equal(classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), localWinner, 0, 0), 'messages')
  assert.throws(() => classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), processEnv, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.equal(classifyReceiverRequestBoundary(request('HEAD', '/'), processEnv, 0, 0), 'bootstrap_probe')
  assert.equal(classifyReceiverRequestBoundary(request('POST', '/v1/messages?beta=true'), processEnv, 1, 0), 'messages')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/'), userWinner, 1, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
  assert.throws(() => classifyReceiverRequestBoundary(request('HEAD', '/'), projectWinner, 0, 0), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')
})

test('ledger and ES7 bind the exact captured beta query structure', () => {
  const ledger = buildCampaignLedger('p3b-query-provenance', TEST_C1) as unknown as Record<string, unknown>
  assert.deepEqual(ledger.request_target, {
    method: 'POST',
    path: '/v1/messages',
    query_present: true,
    query_order: ['beta'],
    query_items: [{ name: 'beta', value: 'true' }],
  })
  assert.deepEqual(ES7_REQUEST_FIELDS.slice(0, 5), ['method', 'path', 'query_present', 'query_order', 'query_items'])
})

test('auth-missing-credential treatment binds a bootstrap-only local authentication terminal', () => {
  const ledger = buildCampaignLedger('p3b-auth-local-terminal', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.family === 'auth'
    && candidate.schedule_id === 'auth-missing-credential'
    && candidate.arm === 'treatment/instrumented')!
  const bootstrapPeerUnsigned = {
    target_pid: 16769,
    local_address: '127.0.0.1',
    local_port: 43123,
    remote_address: '127.0.0.1',
    remote_port: 53123,
    executable_identity_sha256: TARGET_PROFILE.entrypoint_sha256,
  }
  const bootstrapPeer = { ...bootstrapPeerUnsigned, peer_socket_sha256: sha256Canonical(bootstrapPeerUnsigned) }
  const bootstrapUnsigned = {
    count: 1 as const,
    route_ordinal: 0,
    receiver_instance_id: '11111111-1111-4111-8111-111111111111',
    raw_socket_ordinal: 0,
    peer_socket: bootstrapPeer,
    response_status: 200,
    response_content_length: 0,
    response_finished: true,
    socket_closed: true,
    socket_close_had_error: false,
    post_count_effect: 0,
  }
  const receiver = {
    request_count: 0,
    response_count: 0,
    selected_route_ordinal: 0,
    bootstrap_contract: row.bootstrap_contract,
    attempt_ordinals: [],
    connection_ordinals: [],
    raw_socket_ordinals: [],
    action_ordinals: [],
    observation_sha256s: [],
    receiver_terminal: 'sealed_local_auth_failure',
    bootstrap: { ...bootstrapUnsigned, bootstrap_sha256: sha256Canonical(bootstrapUnsigned) },
  }

  assert.doesNotThrow(() => validateReceiverOrdinalBindings(receiver, [], row))
  const coverage = observationCoverageMatrix(ledger)
  assert.equal(coverage.enabled.filter((entry) => entry.sequence_index === row.sequence_index).length, 0)
  assert.equal(coverage.disabled.filter((entry) => entry.sequence_index === row.sequence_index && entry.reason_code === 'expected_local_auth_pre_request').length, ES7_REQUEST_FIELDS.length + ES7_RESPONSE_FIELDS.length)

  const control = ledger.rows.find((candidate) => candidate.family === 'auth'
    && candidate.schedule_id === 'auth-missing-credential'
    && candidate.arm === 'control/instrumented')!
  assert.throws(() => validateReceiverOrdinalBindings(receiver, [], control), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
})

test('auth-missing-credential output classifier accepts only the frozen safe local terminal shape', () => {
  const ledger = buildCampaignLedger('p3b-auth-local-output', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.family === 'auth'
    && candidate.schedule_id === 'auth-missing-credential'
    && candidate.arm === 'treatment/uninstrumented')!
  const output: Record<string, unknown> = {
    api_error_status: null,
    duration_api_ms: 0,
    duration_ms: 104,
    fast_mode_state: 'off',
    is_error: true,
    modelUsage: {},
    num_turns: 1,
    permission_denials: [],
    result: LOCAL_AUTH_RESULT_LITERAL,
    session_id: row.run_id,
    stop_reason: 'stop_sequence',
    subtype: 'success',
    terminal_reason: 'api_error',
    total_cost_usd: 0,
    type: 'result',
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: 'standard',
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      inference_geo: '',
      iterations: [],
      speed: 'standard',
    },
    uuid: '11111111-1111-4111-8111-111111111111',
  }
  const accepted = classifyTargetOutput(row, Buffer.from(`${JSON.stringify(output)}\n`, 'utf8'))
  assert.deepEqual({ safe_output_class: accepted.safe_output_class, safe_output_sha256: accepted.safe_output_sha256 }, {
    safe_output_class: 'local-auth-missing-credential',
    safe_output_sha256: LOCAL_AUTH_RESULT_SHA256,
  })
  assert.match(String((accepted as unknown as Record<string, unknown>).safe_output_profile_sha256 ?? ''), /^[a-f0-9]{64}$/)
  const cell = {
    target_terminal: { exit_code: 1, signal: null },
    stdout: { byte_length: 747, safe_output_class: 'local-auth-missing-credential', safe_output_sha256: LOCAL_AUTH_RESULT_SHA256, safe_output_profile_sha256: (accepted as unknown as Record<string, unknown>).safe_output_profile_sha256 },
    stderr: { byte_length: 0 },
  }
  const terminal = { state: 'terminal', terminal_class: 'success', exit_code: 1, signal: null }
  assert.doesNotThrow(() => validateLocalAuthCellTerminal(row, cell, terminal))
  for (const drift of [
    { cell: { ...cell, stdout: { ...cell.stdout, byte_length: 0 } }, terminal },
    { cell: { ...cell, stdout: { ...cell.stdout, safe_output_profile_sha256: '0'.repeat(64) } }, terminal },
    { cell, terminal: { ...terminal, exit_code: 2 } },
    { cell, terminal: { ...terminal, signal: 'SIGTERM' } },
    { cell: { ...cell, target_terminal: { exit_code: 2, signal: null } }, terminal },
    { cell: { ...cell, target_terminal: { exit_code: 1, signal: 'SIGTERM' } }, terminal },
    { cell: { ...cell, stdout: { ...cell.stdout, safe_output_sha256: '0'.repeat(64) } }, terminal },
    { cell: { ...cell, stderr: { byte_length: 1 } }, terminal },
  ]) assert.throws(() => validateLocalAuthCellTerminal(row, drift.cell, drift.terminal), (error: Error & { code?: string }) => error.code === 'target_terminal_invalid')
  const altered = [
    { ...output, result: 'Not logged in' },
    { ...output, session_id: '11111111-1111-4111-8111-111111111111' },
    { ...output, terminal_reason: 'other' },
    { ...output, extra: true },
    { ...output, usage: { ...(output.usage as Record<string, unknown>), output_tokens: 1 } },
    ...[[], 0, '', null, { unexpected: true }].map((modelUsage) => ({ ...output, modelUsage })),
  ]
  for (const value of altered) assert.equal(classifyTargetOutput(row, Buffer.from(JSON.stringify(value), 'utf8')).safe_output_class, 'unexpected')
  const control = ledger.rows.find((candidate) => candidate.family === 'auth'
    && candidate.schedule_id === 'auth-missing-credential'
    && candidate.arm === 'control/uninstrumented')!
  assert.equal(classifyTargetOutput(control, Buffer.from(JSON.stringify({ ...output, session_id: control.run_id }), 'utf8')).safe_output_class, 'unexpected')
  assert.throws(() => validateLocalAuthCellTerminal(control, cell, terminal), (error: Error & { code?: string }) => error.code === 'target_terminal_invalid')
})

test('control stability compares typed semantic shape while retaining per-observation integrity fields', () => {
  const digest = (value: number): string => value.toString(16).padStart(64, '0')
  const projection = (index: number): Record<string, unknown> => ({
    route_ordinal: 0,
    connection_ordinal: 0,
    attempt_ordinal: 0,
    action_ordinal: 0,
    method: 'POST',
    path: '/v1/messages',
    query_present: true,
    query_order: ['beta'],
    query_items: [{ name: 'beta', value: 'true' }],
    ordered_header_classes: [{ name: 'content-type', ordinal: 0, value_class: 'application-json' }],
    header_presence: [{ count: 1, header_ref: 'header_content_type' }],
    auth_marker_winner_class: 'x-api-key:campaign-placeholder',
    body_byte_length: 4000 + index,
    body_sha256: digest(100 + index),
    body_ast: {
      schema_id: 'oracle-lab-p3b-request-ast.v3',
      value: {
        fields: [
          { field_ref: 'field_00', value: { type: 'string', literal_ref: 'synthetic-literals/request_model_v1', byte_length: 17, value_sha256: digest(1) } },
          { field_ref: 'field_01', value: { type: 'redacted_string', byte_length: 20 + index, value_sha256: digest(200 + index) } },
          { field_ref: 'field_02', value: { type: 'array', length: 2, items: [
            { type: 'redacted_string', byte_length: 30 + index, value_sha256: digest(300 + index) },
            { type: 'object', fields: [
              { field_ref: 'field_03', value: { type: 'boolean', value: true } },
              { field_ref: 'field_04', value: { type: 'number', finite: true, value_text: '1' } },
              { field_ref: 'field_05', value: { type: 'null' } },
            ] },
          ] } },
        ],
        type: 'object',
      },
    },
    body_ast_sha256: digest(400 + index),
    body_normalized_byte_length: 5000 + index,
    body_normalized_sha256: digest(500 + index),
    body_roundtrip_sha256: digest(600 + index),
    response: { status: 200, transport_terminal: 'http_complete', timing_bucket: 'not_delayed', ordered_header_classes: [{ name: 'content-type', value_class: 'text/event-stream' }], sse_event_order: ['message_start', 'message_stop'] },
  })
  const observations = Array.from({ length: 20 }, (_, index) => projection(index))
  const stable = observations.map((value) => projectValidatedObservationForControlStability(value))

  assert.equal(new Set(stable.map((value) => sha256Canonical(value))).size, 1)
  assert.equal((observations[0].body_ast as Record<string, unknown>).schema_id, 'oracle-lab-p3b-request-ast.v3')
  assert.equal(observations[0].body_sha256, digest(100))
  assert.equal(observations[19].body_normalized_sha256, digest(519))

  const baseline = stable[0]
  const ast = baseline.body_ast as Record<string, unknown>
  const value = ast.value as Record<string, unknown>
  const fields = value.fields as Array<Record<string, unknown>>
  const nestedArray = fields[2].value as Record<string, unknown>
  const nestedItems = nestedArray.items as Array<Record<string, unknown>>
  const nestedObject = nestedItems[1]
  const nestedFields = nestedObject.fields as Array<Record<string, unknown>>
  const replaceNestedField = (index: number, replacement: Record<string, unknown>): Record<string, unknown> => ({
    ...baseline,
    body_ast: { ...ast, value: { ...value, fields: [...fields.slice(0, 2), { ...fields[2], value: { ...nestedArray, items: [nestedItems[0], { ...nestedObject, fields: nestedFields.map((field, fieldIndex) => fieldIndex === index ? replacement : field) }] } }] } },
  })
  const variants = [
    { ...baseline, query_items: [{ name: 'beta', value: 'false' }] },
    { ...baseline, response: { ...(baseline.response as Record<string, unknown>), status: 429 } },
    { ...baseline, body_ast: { ...ast, value: { ...value, fields: [{ ...fields[0], field_ref: 'field_changed' }, ...fields.slice(1)] } } },
    { ...baseline, body_ast: { ...ast, value: { ...value, fields: [{ ...fields[0], value: { ...(fields[0].value as Record<string, unknown>), literal_ref: 'synthetic-literals/changed' } }, ...fields.slice(1)] } } },
    { ...baseline, body_ast: { ...ast, value: { ...value, fields: [...fields.slice(0, 2), { ...fields[2], value: { ...nestedArray, items: [...(nestedArray.items as unknown[])].reverse() } }] } } },
    replaceNestedField(0, { field_ref: 'field_03', value: { type: 'boolean', value: false } }),
    replaceNestedField(1, { field_ref: 'field_04', value: { type: 'number', finite: true, value_text: '2' } }),
    replaceNestedField(2, { field_ref: 'field_05', value: { type: 'string', literal_ref: 'synthetic-literals/not_null', byte_length: 8, value_sha256: digest(700) } }),
    { ...baseline, body_ast: { ...ast, value: { ...value, fields: [...fields, { field_ref: 'field_extra', value: { type: 'boolean', value: true } }] } } },
  ]
  for (const variant of variants) assert.notEqual(sha256Canonical(variant), sha256Canonical(baseline))
})

test('validated control observations bind wire identity and preserve nested semantic shape', () => {
  const ledger = buildCampaignLedger('p3b-control-semantic-shape', TEST_C1)
  const validationRow = ledger.rows.find((row) => row.schedule_id === 'config-precedence-process-env-vs-local'
    && row.arm === 'treatment/instrumented'
    && row.repetition === 0)!
  const buildObservation = (requestBody: Record<string, unknown>, mutate?: (observation: Record<string, unknown>) => void): Record<string, unknown> => {
    const wireBody = Buffer.from(canonicalJson(requestBody), 'utf8')
    const bodyAst = normalizeRequestAst(wireBody)
    const bodyAstBytes = Buffer.concat([canonicalBytes(bodyAst), Buffer.from('\n', 'utf8')])
    const action = validationRow.response_program.actions[0]
    const responseBody = Buffer.from(materializeResponseBody(action.body_kind), 'utf8')
    const headerBytes = Buffer.from('HTTP/1.1 200 OK\r\n', 'utf8')
    const wireEvents = [
      { kind: 'headers', monotonic_ns: '1', byte_length: headerBytes.length, bytes_sha256: sha256Bytes(headerBytes) },
      { kind: 'body', monotonic_ns: '2', byte_length: responseBody.length, bytes_sha256: sha256Bytes(responseBody) },
      { kind: 'response_finish', monotonic_ns: '3' },
      { kind: 'socket_end', monotonic_ns: '4' },
      { kind: 'socket_close', monotonic_ns: '5', had_error: false },
    ]
    const peerUnsigned = { target_pid: 123, local_address: '127.0.0.1', local_port: 41000, remote_address: '127.0.0.1', remote_port: 42000, executable_identity_sha256: 'a'.repeat(64) }
    const peer = { ...peerUnsigned, peer_socket_sha256: sha256Canonical(peerUnsigned) }
    const bodyRoundtripSha256 = sha256Canonical({
      materializer: REQUEST_AST_MATERIALIZER,
      literal_table_sha256: bodyAst.literal_table_sha256,
      body_byte_length: wireBody.length,
      body_sha256: sha256Bytes(wireBody),
      body_ast_sha256: sha256Bytes(bodyAstBytes),
      normalized_byte_length: bodyAst.normalized_byte_length,
      normalized_sha256: bodyAst.normalized_sha256,
    })
    const response = {
      status: action.status,
      ordered_header_classes: action.ordered_headers,
      body_byte_length: responseBody.length,
      body_sha256: sha256Bytes(responseBody),
      sse_event_order: ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'],
      transport_terminal: action.transport_terminal,
      delay_elapsed_ns: '0',
      timing_bucket: 'not_delayed',
      wire_events: wireEvents,
      wire_event_sha256: sha256Canonical(wireEvents),
      socket_close_had_error: false,
    }
    const unsigned: Record<string, unknown> = {
      schema_id: 'oracle-lab-p3b-wire-observation.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256,
      run_id: validationRow.run_id, sequence_index: validationRow.sequence_index, receiver_group_id: validationRow.receiver_group_id,
      receiver_instance_id: '11111111-1111-4111-8111-111111111111', receiver_authority_sha256: 'b'.repeat(64),
      target_pid: 123, target_instance_id: '22222222-2222-4222-8222-222222222222', executable_identity_sha256: peer.executable_identity_sha256,
      route_ordinal: expectedSelectedRoute(validationRow), connection_ordinal: 0, raw_socket_ordinal: 1, attempt_ordinal: 0, action_ordinal: 0,
      peer_socket: peer, method: 'POST', path: CLAUDE_MESSAGES_PATH, query_present: true, query_order: CLAUDE_MESSAGES_QUERY_ORDER,
      query_items: CLAUDE_MESSAGES_QUERY_ITEMS, ordered_header_classes: [{ ordinal: 0, name: 'content-type', value_class: 'application-json' }],
      header_presence: [{ header_ref: 'header_content_type', count: 1 }], auth_marker_winner_class: expectedAuthMarkerClass(validationRow),
      body_byte_length: wireBody.length, body_sha256: sha256Bytes(wireBody), body_ast: bodyAst, body_ast_sha256: sha256Bytes(bodyAstBytes),
      body_normalized_byte_length: bodyAst.normalized_byte_length, body_normalized_sha256: bodyAst.normalized_sha256, body_roundtrip_sha256: bodyRoundtripSha256,
      response_program_sha256: validationRow.response_program_sha256, response,
    }
    mutate?.(unsigned)
    unsigned.observation_sha256 = sha256Canonical(unsigned)
    return unsigned
  }
  const request = (opaque: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    model: 'claude-sonnet-4-6', system: FIXED_STDIN_LITERAL, messages: [{ role: 'user', content: opaque }], stream: true, max_tokens: 1, ...extra,
  })
  const literalRefs = (value: unknown): string[] => {
    if (!value || typeof value !== 'object') return []
    const record = value as Record<string, unknown>
    return [
      ...(typeof record.literal_ref === 'string' ? [record.literal_ref] : []),
      ...(Array.isArray(value) ? value : Object.values(record)).flatMap(literalRefs),
    ]
  }
  const validated = Array.from({ length: 20 }, (_, index) => buildObservation(request(`opaque-${'x'.repeat(index + 1)}`))).map((observation) => validateObservationForControlStability(observation, validationRow))
  assert.equal(new Set(validated.map(({ projection }) => sha256Canonical(projection))).size, 1)
  assert.equal(new Set(validated.map(({ sha256 }) => sha256)).size, 20)
  assert.ok(literalRefs(buildObservation(request('opaque-exact')).body_ast).includes(FIXED_STDIN_LITERAL_REF))

  for (const nonExactPrompt of [
    FIXED_STDIN_LITERAL.trimEnd(),
    `${FIXED_STDIN_LITERAL}\n`,
    FIXED_STDIN_LITERAL.replace(/\n$/, '\r\n'),
    `prefix:${FIXED_STDIN_LITERAL}`,
    `${FIXED_STDIN_LITERAL}:suffix`,
  ]) {
    const observation = buildObservation(request('opaque-non-exact', { system: nonExactPrompt }))
    assert.equal(literalRefs(observation.body_ast).includes(FIXED_STDIN_LITERAL_REF), false)
    assert.throws(() => validateObservationForControlStability(observation, validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')
  }

  const controls = ledger.rows.slice(0, 20)
  const classified = enforcePairAndRepetitionStability(controls, controls.map((row, index) => ({
    run_id: row.run_id, sequence_index: row.sequence_index, family: row.family, schedule_id: row.schedule_id, arm: row.arm, repetition: row.repetition,
    status: 'Reproduced', enabled: true, reason_code: 'validated-test-observation', projection_sha256: sha256Canonical(validated[index].projection),
  })))
  assert.ok(classified.every((row) => row.status === 'Reproduced'))

  const baselineProjectionSha256 = sha256Canonical(validated[0].projection)
  for (const variant of [
    request('opaque-a', { stream: false }),
    request('opaque-a', { max_tokens: 2 }),
    request('opaque-a', { top_p: 1 }),
    request('opaque-a', { messages: [{ role: 'assistant', content: 'opaque-b' }, { role: 'user', content: 'opaque-a' }] }),
    request('opaque-a', { messages: [{ role: 'user', content: ['opaque-a'] }] }),
    request('opaque-a', { metadata: null }),
  ]) assert.notEqual(sha256Canonical(validateObservationForControlStability(buildObservation(variant), validationRow).projection), baselineProjectionSha256)
  const ordered = request('opaque-a', { messages: [{ role: 'user', content: 'opaque-a' }, { role: 'assistant', content: ['opaque-b'] }] })
  const reordered = request('opaque-a', { messages: [...(ordered.messages as unknown[])].reverse() })
  assert.notEqual(sha256Canonical(validateObservationForControlStability(buildObservation(ordered), validationRow).projection), sha256Canonical(validateObservationForControlStability(buildObservation(reordered), validationRow).projection))
  assert.throws(() => buildObservation({ ...request('opaque-a'), model: FIXED_STDIN_LITERAL.trimEnd() }), (error: Error & { code?: string }) => error.code === 'receiver_request_invalid')

  assert.throws(() => validateObservationForControlStability(buildObservation(request('opaque-a'), (observation) => { observation.query_items = [{ name: 'beta', value: 'false' }] }), validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')
  assert.throws(() => validateObservationForControlStability(buildObservation(request('opaque-a'), (observation) => { observation.route_ordinal = 1 }), validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')
  assert.throws(() => validateObservationForControlStability(buildObservation(request('opaque-a'), (observation) => { observation.auth_marker_winner_class = 'x-api-key:campaign-placeholder' }), validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')
  assert.throws(() => validateObservationForControlStability(buildObservation(request('opaque-a'), (observation) => { (observation.response as Record<string, unknown>).status = 429 }), validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')

  const driftRootWireIdentity = buildObservation(request('opaque-a'), (observation) => {
    const ast = structuredClone(observation.body_ast as Record<string, unknown>)
    ast.wire_byte_length = Number(ast.wire_byte_length) + 7
    ast.wire_sha256 = 'b'.repeat(64)
    observation.body_ast = ast
    observation.body_ast_sha256 = sha256Bytes(Buffer.concat([canonicalBytes(ast), Buffer.from('\n', 'utf8')]))
    observation.body_roundtrip_sha256 = sha256Canonical({ materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: ast.literal_table_sha256, body_byte_length: observation.body_byte_length, body_sha256: observation.body_sha256, body_ast_sha256: observation.body_ast_sha256, normalized_byte_length: observation.body_normalized_byte_length, normalized_sha256: observation.body_normalized_sha256 })
  })
  assert.throws(() => validateObservationForControlStability(driftRootWireIdentity, validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')

  const injectIntoAst = (observation: Record<string, unknown>, injector: (field: Record<string, unknown>) => void): void => {
    const ast = structuredClone(observation.body_ast as Record<string, unknown>)
    const root = ast.value as Record<string, unknown>
    const fields = root.fields as Array<Record<string, unknown>>
    injector(fields.find((field) => field.field_ref === 'field_01')!)
    observation.body_ast = ast
    observation.body_ast_sha256 = sha256Bytes(Buffer.concat([canonicalBytes(ast), Buffer.from('\n', 'utf8')]))
    observation.body_roundtrip_sha256 = sha256Canonical({ materializer: REQUEST_AST_MATERIALIZER, literal_table_sha256: ast.literal_table_sha256, body_byte_length: observation.body_byte_length, body_sha256: observation.body_sha256, body_ast_sha256: observation.body_ast_sha256, normalized_byte_length: observation.body_normalized_byte_length, normalized_sha256: observation.body_normalized_sha256 })
  }
  const nestedIntegrityInjection = buildObservation(request('opaque-a'), (observation) => injectIntoAst(observation, (field) => { field.wire_sha256 = 'c'.repeat(64) }))
  assert.notEqual(sha256Canonical(validateObservationForControlStability(nestedIntegrityInjection, validationRow).projection), baselineProjectionSha256)
  assert.throws(() => validateObservationForControlStability(buildObservation(request('opaque-a'), (observation) => {
    injectIntoAst(observation, (field) => {
      const visit = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') return false
        const record = node as Record<string, unknown>
        if (record.type === 'redacted_string') { record.extra = true; return true }
        return (Array.isArray(node) ? node : Object.values(record)).some(visit)
      }
      assert.equal(visit(field.value), true)
    })
  }), validationRow), (error: Error & { code?: string }) => error.code === 'observation_invalid')
})

test('hardened receiver emits no automatic interim response for Expect or upgrade framing', async () => {
  const row = buildCampaignLedger('p3b-interim-framing', TEST_C1).rows[0]
  const protocolViolations: string[] = []
  let bootstrapCount = 0
  const server = createHardenedReceiverServer((request, response) => {
    try {
      assert.equal(classifyReceiverRequestBoundary(request, row, bootstrapCount, 0), 'bootstrap_probe')
      bootstrapCount += 1
      void sendClaudeBootstrapProbeResponse(response)
    } catch { response.destroy() }
  }, (code, socket) => { protocolViolations.push(code); socket?.destroy() })
  const port = await listen(server)
  const rawExchange = (bytes: string): Promise<string> => new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let output = ''
    socket.setEncoding('latin1')
    socket.on('data', (chunk: string) => { output += chunk })
    socket.once('connect', () => socket.end(bytes, 'latin1'))
    socket.once('close', () => resolve(output))
  })
  try {
    const rejected = await rawExchange('HEAD / HTTP/1.1\r\nHost: 127.0.0.1\r\nExpect: 100-continue\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    assert.equal((rejected.match(/HTTP\/1\.1 100/g) ?? []).length, 0)
    assert.equal((rejected.match(/HTTP\/1\.1 417/g) ?? []).length, 1)
    assert.deepEqual(protocolViolations, ['receiver_request_invalid'])
    assert.equal(bootstrapCount, 0)
    assert.equal(await rawExchange('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'), '')
    assert.equal(await rawExchange('NOT HTTP\r\n\r\n'), '')
    assert.deepEqual(protocolViolations, ['receiver_request_invalid', 'receiver_request_invalid', 'receiver_request_invalid'])
  } finally { await close(server) }

  const accepted = createHardenedReceiverServer((request, response) => {
    assert.equal(classifyReceiverRequestBoundary(request, row, 0, 0), 'bootstrap_probe')
    void sendClaudeBootstrapProbeResponse(response)
  }, () => assert.fail('valid HEAD reached protocol violation'))
  const acceptedPort = await listen(accepted)
  try {
    const wire = await new Promise<string>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port: acceptedPort })
      let output = ''
      socket.setEncoding('latin1')
      socket.on('data', (chunk: string) => { output += chunk })
      socket.once('connect', () => socket.end('HEAD / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n', 'latin1'))
      socket.once('close', () => resolve(output))
    })
    assert.equal((wire.match(/HTTP\/1\.1 100/g) ?? []).length, 0)
    assert.equal((wire.match(/HTTP\/1\.1 200/g) ?? []).length, 1)
  } finally { await close(accepted) }
})

test('closeout rejects missing, duplicate, gapped, reordered, extra, or substituted receiver observations', () => {
  const ledger = buildCampaignLedger('p3b-closeout-ordinals', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.schedule_id === 'http_429_then_complete')!
  const peerUnsigned = { target_pid: 123, local_address: '127.0.0.1', local_port: 41000, remote_address: '127.0.0.1', remote_port: 42000, executable_identity_sha256: 'a'.repeat(64) }
  const peer = { ...peerUnsigned, peer_socket_sha256: sha256Canonical(peerUnsigned) }
  const observations = row.response_program.actions.map((action, index) => {
    const unsigned = { attempt_ordinal: index, connection_ordinal: index, raw_socket_ordinal: index + 1, action_ordinal: action.action_ordinal, peer_socket: { ...peer, remote_port: peer.remote_port + index + 1, peer_socket_sha256: sha256Canonical({ ...peerUnsigned, remote_port: peerUnsigned.remote_port + index + 1 }) }, query_order: ledger.request_target.query_order, query_items: ledger.request_target.query_items }
    return { ...unsigned, observation_sha256: sha256Canonical(unsigned) }
  })
  const bootstrapUnsigned = { count: 1 as const, route_ordinal: 0, receiver_instance_id: '11111111-1111-4111-8111-111111111111', raw_socket_ordinal: 0, peer_socket: peer, response_status: 200, response_content_length: 0, response_finished: true, socket_closed: true, socket_close_had_error: false, post_count_effect: 0 }
  const receiver = {
    request_count: 2, response_count: 2,
    selected_route_ordinal: 0,
    bootstrap_contract: row.bootstrap_contract,
    bootstrap: { ...bootstrapUnsigned, bootstrap_sha256: sha256Canonical(bootstrapUnsigned) },
    attempt_ordinals: [0, 1], connection_ordinals: [0, 1], raw_socket_ordinals: [1, 2], action_ordinals: [0, 1], observation_sha256s: observations.map((observation) => observation.observation_sha256), receiver_terminal: 'sealed',
  }
  assert.doesNotThrow(() => validateReceiverOrdinalBindings(receiver, observations, row))
  for (const drift of [
    { ...receiver, attempt_ordinals: [] },
    { ...receiver, attempt_ordinals: [0, 0] },
    { ...receiver, connection_ordinals: [0, 2] },
    { ...receiver, raw_socket_ordinals: [2, 1] },
    { ...receiver, observation_sha256s: [...receiver.observation_sha256s, 'f'.repeat(64)] },
  ]) assert.throws(() => validateReceiverOrdinalBindings(drift, observations, row), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
  assert.throws(() => validateReceiverOrdinalBindings(receiver, [...observations].reverse(), row), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
  const originalUnsigned = Object.fromEntries(Object.entries(observations[0]).filter(([key]) => key !== 'observation_sha256'))
  const substitutedUnsigned = { ...originalUnsigned, query_items: [{ name: 'beta', value: 'false' }] }
  const substituted = { ...substitutedUnsigned, observation_sha256: sha256Canonical(substitutedUnsigned) }
  assert.throws(() => validateReceiverOrdinalBindings({ ...receiver, observation_sha256s: [substituted.observation_sha256, receiver.observation_sha256s[1]] }, [substituted, observations[1]], row), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
  const wrongPortPeerUnsigned = { ...peerUnsigned, local_port: 49999, remote_port: peerUnsigned.remote_port + 1 }
  const wrongPortUnsigned = { ...originalUnsigned, peer_socket: { ...wrongPortPeerUnsigned, peer_socket_sha256: sha256Canonical(wrongPortPeerUnsigned) } }
  const wrongPort = { ...wrongPortUnsigned, observation_sha256: sha256Canonical(wrongPortUnsigned) }
  assert.throws(() => validateReceiverOrdinalBindings({ ...receiver, observation_sha256s: [wrongPort.observation_sha256, receiver.observation_sha256s[1]] }, [wrongPort, observations[1]], row), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
})

test('closeout requires explicit self-bound zero-bootstrap evidence and a canonical POST observation', () => {
  const ledger = buildCampaignLedger('p3b-closeout-zero-bootstrap', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project'
    && candidate.arm === 'treatment/instrumented')!
  const action = row.response_program.actions[0]
  const peerUnsigned = { target_pid: 123, local_address: '127.0.0.1', local_port: 41000, remote_address: '127.0.0.1', remote_port: 42000, executable_identity_sha256: 'a'.repeat(64) }
  const peer = { ...peerUnsigned, peer_socket_sha256: sha256Canonical(peerUnsigned) }
  const observationUnsigned = { attempt_ordinal: 0, connection_ordinal: 0, raw_socket_ordinal: 0, action_ordinal: action.action_ordinal, peer_socket: peer, query_order: ledger.request_target.query_order, query_items: ledger.request_target.query_items }
  const observation = { ...observationUnsigned, observation_sha256: sha256Canonical(observationUnsigned) }
  const bootstrapUnsigned = { count: 0 as const, route_ordinal: null, receiver_instance_id: null, raw_socket_ordinal: null, peer_socket: null, response_status: null, response_content_length: null, response_finished: null, socket_closed: null, socket_close_had_error: null, post_count_effect: 0 }
  const bootstrap = { ...bootstrapUnsigned, bootstrap_sha256: sha256Canonical(bootstrapUnsigned) }
  const receiver = {
    request_count: 1,
    response_count: 1,
    selected_route_ordinal: 1,
    bootstrap_contract: row.bootstrap_contract,
    bootstrap,
    attempt_ordinals: [0],
    connection_ordinals: [0],
    raw_socket_ordinals: [0],
    action_ordinals: [action.action_ordinal],
    observation_sha256s: [observation.observation_sha256],
    receiver_terminal: 'sealed',
  }

  assert.doesNotThrow(() => validateReceiverOrdinalBindings(receiver, [observation], row))
  for (const drift of [
    { ...receiver, request_count: 0, response_count: 0, attempt_ordinals: [], connection_ordinals: [], raw_socket_ordinals: [], action_ordinals: [], observation_sha256s: [] },
    { ...receiver, raw_socket_ordinals: [1] },
    { ...receiver, bootstrap: { ...bootstrap, bootstrap_sha256: 'f'.repeat(64) } },
    { ...receiver, bootstrap: { ...bootstrap, count: 1 } },
    { ...receiver, bootstrap_contract: { expected_count: 1, expected_route_ordinal: 1 } },
  ]) assert.throws(() => validateReceiverOrdinalBindings(drift, drift.request_count === 0 ? [] : [observation], row), (error: Error & { code?: string }) => error.code === 'receiver_terminal_invalid')
})

test('closeout independently binds receiver authority to campaign ledger, static anchor, prelaunch, route, and bootstrap', () => {
  const ledger = buildCampaignLedger('p3b-closeout-identity', TEST_C1)
  const row = ledger.rows[0]
  const receiverInstanceId = '11111111-1111-4111-8111-111111111111'
  const anchor = { schema_id: 'oracle-lab-p3b-static-anchor.v1', anchor_sha256: 'a'.repeat(64), receiver_source_sha256: 'b'.repeat(64), receiver_executable_identity_sha256: 'c'.repeat(64), receiver_schema_sha256: 'd'.repeat(64), request_target: ledger.request_target, bootstrap_contract_schema: BOOTSTRAP_CONTRACT_SCHEMA }
  const authority = { schema_id: 'oracle-lab-p3b-receiver-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, receiver_group_id: row.receiver_group_id, response_program_sha256: row.response_program_sha256, selected_route_ordinal: 0, bootstrap_contract: row.bootstrap_contract, anchor_sha256: anchor.anchor_sha256, receiver_source_sha256: anchor.receiver_source_sha256, receiver_executable_identity_sha256: anchor.receiver_executable_identity_sha256, receiver_schema_sha256: anchor.receiver_schema_sha256, authority_sha256: 'e'.repeat(64), routes: [{ route_ordinal: 0, receiver_instance_id: receiverInstanceId, host: '127.0.0.1', port: 41000 }] }
  const peerSocket = { target_pid: 123, local_address: '127.0.0.1', local_port: 41000, remote_address: '127.0.0.1', remote_port: 42000, executable_identity_sha256: '1'.repeat(64), peer_socket_sha256: '2'.repeat(64) }
  const receiver = { schema_id: 'oracle-lab-p3b-receiver-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, receiver_group_id: row.receiver_group_id, receiver_authority_sha256: authority.authority_sha256, selected_route_ordinal: 0, bootstrap_contract: row.bootstrap_contract, bootstrap: { count: 1, route_ordinal: 0, receiver_instance_id: receiverInstanceId, peer_socket: peerSocket } }
  const launch = { schema_id: 'oracle-lab-p3b-launch-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, anchor_sha256: anchor.anchor_sha256, response_program_sha256: row.response_program_sha256, receiver_authority_sha256: authority.authority_sha256, executable_identity_sha256: peerSocket.executable_identity_sha256 }
  const campaignInput = { campaign_id: ledger.campaign_id, input_sha256: '3'.repeat(64) }
  const operatorAuthority = { campaign_id: ledger.campaign_id, campaign_input_sha256: campaignInput.input_sha256, authority_sha256: '4'.repeat(64) }
  const prelaunch = { schema_id: 'oracle-lab-p3b-prelaunch-result.v1', campaign_id: ledger.campaign_id, authority_sha256: operatorAuthority.authority_sha256, input_sha256: campaignInput.input_sha256, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, status: 'SEALED' }
  const bindings = { ledger, row, receiver, receiver_authority: authority, launch_authority: launch, static_anchor: anchor, prelaunch, operator_authority: operatorAuthority, campaign_input: campaignInput }
  assert.doesNotThrow(() => validateReceiverAuthorityClosureBindings(bindings))
  for (const drift of [
    { ...bindings, receiver_authority: { ...authority, receiver_source_sha256: 'f'.repeat(64) } },
    { ...bindings, static_anchor: { ...anchor, request_target: { ...ledger.request_target, query_items: [{ name: 'beta', value: 'false' }] } } },
    { ...bindings, prelaunch: { ...prelaunch, anchor_sha256: 'f'.repeat(64) } },
    { ...bindings, receiver: { ...receiver, bootstrap: { ...receiver.bootstrap, receiver_instance_id: '22222222-2222-4222-8222-222222222222' } } },
    { ...bindings, launch_authority: { ...launch, schema_id: 'wrong.v1' } },
    { ...bindings, launch_authority: { ...launch, sequence_index: 1 } },
    { ...bindings, static_anchor: { ...anchor, schema_id: 'wrong.v1' } },
    { ...bindings, prelaunch: { ...prelaunch, authority_sha256: 'f'.repeat(64) } },
  ]) assert.throws(() => validateReceiverAuthorityClosureBindings(drift), (error: Error & { code?: string }) => error.code === 'receiver_authority_invalid')
})

test('closeout binds the row130 preflight route one separately from request route zero', () => {
  const ledger = buildCampaignLedger('p3b-closeout-process-env-local', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.schedule_id === 'config-precedence-process-env-vs-local'
    && candidate.arm === 'treatment/instrumented'
    && candidate.repetition === 0)!
  const routeZeroInstance = '11111111-1111-4111-8111-111111111111'
  const routeOneInstance = '22222222-2222-4222-8222-222222222222'
  const anchor = { schema_id: 'oracle-lab-p3b-static-anchor.v1', anchor_sha256: 'a'.repeat(64), receiver_source_sha256: 'b'.repeat(64), receiver_executable_identity_sha256: 'c'.repeat(64), receiver_schema_sha256: 'd'.repeat(64), request_target: ledger.request_target, bootstrap_contract_schema: BOOTSTRAP_CONTRACT_SCHEMA }
  const authority = { schema_id: 'oracle-lab-p3b-receiver-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, receiver_group_id: row.receiver_group_id, response_program_sha256: row.response_program_sha256, selected_route_ordinal: 0, bootstrap_contract: row.bootstrap_contract, anchor_sha256: anchor.anchor_sha256, receiver_source_sha256: anchor.receiver_source_sha256, receiver_executable_identity_sha256: anchor.receiver_executable_identity_sha256, receiver_schema_sha256: anchor.receiver_schema_sha256, authority_sha256: 'e'.repeat(64), routes: [
    { route_ordinal: 0, receiver_instance_id: routeZeroInstance, host: '127.0.0.1', port: 41000 },
    { route_ordinal: 1, receiver_instance_id: routeOneInstance, host: '127.0.0.1', port: 41001 },
  ] }
  const peerSocket = { target_pid: 123, local_address: '127.0.0.1', local_port: 41001, remote_address: '127.0.0.1', remote_port: 42000, executable_identity_sha256: '1'.repeat(64), peer_socket_sha256: '2'.repeat(64) }
  const receiver = { schema_id: 'oracle-lab-p3b-receiver-result.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, receiver_group_id: row.receiver_group_id, receiver_authority_sha256: authority.authority_sha256, selected_route_ordinal: 0, bootstrap_contract: row.bootstrap_contract, bootstrap: { count: 1, route_ordinal: 1, receiver_instance_id: routeOneInstance, peer_socket: peerSocket } }
  const launch = { schema_id: 'oracle-lab-p3b-launch-authority.v1', campaign_id: ledger.campaign_id, ledger_sha256: ledger.ledger_sha256, run_id: row.run_id, sequence_index: row.sequence_index, anchor_sha256: anchor.anchor_sha256, response_program_sha256: row.response_program_sha256, receiver_authority_sha256: authority.authority_sha256, executable_identity_sha256: peerSocket.executable_identity_sha256 }
  const campaignInput = { campaign_id: ledger.campaign_id, input_sha256: '3'.repeat(64) }
  const operatorAuthority = { campaign_id: ledger.campaign_id, campaign_input_sha256: campaignInput.input_sha256, authority_sha256: '4'.repeat(64) }
  const prelaunch = { schema_id: 'oracle-lab-p3b-prelaunch-result.v1', campaign_id: ledger.campaign_id, authority_sha256: operatorAuthority.authority_sha256, input_sha256: campaignInput.input_sha256, ledger_sha256: ledger.ledger_sha256, anchor_sha256: anchor.anchor_sha256, status: 'SEALED' }
  const bindings = { ledger, row, receiver, receiver_authority: authority, launch_authority: launch, static_anchor: anchor, prelaunch, operator_authority: operatorAuthority, campaign_input: campaignInput }

  assert.doesNotThrow(() => validateReceiverAuthorityClosureBindings(bindings))
  for (const drift of [
    { ...bindings, receiver_authority: { ...authority, selected_route_ordinal: 1 } },
    { ...bindings, receiver_authority: { ...authority, bootstrap_contract: { expected_count: 1, expected_route_ordinal: 0 } } },
    { ...bindings, receiver: { ...receiver, selected_route_ordinal: 1 } },
    { ...bindings, receiver: { ...receiver, bootstrap_contract: { expected_count: 1, expected_route_ordinal: 0 } } },
    { ...bindings, receiver: { ...receiver, bootstrap: { ...receiver.bootstrap, route_ordinal: 0, receiver_instance_id: routeZeroInstance, peer_socket: { ...peerSocket, local_port: 41000 } } } },
    { ...bindings, receiver: { ...receiver, bootstrap: { ...receiver.bootstrap, receiver_instance_id: routeZeroInstance } } },
    { ...bindings, static_anchor: { ...anchor, request_target: { ...ledger.request_target, query_items: [{ name: 'beta', value: 'false' }] } } },
    { ...bindings, static_anchor: { ...anchor, bootstrap_contract_schema: { ...BOOTSTRAP_CONTRACT_SCHEMA, derivation: 'caller-selected' } } },
  ]) assert.throws(() => validateReceiverAuthorityClosureBindings(drift), (error: Error & { code?: string }) => error.code === 'receiver_authority_invalid')

  const userWinner = ledger.rows.find((candidate) => candidate.sequence_index === 150
    && candidate.schedule_id === 'config-precedence-project-vs-user'
    && candidate.arm === 'control/instrumented')!
  const userAuthority = { ...authority, run_id: userWinner.run_id, sequence_index: userWinner.sequence_index, receiver_group_id: userWinner.receiver_group_id, response_program_sha256: userWinner.response_program_sha256, bootstrap_contract: userWinner.bootstrap_contract }
  const userPeer = { ...peerSocket, local_port: 41000 }
  const userReceiver = { ...receiver, run_id: userWinner.run_id, sequence_index: userWinner.sequence_index, receiver_group_id: userWinner.receiver_group_id, receiver_authority_sha256: userAuthority.authority_sha256, bootstrap_contract: userWinner.bootstrap_contract, bootstrap: { ...receiver.bootstrap, route_ordinal: 0, receiver_instance_id: routeZeroInstance, peer_socket: userPeer } }
  const userLaunch = { ...launch, run_id: userWinner.run_id, sequence_index: userWinner.sequence_index, response_program_sha256: userWinner.response_program_sha256, receiver_authority_sha256: userAuthority.authority_sha256 }
  assert.doesNotThrow(() => validateReceiverAuthorityClosureBindings({ ...bindings, row: userWinner, receiver: userReceiver, receiver_authority: userAuthority, launch_authority: userLaunch }))
  assert.throws(() => validateReceiverAuthorityClosureBindings({ ...bindings, row: userWinner, receiver: { ...userReceiver, bootstrap: { ...userReceiver.bootstrap, route_ordinal: 1, receiver_instance_id: routeOneInstance } }, receiver_authority: userAuthority, launch_authority: userLaunch }), (error: Error & { code?: string }) => error.code === 'receiver_authority_invalid')

  const postPeerUnsigned = { target_pid: peerSocket.target_pid, local_address: peerSocket.local_address, local_port: 41000, remote_address: peerSocket.remote_address, remote_port: 42001, executable_identity_sha256: peerSocket.executable_identity_sha256 }
  const postPeer = { ...postPeerUnsigned, peer_socket_sha256: sha256Canonical(postPeerUnsigned) }
  const observationUnsigned = { route_ordinal: 0, receiver_instance_id: routeZeroInstance, attempt_ordinal: 0, connection_ordinal: 0, raw_socket_ordinal: 1, action_ordinal: row.response_program.actions[0].action_ordinal, peer_socket: postPeer, query_order: ledger.request_target.query_order, query_items: ledger.request_target.query_items }
  const observation = { ...observationUnsigned, observation_sha256: sha256Canonical(observationUnsigned) }
  const bootstrapUnsigned = { count: 1, route_ordinal: 1, receiver_instance_id: routeOneInstance, raw_socket_ordinal: 0, peer_socket: { ...peerSocket, peer_socket_sha256: sha256Canonical(Object.fromEntries(Object.entries(peerSocket).filter(([key]) => key !== 'peer_socket_sha256'))) }, response_status: 200, response_content_length: 0, response_finished: true, socket_closed: true, socket_close_had_error: false, post_count_effect: 0 }
  const ordinalReceiver = { request_count: 1, response_count: 1, selected_route_ordinal: 0, bootstrap_contract: row.bootstrap_contract, bootstrap: { ...bootstrapUnsigned, bootstrap_sha256: sha256Canonical(bootstrapUnsigned) }, attempt_ordinals: [0], connection_ordinals: [0], raw_socket_ordinals: [1], action_ordinals: [row.response_program.actions[0].action_ordinal], observation_sha256s: [observation.observation_sha256], receiver_terminal: 'sealed' }
  assert.doesNotThrow(() => validateReceiverOrdinalBindings(ordinalReceiver, [observation], row))
  assert.doesNotThrow(() => validateObservationRouteAuthorityBindings([observation], row, authority.routes[0], peerSocket.executable_identity_sha256))
  const sameAsBootstrapPeerUnsigned = { ...postPeerUnsigned, local_port: 41001 }
  const sameAsBootstrapPeer = { ...sameAsBootstrapPeerUnsigned, peer_socket_sha256: sha256Canonical(sameAsBootstrapPeerUnsigned) }
  const wrongObservationUnsigned = { ...observationUnsigned, peer_socket: sameAsBootstrapPeer }
  const wrongObservation = { ...wrongObservationUnsigned, observation_sha256: sha256Canonical(wrongObservationUnsigned) }
  assert.doesNotThrow(() => validateReceiverOrdinalBindings({ ...ordinalReceiver, observation_sha256s: [wrongObservation.observation_sha256] }, [wrongObservation], row))
  assert.throws(() => validateObservationRouteAuthorityBindings([wrongObservation], row, authority.routes[0], peerSocket.executable_identity_sha256), (error: Error & { code?: string }) => error.code === 'receiver_authority_invalid')
})

test('native synthetic target crosses the sandboxed bootstrap HEAD then one counted POST boundary', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const row = buildCampaignLedger('p3b-native-bootstrap', TEST_C1).rows[0]
  const root = privateRoot('p3b-receiver-bootstrap-native-')
  const runRoot = path.join(root, 'run')
  const launchRoot = path.join(root, 'launch-images')
  mkdirSync(runRoot, { mode: 0o700 })
  mkdirSync(launchRoot, { mode: 0o700 })
  const executable = path.join(launchRoot, 'synthetic-target')
  const compile = spawnSync('/usr/bin/clang', ['-O2', '-Wall', '-Wextra', '-Werror', '-o', executable, path.join(import.meta.dirname, 'fixtures/phase3b-synthetic-target.c')], { encoding: 'utf8' })
  assert.equal(compile.status, 0, compile.stderr)
  chmodSync(executable, 0o500)
  let bootstrapCount = 0
  let observationCount = 0
  const server = createHttpServer((request, response) => {
    try {
      const kind = classifyReceiverRequestBoundary(request, row, bootstrapCount, observationCount)
      if (kind === 'bootstrap_probe') {
        bootstrapCount += 1
        sendClaudeBootstrapProbeResponse(response)
        return
      }
      request.resume()
      request.once('end', () => {
        observationCount += 1
        response.writeHead(200, { 'content-length': '0', connection: 'close' })
        response.end()
      })
    } catch {
      response.destroy()
    }
  })
  const port = await listen(server)
  try {
    const profile = buildSandboxProfile(root, runRoot, [port])
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, executable], {
        cwd: runRoot,
        env: {
          PATH: '/usr/bin:/bin', HOME: runRoot, TMPDIR: runRoot, LANG: 'C', LC_ALL: 'C',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_API_KEY: 'oracle-phase3b-placeholder:campaign',
          ANTHROPIC_CUSTOM_HEADERS: 'x-oracle-launch-authority: synthetic\nx-oracle-target-capability: synthetic\nx-oracle-run-id: synthetic',
          ORACLE_PHASE3B_MAX_ATTEMPTS: '1', ORACLE_PHASE3B_EXPECT_COMPLETE: '1', ORACLE_PHASE3B_EXPECT_FAILURE: '0',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }) })
      child.once('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }) })
    })
    assert.deepEqual(result, { code: 0, signal: null, stdout: '{"result":"output.complete"}\n', stderr: '' })
    assert.deepEqual({ bootstrapCount, observationCount }, { bootstrapCount: 1, observationCount: 1 })
  } finally {
    await close(server)
  }
})

test('prelaunch and conclusion support preserve exact digest-bound Phase 3A bytes without LF', () => {
  const root = privateRoot('p3b-predecessor-transport-')
  const file = path.join(root, 'phase3a-conclusion.json')
  const conclusion = { schema_id: 'oracle-lab-phase3a-conclusion.v1', conclusion_id: 'CL-P3A-R2-CONFIG-AUTH', level: 'Reproduced', phase3b_usable: true }
  const bytes = Buffer.from(canonicalJson(conclusion), 'utf8')
  writeFileSync(file, bytes, { mode: 0o600 })

  const record = readPredecessorConclusion(file, sha256Bytes(bytes))
  assert.deepEqual(record.value, conclusion)
  assert.equal(record.identity.sha256, sha256Bytes(bytes))

  createPrivateDirectory(root, 'control')
  sealPredecessorConclusion(root, 'control/predecessor-config-auth.json', file, record.identity.sha256, 'CL-P3A-R2-CONFIG-AUTH')
  const sealed = readCanonicalTransport(path.join(root, 'control/predecessor-config-auth.json'), { mode: 0o600 })
  assert.deepEqual(sealed.value, conclusion)
  assert.equal(sealed.identity.sha256, record.identity.sha256)
  assert.equal(sealed.bytes.at(-1), 0x7d)
  assert.equal(predecessorSupportSourceSha256(sealed.value, sealed.identity.sha256, 'CL-P3A-R2-CONFIG-AUTH', record.identity.sha256), record.identity.sha256)
  assert.equal(predecessorSupportSourceSha256(sealed.value, sealed.identity.sha256, 'CL-P3A-R2-FAILURE-STREAM', record.identity.sha256), null)
  assert.equal(predecessorSupportSourceSha256(sealed.value, sealed.identity.sha256, 'CL-P3A-R2-CONFIG-AUTH', 'f'.repeat(64)), null)
  const forgedTestFallback = { schema_id: 'oracle-lab-p3b-test-predecessor-attestation.v1', conclusion_id: 'CL-P3A-R2-CONFIG-AUTH', conclusion_sha256: record.identity.sha256, level: 'Reproduced' }
  assert.equal(predecessorSupportSourceSha256(forgedTestFallback, 'f'.repeat(64), 'CL-P3A-R2-CONFIG-AUTH', record.identity.sha256), null)
  assert.equal(predecessorSupportSourceSha256(forgedTestFallback, 'f'.repeat(64), 'CL-P3A-R2-CONFIG-AUTH', record.identity.sha256, true), record.identity.sha256)
  assert.equal(inventoryNamespace(root).find((entry) => entry.relative_path === 'control/predecessor-config-auth.json')?.schema_id, 'oracle-lab-phase3a-conclusion.v1')

  const newlineFile = path.join(root, 'phase3a-conclusion-newline.json')
  const newlineBytes = Buffer.concat([bytes, Buffer.from('\n')])
  writeFileSync(newlineFile, newlineBytes, { mode: 0o600 })
  assert.deepEqual(readPredecessorConclusion(newlineFile, sha256Bytes(newlineBytes)).value, conclusion)

  const prettyFile = path.join(root, 'phase3a-conclusion-pretty.json')
  const prettyBytes = Buffer.from(JSON.stringify(conclusion, null, 2), 'utf8')
  writeFileSync(prettyFile, prettyBytes, { mode: 0o600 })
  assert.throws(() => readPredecessorConclusion(prettyFile, sha256Bytes(prettyBytes)), (error: Error & { code?: string }) => error.code === 'canonical_record_invalid')
  assert.throws(() => readPredecessorConclusion(file, 'f'.repeat(64)), (error: Error & { code?: string }) => error.code === 'sealed_authority_file_drift')
  assert.throws(() => readPredecessorConclusion(prettyFile, 'f'.repeat(64)), (error: Error & { code?: string }) => error.code === 'sealed_authority_file_drift')
})

test('production ledger freezes order, counts, UUIDv4, stdin reference, and family programs', () => {
  const ledger = buildCampaignLedger('p3b-focused-core', TEST_C1)
  assert.equal(ledger.rows.length, 340)
  assert.deepEqual(ledger.counts, { mandatory_target_controls: 20, config: 80, auth: 80, request_wire: 30, response_failure_recovery: 130, total_rows: 340 })
  assert.ok(ledger.rows.every((row, index) => row.sequence_index === index && UUID_V4.test(row.run_id) && row.stdin_literal_ref === FIXED_STDIN_LITERAL_REF))
  assert.equal(new Set(ledger.rows.map((row) => row.run_id)).size, 340)
  assert.equal(ledger.rows.slice(0, 10).every((row) => row.schedule_id === 'target-guard-control'), true)
  assert.equal(ledger.rows.slice(10, 20).every((row) => row.schedule_id === 'target-perturbation-control'), true)
  assert.equal(JSON.stringify(ledger).includes(FIXED_STDIN_LITERAL.trim()), false)
  assert.deepEqual(ledger.schedule_descriptors[0], {
    algorithm_id: 'fixed-base-plus-cyclic-rotation-v2', encoding_id: 'lp-u32be-v1', campaign_id: 'p3b-focused-core', schedule_id: 'target-guard-control', arm_count: 2,
    seeds: [215001, 215002, 215003, 215004, 215005], seed_vector_digest: '415e0b1e20a486c05c62267d75647e37eb0fb3abcd7fdd2f1afd01960759f9c1',
    sorted_labels: ['instrumented', 'uninstrumented'], base_permutation_digest: '01c8fed617bea95560d5afff6b399f4ebf14569c6eaecc82f546cff4a4faad51', offset: 0, direction: -1,
    base: ['instrumented', 'uninstrumented'], orders: [['instrumented', 'uninstrumented'], ['uninstrumented', 'instrumented'], ['instrumented', 'uninstrumented'], ['uninstrumented', 'instrumented'], ['instrumented', 'uninstrumented']],
    descriptor_sha256: 'b114f72f558a5c5f8119753e98ec546e785bdee464261ccef448196799acf6f7',
  })
  assert.deepEqual(ledger.rows.slice(0, 4).map((row) => row.run_id), ['08a0a766-70de-46e4-9442-f1a05ca9c993', '833e2bfc-fc51-4046-8f54-352d2295c2df', '8bff393f-5ccc-443f-9083-cf3da0eae3f3', '02061fb0-140c-4a13-8d52-3d4656f6a6e0'])
  assert.deepEqual(buildCampaignLedger('p3b-focused-core', TEST_C1), ledger)
  assert.throws(() => validateCampaignLedger({ ...ledger, rows: [ledger.rows[1], ledger.rows[0], ...ledger.rows.slice(2)] }), (error: Error & { code?: string }) => error.code === 'launch_ledger_invalid')
})

test('complete_sse and recovery descriptors are complete, ordered, and attempt-bound', () => {
  const complete = buildResponseProgram('complete_sse')
  assert.equal(complete.maximum_attempts, 1)
  assert.deepEqual(complete.actions[0], { action_ordinal: 0, kind: 'http', status: 200, ordered_headers: [{ name: 'content-type', value_class: 'text/event-stream' }], body_kind: 'complete_sse', delay_class: 'none', delay_ms: 0, transport_terminal: 'http_complete' })
  assert.deepEqual(complete.complete_sse?.event_order, ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop'])
  assert.deepEqual(complete.complete_sse?.materialized_literal_refs, ['synthetic-literals/model.test', 'synthetic-literals/output.complete'])
  const retry = buildResponseProgram('http_429_then_complete')
  assert.equal(retry.maximum_attempts, 2)
  assert.deepEqual(retry.actions.map((action) => [action.action_ordinal, action.status, action.body_kind]), [[0, 429, 'error_json'], [1, 200, 'complete_sse']])
})

test('request-wire schedules carry three distinct real argv stimuli with paired-arm stability', () => {
  const rows = buildCampaignLedger('p3b-request-stimuli', TEST_C1).rows.filter((row) => row.family === 'request_wire')
  const bySchedule = ['prompt_only', 'safe_tool_catalog', 'tool_disabled'].map((schedule) => rows.filter((row) => row.schedule_id === schedule))
  assert.equal(new Set(bySchedule.map((members) => members[0].request_stimulus_sha256)).size, 3)
  assert.equal(new Set(bySchedule.map((members) => JSON.stringify(members[0].request_stimulus.argv_suffix))).size, 3)
  for (const members of bySchedule) assert.equal(new Set(members.map((row) => row.request_stimulus_sha256)).size, 1)
})

test('retryable terminal and recovery programs share the trigger then diverge deterministically', () => {
  const terminal = buildResponseProgram('http_429_terminal')
  const recovery = buildResponseProgram('http_429_then_complete')
  assert.equal(terminal.maximum_attempts, 2)
  assert.deepEqual(terminal.actions.map((action) => [action.status, action.body_kind]), [[429, 'error_json'], [400, 'error_json']])
  assert.deepEqual(recovery.actions.map((action) => [action.status, action.body_kind]), [[429, 'error_json'], [200, 'complete_sse']])
  assert.deepEqual(buildResponseProgram('reset_terminal').actions.map((action) => [action.kind, action.status]), [['reset', null], ['http', 400]])
})

test('config route policy seals the observed process-env-vs-local route zero winner without widening other schedules', () => {
  const rows = buildCampaignLedger('p3b-route-policy', TEST_C1).rows
  const processEnvRows = rows.filter((candidate) => candidate.schedule_id === 'config-precedence-process-env-vs-local')
  const processEnv = processEnvRows.find((candidate) => candidate.arm === 'treatment/instrumented' && candidate.repetition === 0)!
  const localFile = rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project' && candidate.arm.startsWith('treatment/'))!
  const control = rows.find((candidate) => candidate.schedule_id === 'config-precedence-local-vs-project' && candidate.arm.startsWith('control/'))!
  assert.equal(expectedSelectedRoute(processEnv), 0)
  assert.equal(expectedBootstrapRoute(processEnv), 1)
  assert.ok(processEnvRows.every((row) => expectedSelectedRoute(row) === 0))
  assert.ok(processEnvRows.filter((row) => row.arm.startsWith('treatment/')).every((row) => expectedBootstrapRoute(row) === 1))
  assert.ok(processEnvRows.filter((row) => row.arm.startsWith('control/')).every((row) => expectedBootstrapRoute(row) === null))
  assert.equal(expectedAuthMarkerClass(processEnv), 'x-api-key:campaign-config-placeholder')
  assert.equal(expectedSelectedRoute(localFile), 1)
  assert.equal(expectedSelectedRoute(control), 0)
  assert.ok(rows.filter((row) => row.family !== 'config' || row.schedule_id !== 'config-precedence-process-env-vs-local').every((row) => expectedSelectedRoute(row) === (row.route_count === 1 || row.family !== 'config' ? 0 : row.arm.startsWith('treatment/') ? 1 : 0)))
})

test('fixed reviewer registry rejects a caller-fabricated signature', () => {
  const reviewers = [
    { key_id: 'sha256:e7fe55f8631e08d70e778dece93c7bd37be3f3d9cbe11b56d853687973da1f49', public_key_der_base64: 'MCowBQYDK2VwAyEAHhp4pxf0eD49VtRmab/FEcHwGMO2fRYPEuLp2/WJ/uE=', reviewer_identity: 'requirements-independent', reviewer_role: 'requirements' },
    { key_id: 'sha256:41415d264a4369befa5b2f8086312184b7c5a20365c5ae3ebb1c19f0f84dfade', public_key_der_base64: 'MCowBQYDK2VwAyEAbABLrzYUMMI3EcBORLDo9f+phMAVVfqorhay9oT56Sg=', reviewer_identity: 'security-independent', reviewer_role: 'security_quality' },
  ] as const
  const unsigned = { schema_id: 'oracle-lab-p3b-campaign-reviewers.v1', reviewed_candidate_commit: 'a'.repeat(40), reviewed_candidate_tree: 'b'.repeat(40), reviewers }
  const registry = validateCampaignReviewerRegistry({ ...unsigned, registry_sha256: sha256Canonical(unsigned) })
  const reviewer = registry.reviewers.find((candidate) => candidate.reviewer_role === 'requirements')!
  assert.throws(() => verifyTrustedSignature({ reviewer_identity: reviewer.reviewer_identity, reviewer_role: reviewer.reviewer_role, signing_key_id: reviewer.key_id, signature_algorithm: 'ed25519_canonical_json_v1', signature: Buffer.alloc(64).toString('base64'), authority_sha256: 'a'.repeat(64) }, registry, 'requirements', 'authority_sha256', 'operator_authority_invalid'), (error: Error & { code?: string }) => error.code === 'operator_authority_invalid')
})

test('sealed filesystem rejects symlink runtime components and O_EXCL rewrite', () => {
  const parent = privateRoot('p3b-sealed-fs-')
  const real = path.join(parent, 'real')
  const link = path.join(parent, 'link')
  mkdirSync(real, { mode: 0o700 })
  symlinkSync(real, link)
  assert.throws(() => assertPrivateRuntimeRoot(link), (error: Error & { code?: string }) => error.code === 'sealed_path_invalid')
  writeExclusiveCanonical(parent, 'record.json', { schema_id: 'focused.v1', value: 1 })
  assert.deepEqual(readCanonical(parent, 'record.json').value, { schema_id: 'focused.v1', value: 1 })
  assert.throws(() => writeExclusiveCanonical(parent, 'record.json', { schema_id: 'focused.v1', value: 2 }), (error: NodeJS.ErrnoException) => error.code === 'EEXIST')
})

test('sandbox policy binds the exact loopback endpoint and denies an adjacent listener', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const root = privateRoot('p3b-sandbox-loopback-')
  const runRoot = path.join(root, 'run')
  mkdirSync(runRoot, { mode: 0o700 })
  const route = createServer((socket) => socket.end())
  const adjacent = createServer((socket) => socket.end())
  const routePort = await listen(route)
  const adjacentPort = await listen(adjacent)
  try {
    const profile = buildSandboxProfile(root, runRoot, [routePort])
    assert.match(profile, new RegExp(`\\(allow network-outbound \\(remote ip "localhost:${routePort}"\\)\\)`))
    assert.match(profile, new RegExp(`\\(allow network-outbound \\(remote tcp "localhost:${routePort}"\\)\\)`))
    assert.doesNotMatch(profile, /remote (?:ip|tcp) "\*:/)
    const probe = String.raw`
require 'socket'
require 'json'
def tcp(host, port)
  Socket.tcp(host, port, connect_timeout: 0.6) { true }
rescue StandardError
  false
end
def tcp_attempts(host, port)
  tcp(host, port) || tcp(host, port)
end
def udp(host, port)
  socket = UDPSocket.new
  socket.connect(host, port)
  socket.send("x", 0)
  true
rescue StandardError
  false
ensure
  socket&.close
end
def process_info(pid)
  system('/bin/ps', '-p', pid.to_s, out: File::NULL, err: File::NULL) == true
rescue StandardError
  false
end
STDOUT.write(JSON.generate({ route: tcp_attempts('127.0.0.1', Integer(ARGV[0])), route_udp: udp('127.0.0.1', Integer(ARGV[0])), adjacent: tcp_attempts('127.0.0.1', Integer(ARGV[1])), external: tcp_attempts('1.1.1.1', 443), other_process_info: process_info(Process.pid) }))`
    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, '/usr/bin/ruby', '--disable=gems', '-e', probe, String(routePort), String(adjacentPort)], {
        cwd: runRoot,
        env: { PATH: '/usr/bin:/bin', HOME: runRoot, TMPDIR: runRoot, LANG: 'C', LC_ALL: 'C' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000)
      child.once('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
      child.once('error', (error) => { clearTimeout(timer); resolve({ status: null, stdout, stderr: `${stderr}${error.message}` }) })
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { route: true, route_udp: false, adjacent: false, external: false, other_process_info: false })
  } finally {
    await Promise.all([close(route), close(adjacent)])
  }
})

const EXACT_PHASE3B_TARGET = path.join(os.homedir(), '.codex/evidence/claude-code-2.1.215-phase3a-20260720-H3A/intake/platform/2.1.215/unpacked/package/claude')
const EXACT_PHASE3B_PROBE = path.join(os.homedir(), '.codex/evidence/phase3b-p3b-official-d2658747-7c3b-4a0d-bd91-88b4765e8b5c/launch-images/probe-image')

test('sandbox policy starts the exact Claude Code 2.1.215 target without weakening host isolation', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(EXACT_PHASE3B_TARGET) }, async () => {
  const root = privateRoot('p3b-sandbox-target-startup-')
  const runRoot = path.join(root, 'run')
  mkdirSync(runRoot, { mode: 0o700 })
  const targetIdentity = stableRead(EXACT_PHASE3B_TARGET, { maximumBytes: TARGET_PROFILE.maximum_executable_bytes }).identity
  assert.equal(targetIdentity.sha256, TARGET_PROFILE.entrypoint_sha256)
  assert.equal(targetIdentity.size, TARGET_PROFILE.entrypoint_size)
  const profile = `${buildSandboxProfile(root, runRoot, [65535])} (allow process-exec (literal "${EXACT_PHASE3B_TARGET}")) (allow file-read* (literal "${EXACT_PHASE3B_TARGET}"))`
  const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, EXACT_PHASE3B_TARGET, '--version'], {
      cwd: runRoot,
      env: { PATH: '/usr/bin:/bin', HOME: runRoot, TMPDIR: runRoot, TZ: 'UTC', LANG: 'C', LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
    child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr }) })
    child.once('error', (error) => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr: `${stderr}${error.message}` }) })
  })
  assert.equal(result.signal, null, result.stderr || `target terminated by ${result.signal}`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '2.1.215 (Claude Code)\n')
  assert.match(profile, /\(deny process-info\*\)/)
  assert.match(profile, /\(allow process-info-pidinfo \(target self\)\)/)
  assert.doesNotMatch(profile, /\(allow process-info-pidinfo\)/)
  assert.doesNotMatch(profile, /\(allow process-info\*\)/)
  assert.match(profile, /\(allow file-read\* \(subpath "\/private\/var\/db\/timezone"\)\)/)
})

test('exact sealed Claude probe crosses sandbox bootstrap and canonical beta query', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(EXACT_PHASE3B_PROBE) }, async () => {
  const row = buildCampaignLedger('p3b-exact-bootstrap', TEST_C1).rows[0]
  const root = privateRoot('p3b-sandbox-exact-probe-')
  const launchRoot = path.join(root, 'launch-images')
  mkdirSync(launchRoot, { mode: 0o700 })
  const executable = path.join(launchRoot, 'probe-image')
  copyFileSync(EXACT_PHASE3B_PROBE, executable)
  chmodSync(executable, 0o500)
  const identity = stableRead(executable, { mode: 0o500, maximumBytes: TARGET_PROFILE.maximum_executable_bytes }).identity
  assert.equal(identity.size, 248_569_168)
  assert.equal(identity.sha256, 'e542635cba20126337a0e1ea0ef78932df56283c940fef6cd6cc0736f46e23d5')
  const complete = Buffer.from(materializeResponseBody('complete_sse'), 'utf8')
  const requests: Array<{ method: string; url: string; bodyBytes: number }> = []
  let bootstrapCount = 0
  let observationCount = 0
  const normalizationErrors: string[] = []
  const server = createHttpServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.push({ method: request.method ?? '', url: request.url ?? '', bodyBytes: Buffer.concat(chunks).length })
      let kind: ReturnType<typeof classifyReceiverRequestBoundary>
      try { kind = classifyReceiverRequestBoundary(request, row, bootstrapCount, observationCount) } catch { response.destroy(); return }
      if (kind === 'bootstrap_probe') {
        bootstrapCount += 1
        sendClaudeBootstrapProbeResponse(response)
        return
      }
      const body = Buffer.concat(chunks)
      try { normalizeRequestAst(body) } catch (error: unknown) {
        normalizationErrors.push(`${String((error as { code?: string }).code ?? 'unknown')}:${(error as Error).message}`)
        body.fill(0)
        response.destroy()
        return
      }
      body.fill(0)
      observationCount += 1
      response.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': String(complete.length), connection: 'close' })
      response.end(complete)
    })
  })
  const port = await listen(server)
  try {
    const ledger = buildCampaignLedger('p3b-exact-image-integration', TEST_C1)
    const row = ledger.rows[0]
    const baseUrl = `http://127.0.0.1:${port}`
    const filesystem = prepareScenarioFilesystem(root, ledger, row, {
      launch_authority_sha256: 'a'.repeat(64), selected_base_url: baseUrl, alternate_base_url: null, route_urls: [baseUrl],
      custom_headers: `x-oracle-launch-authority: ${'a'.repeat(64)}\nx-oracle-target-capability: ${'b'.repeat(64)}\nx-oracle-run-id: ${row.run_id}`,
    })
    assert.deepEqual(readdirSync(path.join(filesystem.cwd, '..', 'home', '.claude')), [])
    const profile = filesystem.profile
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, executable, ...row.argv], {
        cwd: filesystem.cwd,
        env: filesystem.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.stdin.end(filesystem.stdin)
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 10_000)
      child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut }) })
      child.once('error', (error) => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }) })
    })
    assert.equal(result.timedOut, false, JSON.stringify({ requests, result }))
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).result, 'output.complete')
    assert.deepEqual(requests.map(({ method, url }) => ({ method, url })), [{ method: 'HEAD', url: '/' }, { method: 'POST', url: '/v1/messages?beta=true' }])
    assert.deepEqual(normalizationErrors, [])
    assert.deepEqual({ bootstrapCount, observationCount }, { bootstrapCount: 1, observationCount: 1 })
    assert.match(profile, /\(allow file-read\* \(literal "\/usr\/share\/icu"\)\)/)
    assert.match(profile, /\(allow file-read\* \(literal "\/usr\/share\/icu\/icudt74l\.dat"\)\)/)
    assert.doesNotMatch(profile, /\(allow file-read\* \(subpath "\/usr\/share"\)\)/)
  } finally {
    await close(server)
  }
})

test('exact sealed Claude probe resolves file precedence without a receiver bootstrap request', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(EXACT_PHASE3B_PROBE) }, async () => {
  const root = privateRoot('p3b-sandbox-config-no-bootstrap-')
  const launchRoot = path.join(root, 'launch-images')
  mkdirSync(launchRoot, { mode: 0o700 })
  const executable = path.join(launchRoot, 'probe-image')
  copyFileSync(EXACT_PHASE3B_PROBE, executable)
  chmodSync(executable, 0o500)
  const identity = stableRead(executable, { mode: 0o500, maximumBytes: TARGET_PROFILE.maximum_executable_bytes }).identity
  assert.equal(identity.sha256, 'e542635cba20126337a0e1ea0ef78932df56283c940fef6cd6cc0736f46e23d5')

  const ledger = buildCampaignLedger('p3b-exact-config-no-bootstrap', TEST_C1)
  const row = ledger.rows[110]
  assert.equal(row.sequence_index, 110)
  assert.equal(row.schedule_id, 'config-precedence-local-vs-project')
  assert.equal(row.arm, 'treatment/instrumented')
  const complete = Buffer.from(materializeResponseBody('complete_sse'), 'utf8')
  const selectedRequests: Array<{ method: string; url: string }> = []
  const alternateRequests: Array<{ method: string; url: string }> = []
  let observationCount = 0
  const selected = createHttpServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      selectedRequests.push({ method: request.method ?? '', url: request.url ?? '' })
      try {
        assert.equal(classifyReceiverRequestBoundary(request, row, 0, observationCount), 'messages')
        const body = Buffer.concat(chunks)
        try { normalizeRequestAst(body) } finally { body.fill(0) }
        observationCount += 1
        response.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': String(complete.length), connection: 'close' })
        response.end(complete)
      } catch { response.destroy() }
    })
  })
  const alternate = createHttpServer((request, response) => {
    alternateRequests.push({ method: request.method ?? '', url: request.url ?? '' })
    response.destroy()
  })
  const selectedPort = await listen(selected)
  const alternatePort = await listen(alternate)
  try {
    const routeUrls = [`http://127.0.0.1:${alternatePort}`, `http://127.0.0.1:${selectedPort}`]
    const filesystem = prepareScenarioFilesystem(root, ledger, row, {
      launch_authority_sha256: 'a'.repeat(64),
      selected_base_url: routeUrls[1],
      alternate_base_url: routeUrls[0],
      route_urls: routeUrls,
      custom_headers: `x-oracle-launch-authority: ${'a'.repeat(64)}\nx-oracle-target-capability: ${'b'.repeat(64)}\nx-oracle-run-id: ${row.run_id}`,
    })
    assert.equal(filesystem.env.ANTHROPIC_BASE_URL, undefined)
    assert.deepEqual(row.bootstrap_contract, { expected_count: 0, expected_route_ordinal: null })
    assert.deepEqual(JSON.parse(readFileSync(path.join(filesystem.cwd, '.claude/settings.json'), 'utf8')), { env: { ANTHROPIC_BASE_URL: routeUrls[0] } })
    assert.deepEqual(JSON.parse(readFileSync(path.join(filesystem.cwd, '.claude/settings.local.json'), 'utf8')), { env: { ANTHROPIC_BASE_URL: routeUrls[1] } })
    let externalSocketCount = 0
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', filesystem.profile, executable, ...row.argv], {
        cwd: filesystem.cwd,
        env: filesystem.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.stdin.end(filesystem.stdin)
      const sampler = setInterval(() => {
        if (!child.pid) return
        externalSocketCount = Math.max(externalSocketCount, sampleOwnedExternalSocketCount(child.pid, [alternatePort, selectedPort]))
      }, 50)
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 30_000)
      child.once('close', (status, signal) => { clearTimeout(timer); clearInterval(sampler); resolve({ status, signal, stdout, stderr, timedOut }) })
      child.once('error', (error) => { clearTimeout(timer); clearInterval(sampler); resolve({ status: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }) })
    })
    assert.equal(result.timedOut, false, JSON.stringify({ selectedRequests, alternateRequests, result }))
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).result, 'output.complete')
    assert.deepEqual(selectedRequests, [{ method: 'POST', url: '/v1/messages?beta=true' }])
    assert.deepEqual(alternateRequests, [])
    assert.equal(observationCount, 1)
    assert.equal(externalSocketCount, 0)
  } finally {
    await Promise.all([close(selected), close(alternate)])
  }
})

test('exact sealed Claude probe selects local route zero over process-env route one', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' || !existsSync(EXACT_PHASE3B_PROBE) }, async () => {
  const root = privateRoot('p3b-sandbox-process-env-local-')
  const launchRoot = path.join(root, 'launch-images')
  mkdirSync(launchRoot, { mode: 0o700 })
  const executable = path.join(launchRoot, 'probe-image')
  copyFileSync(EXACT_PHASE3B_PROBE, executable)
  chmodSync(executable, 0o500)
  const identity = stableRead(executable, { mode: 0o500, maximumBytes: TARGET_PROFILE.maximum_executable_bytes }).identity
  assert.equal(identity.sha256, 'e542635cba20126337a0e1ea0ef78932df56283c940fef6cd6cc0736f46e23d5')

  const ledger = buildCampaignLedger('p3b-exact-process-env-local', TEST_C1)
  const row = ledger.rows.find((candidate) => candidate.schedule_id === 'config-precedence-process-env-vs-local'
    && candidate.arm === 'treatment/instrumented'
    && candidate.repetition === 0)!
  const complete = Buffer.from(materializeResponseBody('complete_sse'), 'utf8')
  const routeZeroRequests: Array<{ method: string; url: string }> = []
  const routeOneRequests: Array<{ method: string; url: string }> = []
  let bootstrapCount = 0
  let observationCount = 0
  const routeZero = createHttpServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      routeZeroRequests.push({ method: request.method ?? '', url: request.url ?? '' })
      try {
        const kind = classifyReceiverRequestBoundary(request, row, bootstrapCount, observationCount)
        if (kind === 'bootstrap_probe') {
          bootstrapCount += 1
          sendClaudeBootstrapProbeResponse(response)
          return
        }
        const body = Buffer.concat(chunks)
        try { normalizeRequestAst(body) } finally { body.fill(0) }
        observationCount += 1
        response.writeHead(200, { 'content-type': 'text/event-stream', 'content-length': String(complete.length), connection: 'close' })
        response.end(complete)
      } catch { response.destroy() }
    })
  })
  const routeOne = createHttpServer((request, response) => {
    routeOneRequests.push({ method: request.method ?? '', url: request.url ?? '' })
    try {
      assert.equal(classifyReceiverRequestBoundary(request, row, bootstrapCount, observationCount), 'bootstrap_probe')
      bootstrapCount += 1
      sendClaudeBootstrapProbeResponse(response)
    } catch { response.destroy() }
  })
  const routeZeroPort = await listen(routeZero)
  const routeOnePort = await listen(routeOne)
  try {
    const routeUrls = [`http://127.0.0.1:${routeZeroPort}`, `http://127.0.0.1:${routeOnePort}`]
    const filesystem = prepareScenarioFilesystem(root, ledger, row, {
      launch_authority_sha256: 'a'.repeat(64),
      selected_base_url: routeUrls[0],
      alternate_base_url: routeUrls[1],
      route_urls: routeUrls,
      custom_headers: `x-oracle-launch-authority: ${'a'.repeat(64)}\nx-oracle-target-capability: ${'b'.repeat(64)}\nx-oracle-run-id: ${row.run_id}`,
    })
    assert.equal(filesystem.env.ANTHROPIC_BASE_URL, routeUrls[1])
    assert.deepEqual(JSON.parse(readFileSync(path.join(filesystem.cwd, '.claude/settings.local.json'), 'utf8')), { env: { ANTHROPIC_BASE_URL: routeUrls[0] } })
    assert.deepEqual(row.bootstrap_contract, { expected_count: 1, expected_route_ordinal: 1 })
    let externalSocketCount = 0
    const result = await new Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-p', filesystem.profile, executable, ...row.argv], {
        cwd: filesystem.cwd,
        env: filesystem.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
      child.stdin.end(filesystem.stdin)
      const sampler = setInterval(() => {
        if (!child.pid) return
        externalSocketCount = Math.max(externalSocketCount, sampleOwnedExternalSocketCount(child.pid, [routeZeroPort, routeOnePort]))
      }, 50)
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 30_000)
      child.once('close', (status, signal) => { clearTimeout(timer); clearInterval(sampler); resolve({ status, signal, stdout, stderr, timedOut }) })
      child.once('error', (error) => { clearTimeout(timer); clearInterval(sampler); resolve({ status: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut }) })
    })
    assert.equal(result.timedOut, false, JSON.stringify({ routeZeroRequests, routeOneRequests, result }))
    assert.equal(result.signal, null, result.stderr)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).result, 'output.complete')
    assert.deepEqual(routeZeroRequests, [{ method: 'POST', url: '/v1/messages?beta=true' }])
    assert.deepEqual(routeOneRequests, [{ method: 'HEAD', url: '/' }])
    assert.deepEqual({ bootstrapCount, observationCount, externalSocketCount }, { bootstrapCount: 1, observationCount: 1, externalSocketCount: 0 })
  } finally {
    await Promise.all([close(routeZero), close(routeOne)])
  }
})

test('RED: execute mode claims a sealed namespace before fallible validation and rejects re-entry', async () => {
  const root = privateRoot('p3b-execution-attempt-claim-')
  for (const directory of ['control', 'prelaunch', 'observations', 'receiver-results', 'runs', 'guards', 'cell-results']) createPrivateDirectory(root, directory)

  await assert.rejects(runExecuteFromSealedPrelaunch(root))
  const claim = readCanonical(root, 'control/execution-attempt.json').value
  assert.equal(claim.schema_id, 'oracle-lab-p3b-execution-attempt-claim.v1')
  assert.equal(claim.evidence_root, root)
  assert.equal(claim.consumption_boundary, 'first_live_campaign_io')
  assert.equal(claim.same_attempt_resume_allowed, false)
  assert.equal(claim.automatic_retry_allowed, false)
  assert.equal(claim.attempt_state_at_claim, 'UNVERIFIED')
  assert.deepEqual(claim.preexisting_control_evidence, [])
  assert.equal(claim.epoch_consumed_at_claim, null)
  assert.deepEqual([claim.receiver_binds_at_claim, claim.target_launches_at_claim, claim.sockets_at_claim], [null, null, null])
  assert.equal(typeof claim.epoch_policy_sha256, 'string')
  assert.equal(claim.claim_sha256, sha256Canonical(Object.fromEntries(Object.entries(claim).filter(([key]) => key !== 'claim_sha256'))))
  const assessment = readCanonical(root, 'control/execution-evidence-assessment.json').value
  assert.equal(assessment.status, 'CLEAR')
  assert.deepEqual(assessment.preexisting_execution_evidence, [])
  assert.equal(assessment.execution_attempt_claim_sha256, claim.claim_sha256)
  assert.equal(assessment.assessment_sha256, sha256Canonical(Object.fromEntries(Object.entries(assessment).filter(([key]) => key !== 'assessment_sha256'))))
  const failure = readCanonical(root, 'control/execution-attempt-failure.json').value
  assert.equal(failure.schema_id, 'oracle-lab-p3b-execution-attempt-failure.v1')
  assert.equal(failure.execution_attempt_claim_sha256, claim.claim_sha256)
  assert.equal(failure.execution_evidence_assessment_sha256, assessment.assessment_sha256)
  assert.equal(failure.failure_stage, 'sealed_prelaunch_validation')
  assert.equal(failure.cause_code, 'filesystem_enoent')
  assert.deepEqual(failure.preexisting_execution_evidence, [])
  assert.equal(failure.terminal_status, 'CLOSED_BEFORE_LIVE_IO')
  assert.equal(failure.failure_disposition, 'close_attempt_and_start_fresh_preparation')
  assert.equal(failure.failure_sha256, sha256Canonical(Object.fromEntries(Object.entries(failure).filter(([key]) => key !== 'failure_sha256'))))

  await assert.rejects(runExecuteFromSealedPrelaunch(root), (error: Error & { code?: string }) => error.code === 'execution_resume_forbidden')
})

test('RED: real execute CLI claims and closes before fallible external validation', async () => {
  const root = privateRoot('p3b-execution-cli-claim-')
  createPrivateDirectory(root, 'control')
  const authorityPath = path.join(root, 'phase3b-operator-authority.json')
  const inputPath = path.join(root, 'phase3b-campaign-input.json')
  const args = ['--mode', 'execute-from-sealed-prelaunch', '--operator-authority', authorityPath, '--campaign-input', inputPath, '--evidence-root', root]

  await assert.rejects(campaignMain(args), (error: NodeJS.ErrnoException) => error.code === 'ENOENT')
  const claim = readCanonical(root, 'control/execution-attempt.json').value
  const assessment = readCanonical(root, 'control/execution-evidence-assessment.json').value
  const failure = readCanonical(root, 'control/execution-attempt-failure.json').value
  assert.equal(assessment.status, 'CLEAR')
  assert.equal(failure.execution_attempt_claim_sha256, claim.claim_sha256)
  assert.equal(failure.failure_stage, 'external_control_validation')
  assert.equal(failure.cause_code, 'filesystem_enoent')
  assert.equal(failure.epoch_consumed, false)
  assert.deepEqual([failure.receiver_binds, failure.target_launches, failure.sockets], [0, 0, 0])
  assert.equal(failure.same_attempt_resume_allowed, false)
  assert.equal(failure.automatic_retry_allowed, false)
  await assert.rejects(campaignMain(args), (error: Error & { code?: string }) => error.code === 'execution_resume_forbidden')
})

test('RED: preexisting execution evidence can never be closed as zero live I/O', async () => {
  const root = privateRoot('p3b-execution-preexisting-')
  createPrivateDirectory(root, 'control')
  createPrivateDirectory(root, 'execution-records')
  createPrivateDirectory(root, 'observations')
  writeExclusiveCanonical(root, 'observations/stale.json', { schema_id: 'stale-execution-evidence.v1' })

  await assert.rejects(runExecuteFromSealedPrelaunch(root), (error: Error & { code?: string }) => error.code === 'execution_evidence_preexisting')
  const claim = readCanonical(root, 'control/execution-attempt.json').value
  assert.equal(claim.attempt_state_at_claim, 'UNVERIFIED')
  assert.equal(claim.epoch_consumed_at_claim, null)
  const assessment = readCanonical(root, 'control/execution-evidence-assessment.json').value
  assert.equal(assessment.status, 'BLOCKED')
  assert.deepEqual(assessment.preexisting_execution_evidence, ['execution-records', 'observations'])
  const failure = readCanonical(root, 'control/execution-attempt-failure.json').value
  assert.equal(failure.failure_stage, 'execution_evidence_assessment')
  assert.equal(failure.cause_code, 'execution_evidence_preexisting')
  assert.deepEqual(failure.preexisting_execution_evidence, ['execution-records', 'observations'])
  assert.equal(failure.consumption_status, 'UNKNOWN_OR_CONSUMED')
  assert.equal(failure.epoch_consumed, null)
  assert.deepEqual([failure.receiver_binds, failure.target_launches, failure.sockets], [null, null, null])
  assert.equal(failure.failure_disposition, 'root_cause_review_and_fresh_admission_required')
  assert.equal(failure.terminal_status, 'CLOSED_UNVERIFIED_LIVE_IO_STATE')
  await assert.rejects(runExecuteFromSealedPrelaunch(root), (error: Error & { code?: string }) => error.code === 'execution_resume_forbidden')
})

test('RED: orphaned failure control cannot mask the new terminal claim', async () => {
  const root = privateRoot('p3b-execution-orphaned-control-')
  createPrivateDirectory(root, 'control')
  writeExclusiveCanonical(root, 'control/execution-attempt-failure.json', { schema_id: 'malformed-orphan.v1' })

  await assert.rejects(runExecuteFromSealedPrelaunch(root), (error: Error & { code?: string }) => error.code === 'execution_control_evidence_preexisting')
  const claim = readCanonical(root, 'control/execution-attempt.json').value
  assert.equal(claim.attempt_state_at_claim, 'BLOCKED_PREEXISTING_CONTROL_EVIDENCE')
  assert.deepEqual(claim.preexisting_control_evidence, ['control/execution-attempt-failure.json'])
  assert.equal(claim.failure_disposition_at_claim, 'root_cause_review_and_fresh_admission_required')
  assert.equal(claim.terminal_status_at_claim, 'CLOSED_UNVERIFIED_CONTROL_STATE')
  assert.equal(claim.claim_sha256, sha256Canonical(Object.fromEntries(Object.entries(claim).filter(([key]) => key !== 'claim_sha256'))))
  await assert.rejects(runExecuteFromSealedPrelaunch(root), (error: Error & { code?: string }) => error.code === 'execution_resume_forbidden')
})

test('RED: failure sealing rechecks live evidence created after the initial assessment', () => {
  const root = privateRoot('p3b-execution-late-evidence-')
  createPrivateDirectory(root, 'control')
  createPrivateDirectory(root, 'receiver-authorities')

  const failure = sealExecutionAttemptFailure(
    root,
    { claim_sha256: 'a'.repeat(64) },
    'b'.repeat(64),
    [],
    'external_control_validation',
    Object.assign(new Error('late failure'), { code: 'EIO' }),
  )

  assert.deepEqual(failure.preexisting_execution_evidence, ['receiver-authorities'])
  assert.equal(failure.consumption_status, 'UNKNOWN_OR_CONSUMED')
  assert.equal(failure.epoch_consumed, null)
  assert.deepEqual([failure.receiver_binds, failure.target_launches, failure.sockets], [null, null, null])
  assert.equal(failure.terminal_status, 'CLOSED_UNVERIFIED_LIVE_IO_STATE')
})

test('RED: claimed live execution and finalization share one terminal failure boundary', () => {
  const source = readFileSync(new URL('../tools/oracle-lab/phase3b-evidence-sufficiency/campaign-controller.ts', import.meta.url), 'utf8')
  assert.match(source, /async function executeAndFinalizeClaimedCampaign\([^]*catch \(error: unknown\) \{[^]*sealExecutionAttemptFailure\(/)
  assert.match(source, /readCampaignFailure\(store\)[^]*sealExecutionAttemptFailure\([^]*'live_execution'/)
})

test('RED: a final-row post-terminal failure can never report all rows complete', () => {
  const successReceipts = Array.from({ length: 340 }, () => ({ terminal_class: 'success' }))
  assert.equal(executionCompletedAllRows(successReceipts, null), true)
  assert.equal(executionCompletedAllRows(successReceipts, { failing_sequence_index: 339, failure_family: 'post_terminal_artifact_failure' }), false)
})

test('pre-spawn first failure closes all 340 rows from sealed state without caller counts', () => {
  const root = privateRoot('p3b-receipts-')
  const ledger = buildCampaignLedger('p3b-focused-receipts', TEST_C1)
  const store = openExecutionStore(root, ledger)
  const failure = sealPreSpawnFailure(store, ledger.rows[0], 'authority_drift')
  const receipts = readExecutionReceipts(store)
  assert.equal(failure.failing_sequence_index, 0)
  assert.equal(failure.failure_family, 'campaign_execution_failure')
  assert.equal(receipts.length, 340)
  assert.ok(receipts.every((receipt, index) => receipt.sequence_index === index && receipt.state === 'not_executed' && receipt.terminal_class === 'not_executed'))
  assert.deepEqual(deriveExecutionCounts(store), { planned: 340, started: 0, spawned: 0, terminal: 0, not_executed: 340 })
  assert.equal(readCampaignFailure(store)?.failure_sha256, failure.failure_sha256)
  assert.throws(() => sealPreSpawnFailure(store, ledger.rows[0], 'second_failure'), (error: Error & { code?: string }) => error.code === 'campaign_failure_invalid')
})

test('auth projection recognizes only fixed synthetic marker values', () => {
  assert.equal(classifySyntheticAuthHeader('x-api-key', 'oracle-phase3b-placeholder:auth-api-key-a'), 'api-key-a')
  assert.equal(classifySyntheticAuthHeader('authorization', 'Bearer oracle-phase3b-placeholder:auth-token-b'), 'auth-token-b')
  assert.equal(classifySyntheticAuthHeader('x-api-key', 'caller-selected-value'), null)
})

test('campaign CLI rejects missing and unknown arguments before side effects', async () => {
  await assert.rejects(campaignMain([]), (error: Error & { code?: string }) => error.code === 'runner_cli_invalid')
  await assert.rejects(campaignMain(['--mode', 'prelaunch-only', '--operator-authority', 'a', '--campaign-input', 'b', '--evidence-root', 'c', '--now-ms', '0']), (error: Error & { code?: string }) => error.code === 'runner_cli_invalid')
})

test('curation and exact five-record closeout derive Unknown/disabled only from sealed receipts', () => {
  const root = privateRoot('p3b-closeout-')
  createPrivateDirectory(root, 'prelaunch')
  const ledger = buildCampaignLedger('p3b-focused-closeout', TEST_C1)
  writeExclusiveCanonical(root, 'prelaunch/run-ledger.json', ledger)
  writeExclusiveCanonical(root, 'prelaunch/static-anchor.json', { schema_id: 'oracle-lab-p3b-test-static-anchor.v1', target_profile: TARGET_PROFILE })
  const store = openExecutionStore(root, ledger)
  sealPreSpawnFailure(store, ledger.rows[0], 'authority_drift')
  const curation = deriveCuration(root)
  assert.equal(curation.status, 'Unknown')
  assert.equal((curation.rows as Array<Record<string, unknown>>).length, 340)
  assert.ok((curation.rows as Array<Record<string, unknown>>).every((row) => row.status === 'Unknown' && row.enabled === false))
  const closeout = runCloseout(root)
  assert.equal(closeout.status, 'BLOCKED')
  assert.equal(closeout.phase3b_usable, false)
  const external = validateExternalSet(root)
  assert.deepEqual((external.records as Array<Record<string, unknown>>).map((record) => record.name), ['artifact-index', 'leak-report', 'exit-report', 'handoff', 'terminal-manifest'])
  assert.equal(SUPPORT_PATHS.length, 5)
  assert.equal(validateConclusionSupport(root, false).length, 5)
  assert.throws(() => validateConclusionSupport(root, true), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
  createPrivateDirectory(root, 'runs')
  writeExclusiveCanonical(root, 'runs/unindexed-extra.json', { schema_id: 'unexpected.v1', value: 'caller-leftover' })
  assert.throws(() => validateArtifactIndexCoverage(root, readCanonical(root, 'capsules/P3B-ES1/closure/artifact-index.json', 16_777_216).value), (error: Error & { code?: string }) => error.code === 'artifact_index_invalid')
  const provenance = readCanonical(root, SUPPORT_PATHS[2], 16_777_216).value
  const unsigned: Record<string, unknown> = { ...provenance, coverage: { ...(provenance.coverage as Record<string, unknown>), represented_pointer_count: 339 } }
  delete unsigned.support_sha256
  const drifted = { ...unsigned, support_sha256: sha256Canonical(unsigned) }
  writeFileSync(path.join(root, SUPPORT_PATHS[2]), `${canonicalJson(drifted)}\n`, 'utf8')
  assert.throws(() => validateConclusionSupport(root, false), (error: Error & { code?: string }) => error.code === 'conclusion_support_invalid')
})
