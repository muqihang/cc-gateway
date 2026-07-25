import { fork, type ChildProcess } from 'node:child_process'
import { closeSync, constants as fsConstants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  EvidenceSufficiencyError,
  canonicalEvidenceBytes,
  isLoopbackAddress,
  sha256Bytes,
} from './core.js'
import { normalizeWireRequest, type SyntheticLiteralTable } from './normalize-request.js'
import {
  buildScenarioPrograms,
  materializeScenarioResponse,
  normalizeScenarioResponse,
  type FailureProgramId,
  type ScenarioAction,
} from './normalize-response.js'
import {
  assertActiveStaticAnchorAuthorityStable,
  receiverRuntimeFiles,
  resolveActiveStaticAnchorAuthority,
  type VerifiedActiveStaticAnchor,
} from './static-anchor.js'

export type ReceiverArm = 'instrumented' | 'uninstrumented' | 'control/instrumented' | 'control/uninstrumented' | 'treatment/instrumented' | 'treatment/uninstrumented'

export type NormalizedSafeReceiverConfig = {
  evidence_root: string
  output_relative_prefix: 'capsules/P3B-ES1/observations/receiver' | `${string}/receiver`
  campaign_id: string
  cell_id: string
  pair_id: string
  arm: ReceiverArm
  repetition: number
  deterministic_seed: number
  sequence_index: number
  active_static_anchor_sha256: string
  base_url_provenance_ref: string
  scenario_id: FailureProgramId
  literal_table: SyntheticLiteralTable
  synthetic_auth_markers: Record<string, string>
  limits: { body_bytes: number; headers: number; events: number; attempts: number }
  max_requests: number
  verified_active_static_anchor?: VerifiedActiveStaticAnchor
}

export type NormalizedSafeReceiver = {
  host: '127.0.0.1'
  port: number
  receiver_process_digest: string
  receiver_source_sha256: string
  active_static_anchor_sha256: string
  observation_relative_paths: string[]
  done: Promise<void>
  close(): Promise<void>
}

export type SpawnedNormalizedSafeReceiver = NormalizedSafeReceiver & { child: ChildProcess }

function fail(code: string, message: string): never {
  throw new EvidenceSufficiencyError(code, message)
}

function createModulePrivateReceiverWriter(rootInput: string): (relative: string, value: unknown) => void {
  if (process.env.ORACLE_P3B_RECEIVER_CHILD !== '1' || typeof process.send !== 'function' || process.argv[2] !== '--receiver-child') {
    fail('writer_namespace_violation', 'receiver writer is available only inside the dedicated IPC child')
  }
  const root = realpathSync(path.resolve(rootInput))
  if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) fail('evidence_root_unsafe', 'receiver evidence root is unsafe')
  return (relativeInput, value) => {
    if (!/^capsules\/P3B-ES1\/observations\/receiver\/[A-Za-z0-9._/-]+\.json$/.test(relativeInput) || relativeInput.split('/').includes('..')) {
      fail('writer_namespace_violation', 'receiver artifact path is outside the exclusive namespace')
    }
    const destination = path.resolve(root, ...relativeInput.split('/'))
    const relative = path.relative(root, destination)
    if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('writer_namespace_violation', 'receiver artifact path escapes evidence root')
    let cursor = root
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment)
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('source_binding_invalid', 'receiver artifact path contains a symlink')
    }
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
    const payload = canonicalEvidenceBytes(value)
    let descriptor: number | undefined
    try {
      descriptor = openSync(destination, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
      let offset = 0
      while (offset < payload.length) offset += writeSync(descriptor, payload, offset, payload.length - offset)
      fsyncSync(descriptor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('evidence_exists', 'append-only receiver artifact already exists')
      throw error
    } finally { if (descriptor !== undefined) closeSync(descriptor) }
  }
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) { resolve(); return }
    server.close(() => resolve())
  })
}

function validateConfig(config: NormalizedSafeReceiverConfig): void {
  if (!config.output_relative_prefix.startsWith('capsules/P3B-ES1/observations/receiver')) fail('writer_namespace_violation', 'receiver output prefix is outside its namespace')
  for (const [label, value] of Object.entries({
    campaign_id: config.campaign_id, cell_id: config.cell_id, pair_id: config.pair_id,
  })) if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(value)) fail('schema_invalid', `${label} is not a safe identifier`)
  if (!Number.isInteger(config.repetition) || config.repetition < 0 || config.repetition > 4) fail('schema_invalid', 'repetition is outside 0..4')
  if (!Number.isSafeInteger(config.deterministic_seed) || !Number.isSafeInteger(config.sequence_index) || config.sequence_index < 0) fail('schema_invalid', 'seed or sequence index is invalid')
  if (!/^[a-f0-9]{64}$/.test(config.active_static_anchor_sha256)) fail('paired_perturbation', 'expected active static anchor digest is missing or malformed')
  if (!Number.isInteger(config.max_requests) || config.max_requests < 1 || config.max_requests > config.limits.attempts) fail('receiver_attempt_overflow', 'max requests exceeds attempt budget')
  if (config.limits.body_bytes < 1 || config.limits.headers < 1 || config.limits.events < 1 || config.limits.attempts < 1) fail('schema_invalid', 'receiver limits must be positive')
}

function actionHeaders(action: ScenarioAction): Record<string, string> {
  const output: Record<string, string> = {}
  for (const header of action.ordered_headers) {
    if (header.name === 'content-type') output['Content-Type'] = header.value_class === 'text-event-stream' ? 'text/event-stream' : 'application/json'
  }
  output.Connection = 'close'
  return output
}

function respond(res: ServerResponse, req: IncomingMessage, action: ScenarioAction, bytes: Buffer, finish: () => void): void {
  if (action.kind === 'reset_terminal' || action.kind === 'reset_before_headers') {
    req.socket.destroy()
    finish()
    return
  }
  const send = (): void => {
    res.writeHead(action.status ?? 500, actionHeaders(action))
    res.end(bytes, finish)
  }
  if (action.delay_ms > 0) setTimeout(send, action.delay_ms)
  else send()
}

async function runDedicatedReceiver(config: NormalizedSafeReceiverConfig): Promise<NormalizedSafeReceiver> {
  validateConfig(config)
  if (!config.verified_active_static_anchor) fail('source_binding_invalid', 'verified active static anchor authority is required')
  assertActiveStaticAnchorAuthorityStable(config.verified_active_static_anchor)
  if (config.verified_active_static_anchor.campaign_id !== config.campaign_id
    || config.verified_active_static_anchor.active_static_anchor_sha256 !== config.active_static_anchor_sha256) {
    fail('paired_perturbation', 'receiver config differs from verified active static anchor authority')
  }
  const writeReceiverObservation = createModulePrivateReceiverWriter(config.evidence_root)
  const receiverIdentity = config.verified_active_static_anchor.receiver_identity
  const receiverProcessDigest = receiverIdentity.digest
  const scenario = buildScenarioPrograms(config.campaign_id, config.literal_table).failure_programs
    .find((program) => program.scenario_id === config.scenario_id)
  if (!scenario) fail('schema_invalid', 'receiver scenario is not in the exact program set')

  let connectionOrdinal = 0
  let attemptOrdinal = 0
  let settled = false
  let doneResolve!: () => void
  const done = new Promise<void>((resolve) => { doneResolve = resolve })
  const observationRelativePaths: string[] = []
  const terminalDeny = (response: ServerResponse, status: number, code: string): void => {
    response.writeHead(status, { 'X-Oracle-Deny-Code': code, Connection: 'close' })
    response.end(() => { void closeServer(server) })
  }
  const server = http.createServer((request, response) => {
    const currentConnection = connectionOrdinal++
    const currentAttempt = attemptOrdinal++
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      return terminalDeny(response, 403, 'receiver_non_loopback')
    }
    if (currentAttempt >= config.limits.attempts) {
      return terminalDeny(response, 429, 'receiver_attempt_overflow')
    }
    if (request.rawHeaders.length / 2 > config.limits.headers) {
      return terminalDeny(response, 431, 'receiver_header_overflow')
    }
    const controlledAction = scenario.actions[currentAttempt]
    if (!controlledAction) {
      return terminalDeny(response, 409, 'attempt_sequence_invalid')
    }
    const chunks: Buffer[] = []
    let total = 0
    let overflow = false
    request.on('data', (chunkInput: Buffer | string) => {
      const chunk = Buffer.isBuffer(chunkInput) ? Buffer.from(chunkInput) : Buffer.from(chunkInput)
      total += chunk.length
      if (total > config.limits.body_bytes) {
        overflow = true
        chunk.fill(0)
        for (const buffered of chunks) buffered.fill(0)
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (overflow) {
        return terminalDeny(response, 413, 'receiver_body_overflow')
      }
      const body = Buffer.concat(chunks)
      for (const chunk of chunks) chunk.fill(0)
      try {
        const requestProjection = normalizeWireRequest({
          method: request.method ?? 'UNKNOWN',
          request_target: request.url ?? '/',
          raw_headers: request.rawHeaders,
          body,
          literal_table: config.literal_table,
          synthetic_auth_markers: config.synthetic_auth_markers,
          limits: { body_bytes: config.limits.body_bytes, headers: config.limits.headers },
        })
        body.fill(0)
        const materializedResponse = materializeScenarioResponse(controlledAction, config.literal_table)
        const responseProjection = normalizeScenarioResponse(materializedResponse.bytes, controlledAction, config.literal_table)
        if (responseProjection.event_sequence.length > config.limits.events) fail('receiver_event_overflow', 'receiver event limit exceeded')
        const relative = `${config.output_relative_prefix}/${config.cell_id}-attempt-${currentAttempt}.json`
        const observation = {
          schema_id: 'oracle-lab-p3b-es-receiver-observation.v1',
          schema_major: 1,
          schema_revision: 0,
          campaign_id: config.campaign_id,
          cell_id: config.cell_id,
          pair_id: config.pair_id,
          arm: config.arm,
          repetition: config.repetition,
          deterministic_seed: config.deterministic_seed,
          sequence_index: config.sequence_index,
          receiver_process_digest: receiverProcessDigest,
          receiver_source_sha256: receiverIdentity.source_sha256,
          active_static_anchor_sha256: config.verified_active_static_anchor.active_static_anchor_sha256,
          receiver_authority: 'wire-leaf-exclusive',
          authority_class: 'synthetic-loopback',
          base_url_provenance_ref: config.base_url_provenance_ref,
          ...requestProjection,
          connection_ordinal: currentConnection,
          attempt_ordinal: currentAttempt,
          scenario_action_ordinal: controlledAction.action_ordinal,
          response_program_ref: config.scenario_id,
          response_projection: responseProjection,
          wire_action_completed: true,
          raw_material_persisted: false,
        }
        const finish = (): void => {
          assertActiveStaticAnchorAuthorityStable(config.verified_active_static_anchor!)
          writeReceiverObservation(relative, observation)
          observationRelativePaths.push(relative)
          materializedResponse.bytes.fill(0)
          if (attemptOrdinal >= config.max_requests) void closeServer(server)
        }
        respond(response, request, controlledAction, materializedResponse.bytes, finish)
      } catch (error) {
        body.fill(0)
        const code = error instanceof EvidenceSufficiencyError ? error.code : 'receiver_internal_error'
        terminalDeny(response, code === 'leak_detected' ? 400 : 500, code)
      }
    })
  })
  server.once('close', () => { if (!settled) { settled = true; doneResolve() } })
  assertActiveStaticAnchorAuthorityStable(config.verified_active_static_anchor)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') fail('receiver_bind_failed', 'receiver did not bind TCP loopback')
  return {
    host: '127.0.0.1',
    port: address.port,
    receiver_process_digest: receiverProcessDigest,
    receiver_source_sha256: receiverIdentity.source_sha256,
    active_static_anchor_sha256: config.verified_active_static_anchor.active_static_anchor_sha256,
    observation_relative_paths: observationRelativePaths,
    done,
    close: async () => { await closeServer(server); if (!settled) { settled = true; doneResolve() } },
  }
}

type ChildReady = { kind: 'ready'; host: '127.0.0.1'; port: number; receiver_process_digest: string; receiver_source_sha256: string; active_static_anchor_sha256: string }
type ChildDone = { kind: 'done'; observation_relative_paths: string[] }
type ChildFailure = { kind: 'failure'; code: string }

export async function spawnNormalizedSafeReceiver(config: NormalizedSafeReceiverConfig): Promise<SpawnedNormalizedSafeReceiver> {
  validateConfig(config)
  const verifiedAnchor = resolveActiveStaticAnchorAuthority({
    evidence_root: config.evidence_root,
    expected_campaign_id: config.campaign_id,
    expected_active_static_anchor_sha256: config.active_static_anchor_sha256,
  })
  const childConfig: NormalizedSafeReceiverConfig = { ...config, verified_active_static_anchor: verifiedAnchor }
  const runtimeFiles = receiverRuntimeFiles()
  const child = fork(fileURLToPath(import.meta.url), ['--receiver-child'], {
    execPath: runtimeFiles.launcher_file,
    execArgv: ['--import', pathToFileURL(runtimeFiles.loader_file).href],
    env: { PATH: process.env.PATH, ORACLE_P3B_RECEIVER_CHILD: '1' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  const ready = await new Promise<ChildReady>((resolve, reject) => {
    const timer = setTimeout(() => reject(new EvidenceSufficiencyError('receiver_start_timeout', 'receiver child did not become ready')), 10_000)
    child.once('error', reject)
    child.on('message', (message: ChildReady | ChildFailure) => {
      if (message.kind === 'ready') { clearTimeout(timer); resolve(message) }
      if (message.kind === 'failure') { clearTimeout(timer); reject(new EvidenceSufficiencyError(message.code, 'receiver child rejected config')) }
    })
    child.send({ kind: 'configure', config: childConfig })
  })
  assertActiveStaticAnchorAuthorityStable(verifiedAnchor)
  if (ready.receiver_process_digest !== verifiedAnchor.receiver_identity.digest
    || ready.receiver_source_sha256 !== verifiedAnchor.receiver_identity.source_sha256
    || ready.active_static_anchor_sha256 !== verifiedAnchor.active_static_anchor_sha256) {
    child.kill('SIGKILL')
    fail('paired_perturbation', 'receiver child identity differs from the active source/anchor binding')
  }
  const observationRelativePaths: string[] = []
  let doneResolve!: () => void
  let doneReject!: (error: Error) => void
  const done = new Promise<void>((resolve, reject) => { doneResolve = resolve; doneReject = reject })
  child.on('message', (message: ChildDone | ChildFailure) => {
    if (message.kind === 'done') { observationRelativePaths.push(...message.observation_relative_paths); doneResolve() }
    if (message.kind === 'failure') doneReject(new EvidenceSufficiencyError(message.code, 'receiver child failed'))
  })
  child.once('exit', (status) => { if (status !== 0) doneReject(new EvidenceSufficiencyError('receiver_child_exit', `receiver child exited ${status}`)) })
  return {
    child,
    host: ready.host,
    port: ready.port,
    receiver_process_digest: ready.receiver_process_digest,
    receiver_source_sha256: ready.receiver_source_sha256,
    active_static_anchor_sha256: ready.active_static_anchor_sha256,
    observation_relative_paths: observationRelativePaths,
    done,
    close: async () => {
      if (child.connected) child.send({ kind: 'close' })
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    },
  }
}

if (process.argv[2] === '--receiver-child') {
  let receiver: NormalizedSafeReceiver | null = null
  process.on('message', async (message: { kind: string; config?: NormalizedSafeReceiverConfig }) => {
    try {
      if (message.kind === 'configure' && message.config && receiver === null) {
        receiver = await runDedicatedReceiver(message.config)
        process.send?.({ kind: 'ready', host: receiver.host, port: receiver.port, receiver_process_digest: receiver.receiver_process_digest, receiver_source_sha256: receiver.receiver_source_sha256, active_static_anchor_sha256: receiver.active_static_anchor_sha256 } satisfies ChildReady)
        await receiver.done
        process.send?.({ kind: 'done', observation_relative_paths: receiver.observation_relative_paths } satisfies ChildDone)
        process.exitCode = 0
        process.disconnect()
      } else if (message.kind === 'close' && receiver) {
        await receiver.close()
        process.exitCode = 0
        process.disconnect()
      }
    } catch (error) {
      process.send?.({ kind: 'failure', code: error instanceof EvidenceSufficiencyError ? error.code : 'receiver_internal_error' } satisfies ChildFailure)
      process.exitCode = 1
      process.disconnect()
    }
  })
}
