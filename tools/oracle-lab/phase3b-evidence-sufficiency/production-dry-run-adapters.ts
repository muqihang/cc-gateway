import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'
import http, { type IncomingMessage } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Phase3BProductionError, assertDigestField, assertExactKeys, canonicalBytes, deepFreeze, sha256Bytes, sha256Canonical } from './core.js'
import { evaluateGateB, type GateBEvaluationInput } from './gates.js'
import { buildResponseProgram, materializeResponseBody, type ResponseProgram } from './ledger.js'
import { readCanonical, stableRead } from './sealed-fs.js'
import { fixedGit } from './trust.js'

export type ProductionDryRunAdapters = Readonly<{ authority_kind: 'opaque-production-dry-run-adapters' }>
export type AdapterRuntimeIdentity = Readonly<{ child_pid: number; executable_path: string; executable_identity_sha256: string; receiver_identity_sha256: string }>

type CapturedAttempt = Readonly<{
  attempt_ordinal: number
  request: Readonly<Record<string, unknown>>
  response: Readonly<Record<string, unknown>>
  receiver_wire_events: readonly string[]
  receiver_wire_event_sha256: string
  monotonic_start_ns: string
  monotonic_terminal_ns: string
}>

export type CapturedTransportReceipt = Readonly<{
  schema_id: 'oracle-lab-p3b-captured-transport.v2'
  sequence_index: number
  run_id: string
  route_index: 0 | 1
  child_pid: number
  executable_path: string
  executable_identity_sha256: string
  receiver_listener_sha256: string
  peer: Readonly<{ remote_address: '127.0.0.1'; local_port: number }>
  attempts: readonly CapturedAttempt[]
  capture_sha256: string
}>

type PendingCapture = { sequence_index: number; run_id: string; route_index: 0 | 1; program: ResponseProgram; attempts: Array<{ request: Record<string, unknown>; receiverEvents: string[]; start: bigint; terminal: bigint }> }
type AdapterState = {
  child: ChildProcessWithoutNullStreams
  servers: readonly [http.Server, http.Server]
  routes: readonly [string, string]
  executableSha256: string
  trace?: (stage: string) => void
  wallMs: () => number
  monotonicNs: () => bigint
  securityPrivate: KeyObject | null
  securityPublic: KeyObject
  operatorPrivate: KeyObject | null
  operatorPublic: KeyObject
  signerDestroyed: boolean
  pending: Map<string, PendingCapture>
  stdoutBuffer: string
}

const adapterStates = new WeakMap<object, AdapterState>()
const capturedReceipts = new WeakSet<object>()
const runtimeIdentities = new WeakSet<object>()
const gateBEvaluations = new WeakSet<object>()

const CHILD_SCRIPT = String.raw`
const http=require('node:http'); const crypto=require('node:crypto'); const fs=require('node:fs');
const canon=(v)=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canon).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}';
const digest=(v)=>crypto.createHash('sha256').update(canon(v)).digest('hex');
const bytesDigest=(b)=>crypto.createHash('sha256').update(b).digest('hex');
const executable=crypto.createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex');
const requestOnce=(url,body,attempt)=>new Promise((resolve)=>{const start=process.hrtime.bigint();let chunks=[];let status=null;let settled=false;const done=value=>{if(!settled){settled=true;resolve(value)}};const req=http.request(url,{method:'POST',path:'/v1/messages',headers:{'content-type':'application/json','content-length':String(body.length),'x-attempt-ordinal':String(attempt)}},res=>{status=res.statusCode??0;const orderedHeaders=Object.keys(res.headers).map(v=>v.toLowerCase()).sort();res.on('data',c=>chunks.push(Buffer.from(c)));res.on('end',()=>{const bytes=Buffer.concat(chunks);const text=bytes.toString('utf8');const events=[...text.matchAll(/^event: ([^\n]+)$/gm)].map(match=>match[1]);const terminal=status===200&&String(res.headers['content-type']||'').startsWith('text/event-stream')&&!events.includes('message_stop')?'eof_after_partial':'http_complete';done({attempt_ordinal:attempt,status,ordered_header_classes:orderedHeaders,body_byte_length:bytes.length,body_sha256:bytesDigest(bytes),sse_event_order:events,transport_terminal:terminal,delay_elapsed_ns:(process.hrtime.bigint()-start).toString(),timing_bucket:'observed',wire_events:['headers','body','end'],wire_event_sha256:digest(['headers','body','end']),socket_close_had_error:false})});res.on('error',()=>{const bytes=Buffer.concat(chunks);done({attempt_ordinal:attempt,status,ordered_header_classes:orderedHeaders,body_byte_length:bytes.length,body_sha256:bytesDigest(bytes),sse_event_order:[],transport_terminal:'error',delay_elapsed_ns:(process.hrtime.bigint()-start).toString(),timing_bucket:'observed',wire_events:['headers','body','error'],wire_event_sha256:digest(['headers','body','error']),socket_close_had_error:true})})});req.on('error',()=>done({attempt_ordinal:attempt,status,ordered_header_classes:[],body_byte_length:0,body_sha256:bytesDigest(Buffer.alloc(0)),sse_event_order:[],transport_terminal:'reset_before_headers',delay_elapsed_ns:(process.hrtime.bigint()-start).toString(),timing_bucket:'observed',wire_events:['error','close'],wire_event_sha256:digest(['error','close']),socket_close_had_error:true}));req.end(body)});
let input=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',chunk=>{input+=chunk;let index;while((index=input.indexOf('\n'))>=0){const line=input.slice(0,index);input=input.slice(index+1);if(!line)continue;const command=JSON.parse(line);(async()=>{const attempts=[];for(let attempt=0;attempt<command.maximum_attempts;attempt++){const url=command.route_mode==='process-env'?process.env.ANTHROPIC_BASE_URL:command.selected_url;const body=Buffer.from(canon({model:'claude-sonnet-4-6',messages:[{role:'user',content:'synthetic-normalized-safe'}],sequence_index:command.sequence_index,run_id:command.run_id,attempt_ordinal:attempt}));attempts.push(await requestOnce(url,body,attempt))}process.stdout.write(JSON.stringify({schema_id:'oracle-lab-p3b-child-target.v1',sequence_index:command.sequence_index,run_id:command.run_id,route_mode:command.route_mode,actual_url:command.route_mode==='process-env'?process.env.ANTHROPIC_BASE_URL:command.selected_url,child_pid:process.pid,executable_path:process.execPath,executable_identity_sha256:executable,attempts,child_result_sha256:digest({schema_id:'oracle-lab-p3b-child-target.v1',sequence_index:command.sequence_index,run_id:command.run_id,route_mode:command.route_mode,actual_url:command.route_mode==='process-env'?process.env.ANTHROPIC_BASE_URL:command.selected_url,child_pid:process.pid,executable_path:process.execPath,executable_identity_sha256:executable,attempts})})+'\n')})().catch(()=>process.stdout.write(JSON.stringify({error:'child_dispatch_failed'})+'\n'))}});
process.stdout.write(JSON.stringify({ready:true,pid:process.pid,executable_path:process.execPath,executable_identity_sha256:executable,base_url:process.env.ANTHROPIC_BASE_URL})+'\n');
`

function childLine(state: AdapterState): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(deadline); state.child.stdout.off('data', onData) }
    const take = (): void => {
      const newline = state.stdoutBuffer.indexOf('\n')
      if (newline < 0) return
      const line = state.stdoutBuffer.slice(0, newline); state.stdoutBuffer = state.stdoutBuffer.slice(newline + 1)
      cleanup()
      try { resolve(JSON.parse(line) as Record<string, unknown>) } catch { reject(new Phase3BProductionError('external_fact_authority_invalid', 'synthetic child target response is invalid JSON')) }
    }
    const onData = (chunk: Buffer): void => { state.stdoutBuffer += chunk.toString('utf8'); take() }
    const deadline = setTimeout(() => { cleanup(); reject(new Phase3BProductionError('external_fact_authority_invalid', 'synthetic child target response timed out')) }, 30_000)
    state.child.stdout.on('data', onData)
    take()
  })
}

function bodyAst(body: Buffer): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(body.toString('utf8')) } catch { throw new Phase3BProductionError('external_fact_authority_invalid', 'receiver request body is not canonical JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).model !== 'claude-sonnet-4-6') throw new Phase3BProductionError('external_fact_authority_invalid', 'receiver request model is not the exact normalized-safe model')
  const record = parsed as Record<string, unknown>; const messages = record.messages
  return { model: 'claude-sonnet-4-6', message_count: Array.isArray(messages) ? messages.length : -1, sequence_index: record.sequence_index, attempt_ordinal: record.attempt_ordinal }
}

function requestObservation(req: IncomingMessage, body: Buffer): Record<string, unknown> {
  const ast = bodyAst(body); const astBytes = canonicalBytes(ast)
  const headers = Object.keys(req.headers).map((value) => value.toLowerCase()).sort()
  const normalized = Buffer.from(body)
  return { method: req.method, path: req.url, query_present: Boolean(req.url?.includes('?')), ordered_header_classes: headers, header_presence: headers, auth_marker_winner_class: 'none', body_byte_length: body.length, body_sha256: sha256Bytes(body), body_ast: ast, body_ast_sha256: sha256Bytes(astBytes), body_normalized_byte_length: normalized.length, body_normalized_sha256: sha256Bytes(normalized), body_roundtrip_sha256: sha256Bytes(canonicalBytes(ast)) }
}

async function listenServer(server: http.Server): Promise<number> { return new Promise((resolve, reject) => { server.listen(0, '127.0.0.1', () => resolve((server.address() as import('node:net').AddressInfo).port)); server.once('error', reject) }) }

export async function createProductionDryRunAdapters(trace?: (stage: string) => void): Promise<ProductionDryRunAdapters> {
  const pending = new Map<string, PendingCapture>()
  const servers: http.Server[] = []
  for (let route = 0; route < 2; route += 1) {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = []; const started = process.hrtime.bigint();
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        const body = Buffer.concat(chunks); let parsed: Record<string, unknown>
        try { parsed = JSON.parse(body.toString('utf8')) as Record<string, unknown> } catch { res.destroy(); return }
        const key = String(parsed.run_id); const capture = pending.get(key); if (!capture || capture.route_index !== route) { res.destroy(); return }
        const attempt = Number(parsed.attempt_ordinal); const action = capture.program.actions[attempt]; if (!action) { res.destroy(); return }
        const request = requestObservation(req, body); const receiverEvents = ['request_headers', 'request_body']
        const finish = (terminal: bigint): void => { capture.attempts.push({ request, receiverEvents, start: started, terminal }) }
        if (action.kind === 'reset') { receiverEvents.push('reset'); finish(process.hrtime.bigint()); res.destroy(); return }
        const send = (): void => {
          const responseBody = Buffer.from(materializeResponseBody(action.body_kind), 'utf8'); receiverEvents.push('response_headers'); res.writeHead(action.status ?? 500, { 'content-type': action.body_kind === 'complete_sse' || action.body_kind === 'partial_sse' ? 'text/event-stream' : 'application/json', 'content-length': String(responseBody.length) });
          if (responseBody.length > 0) { receiverEvents.push('response_body'); res.write(responseBody) }
          if (action.transport_terminal === 'eof_after_partial') receiverEvents.push('eof');
          receiverEvents.push('finish'); finish(process.hrtime.bigint()); res.end()
        }
        if (action.delay_ms > 0) setTimeout(send, action.delay_ms); else send()
      })
    }); servers.push(server)
  }
  const ports = [await listenServer(servers[0]), await listenServer(servers[1])] as const
  const child = spawn(process.execPath, ['-e', CHILD_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', ANTHROPIC_BASE_URL: `http://127.0.0.1:${String(ports[1])}` } })
  const security = generateKeyPairSync('ed25519'); const operator = generateKeyPairSync('ed25519')
  const state: AdapterState = { child, servers: servers as [http.Server, http.Server], routes: [`http://127.0.0.1:${String(ports[0])}`, `http://127.0.0.1:${String(ports[1])}`], executableSha256: stableRead(process.execPath, { maximumBytes: 268_435_456 }).identity.sha256, trace, wallMs: () => Date.now(), monotonicNs: () => process.hrtime.bigint(), securityPrivate: security.privateKey, securityPublic: security.publicKey, operatorPrivate: operator.privateKey, operatorPublic: operator.publicKey, signerDestroyed: false, pending, stdoutBuffer: '' }
  const ready = await childLine(state)
  if (ready.ready !== true || ready.pid !== child.pid || ready.executable_path !== process.execPath || ready.executable_identity_sha256 !== state.executableSha256 || ready.base_url !== state.routes[1]) {
    child.kill('SIGTERM'); await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))); throw new Phase3BProductionError('external_fact_authority_invalid', 'synthetic child target startup identity is not OS-bound')
  }
  const adapters = deepFreeze({ authority_kind: 'opaque-production-dry-run-adapters' as const }); adapterStates.set(adapters, state); return adapters
}

function stateOf(adapters: unknown): AdapterState {
  if (!adapters || typeof adapters !== 'object' || !adapterStates.has(adapters as object)) throw new Phase3BProductionError('external_fact_authority_invalid', 'internally created opaque production dry-run adapters are required')
  return adapterStates.get(adapters as object)!
}

export function adapterTrace(adapters: ProductionDryRunAdapters, stage: string): void { stateOf(adapters).trace?.(stage) }
export function adapterRoutes(adapters: ProductionDryRunAdapters): readonly [string, string] { return stateOf(adapters).routes }
export function adapterClock(adapters: ProductionDryRunAdapters): Readonly<{ wallMs: number; monotonicNs: string }> { const state = stateOf(adapters); return deepFreeze({ wallMs: state.wallMs(), monotonicNs: state.monotonicNs().toString() }) }
export function adapterRuntimeIdentity(adapters: ProductionDryRunAdapters): AdapterRuntimeIdentity {
  const state = stateOf(adapters); const executablePath = state.child.spawnfile; if (!executablePath) throw new Phase3BProductionError('external_fact_authority_invalid', 'synthetic child executable path is absent')
  if (!state.child.pid || state.child.exitCode !== null) throw new Phase3BProductionError('external_fact_authority_invalid', 'synthetic child OS process identity drifted')
  const identity = deepFreeze({ child_pid: state.child.pid, executable_path: executablePath, executable_identity_sha256: state.executableSha256, receiver_identity_sha256: sha256Canonical({ child_pid: state.child.pid, routes: state.routes, listener_pids: state.servers.map((server) => server.address()) }) })
  runtimeIdentities.add(identity)
  return identity
}

export function assertAdapterRuntimeIdentity(value: unknown): asserts value is AdapterRuntimeIdentity { if (!value || typeof value !== 'object' || !runtimeIdentities.has(value as object)) throw new Phase3BProductionError('external_fact_authority_invalid', 'opaque OS-observed adapter runtime identity is required') }

function programForInput(input: Readonly<Record<string, unknown>>): ResponseProgram { if (typeof input.response_program_sha256 !== 'string' || typeof input.response_program_id !== 'string') throw new Phase3BProductionError('external_fact_authority_invalid', 'production dispatch must bind the frozen response program'); const program = buildResponseProgram(input.response_program_id); if (program.program_sha256 !== input.response_program_sha256) throw new Phase3BProductionError('external_fact_authority_invalid', 'production dispatch response program digest drifted'); return program }

export async function dispatchCapturedTransport(adapters: ProductionDryRunAdapters, input: Readonly<{ sequence_index: number; run_id: string; selected_url: string; route_mode: 'local' | 'process-env'; response_program_id: string; response_program_sha256: string }>): Promise<CapturedTransportReceipt> {
  const state = stateOf(adapters); const routeIndexRaw = state.routes.indexOf(input.selected_url); if (routeIndexRaw !== 0 && routeIndexRaw !== 1) throw new Phase3BProductionError('external_fact_authority_invalid', 'selected URL is outside the child receiver authority'); const routeIndex = routeIndexRaw as 0 | 1
  const program = programForInput(input); const pending: PendingCapture = { sequence_index: input.sequence_index, run_id: input.run_id, route_index: routeIndex, program, attempts: [] }; state.pending.set(input.run_id, pending)
  state.child.stdin.write(`${JSON.stringify({ sequence_index: input.sequence_index, run_id: input.run_id, selected_url: input.selected_url, route_mode: input.route_mode, maximum_attempts: program.maximum_attempts })}\n`)
  const childResult = await childLine(state); state.pending.delete(input.run_id)
  assertExactKeys(childResult, ['schema_id', 'sequence_index', 'run_id', 'route_mode', 'actual_url', 'child_pid', 'executable_path', 'executable_identity_sha256', 'attempts', 'child_result_sha256'], 'external_fact_authority_invalid')
  assertDigestField(childResult, 'child_result_sha256', 'external_fact_authority_invalid')
  if (childResult.child_result_sha256 !== sha256Canonical(Object.fromEntries(Object.entries(childResult).filter(([key]) => key !== 'child_result_sha256')))) throw new Phase3BProductionError('external_fact_authority_invalid', 'child target result digest drifted')
  const runtime = adapterRuntimeIdentity(adapters); const actualUrl = String(childResult.actual_url ?? ''); if (input.route_mode === 'process-env' && actualUrl !== state.routes[1]) throw new Phase3BProductionError('external_fact_authority_invalid', 'child process environment did not select route 1'); if (input.route_mode === 'local' && actualUrl !== input.selected_url) throw new Phase3BProductionError('external_fact_authority_invalid', 'child local route did not select the sealed URL')
  if (childResult.schema_id !== 'oracle-lab-p3b-child-target.v1' || childResult.sequence_index !== input.sequence_index || childResult.run_id !== input.run_id || childResult.child_pid !== runtime.child_pid || childResult.executable_path !== runtime.executable_path || childResult.executable_identity_sha256 !== runtime.executable_identity_sha256 || !Array.isArray(childResult.attempts) || pending.attempts.length !== program.maximum_attempts) throw new Phase3BProductionError('external_fact_authority_invalid', 'child target or receiver capture is incomplete')
  const childAttempts = childResult.attempts as Array<Record<string, unknown>>; const attempts: CapturedAttempt[] = pending.attempts.map((capture, index) => { const response = childAttempts[index]; if (!response || response.attempt_ordinal !== index) throw new Phase3BProductionError('external_fact_authority_invalid', 'child response attempt ordinal drifted'); const request = capture.request; const receiverEvents = capture.receiverEvents; const unsignedResponse = { ...response, receiver_wire_events: receiverEvents, receiver_wire_event_sha256: sha256Canonical(receiverEvents), monotonic_start_ns: capture.start.toString(), monotonic_terminal_ns: capture.terminal.toString() }; return deepFreeze({ attempt_ordinal: index, request, response: unsignedResponse, receiver_wire_events: receiverEvents, receiver_wire_event_sha256: sha256Canonical(receiverEvents), monotonic_start_ns: capture.start.toString(), monotonic_terminal_ns: capture.terminal.toString() }) })
  const unsigned = { schema_id: 'oracle-lab-p3b-captured-transport.v2' as const, sequence_index: input.sequence_index, run_id: input.run_id, route_index: routeIndex, child_pid: runtime.child_pid, executable_path: runtime.executable_path, executable_identity_sha256: runtime.executable_identity_sha256, receiver_listener_sha256: sha256Canonical({ child_pid: runtime.child_pid, routes: state.routes, listener_pids: state.servers.map((server) => server.address()) }), peer: { remote_address: '127.0.0.1' as const, local_port: Number(new URL(input.selected_url).port) }, attempts }
  const receipt = deepFreeze({ ...unsigned, capture_sha256: sha256Canonical(unsigned) }); capturedReceipts.add(receipt); return receipt
}

export function assertCapturedTransportReceipt(value: unknown): asserts value is CapturedTransportReceipt { if (!value || typeof value !== 'object' || !capturedReceipts.has(value as object)) throw new Phase3BProductionError('external_fact_authority_invalid', 'opaque captured transport receipt is required') }

export type SignedAuthority = Readonly<{ payload: Readonly<Record<string, unknown>>; signature: string; role: 'security_quality' | 'requirements'; authority_sha256: string }>

function signAuthority(state: AdapterState, role: SignedAuthority['role'], payload: Readonly<Record<string, unknown>>): SignedAuthority { const privateKey = role === 'security_quality' ? state.securityPrivate : state.operatorPrivate; if (!privateKey || state.signerDestroyed) throw new Phase3BProductionError('signer_lifecycle_invalid', 'independent signer is unavailable'); const unsigned = { payload, signature: sign(null, canonicalBytes(payload), privateKey).toString('base64'), role }; return deepFreeze({ ...unsigned, authority_sha256: sha256Canonical(unsigned) }) }

export function issueIndependentGateAuthorities(adapters: ProductionDryRunAdapters, evidenceRoot: string): Readonly<{ gateA: SignedAuthority; operator: SignedAuthority }> {
  const state = stateOf(adapters); const ledger = readCanonical(evidenceRoot, 'prelaunch/run-ledger.json').value; const curation = readCanonical(evidenceRoot, 'capsules/P3B-ES1/curation/result.json').value; const external = readCanonical(evidenceRoot, 'capsules/P3B-ES1/closure/external-digest-set.json').value; const leak = readCanonical(evidenceRoot, 'capsules/P3B-ES1/closure/leak-report.json').value; const conclusions = ['config-auth-revalidated', 'new-session-wire', 'failure-recovery'].map((name) => readCanonical(evidenceRoot, `capsules/P3B-ES1/curation/conclusions-final/${name}.json`).value)
  if (curation.status !== 'Reproduced' || leak.status !== 'PASS' || !Array.isArray(leak.findings) || leak.findings.length !== 0 || conclusions.some((value) => value.level !== 'Reproduced' || value.enabled !== true || !Array.isArray(value.contradiction_ids) || value.contradiction_ids.length !== 0)) throw new Phase3BProductionError('gate_a_invalid', 'independent Gate A adapter observed incomplete sealed artifacts')
  const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
  const gatePayload = { schema_id: 'oracle-lab-p3b-independent-gate-a.v1', campaign_id: String(ledger.campaign_id), decision: 'PASS', phase3b_usable: false, curation_sha256: String(curation.curation_sha256), external_set_sha256: String(external.external_set_sha256), leak_report_sha256: String(leak.leak_report_sha256), conclusion_sha256s: conclusions.map((value) => String(value.conclusion_sha256)), reviewed_head_commit: fixedGit(repository, ['rev-parse', 'HEAD']), reviewed_head_tree: fixedGit(repository, ['rev-parse', 'HEAD^{tree}']), created_wall_ms: state.wallMs(), created_monotonic_ns: state.monotonicNs().toString() }
  const gateA = signAuthority(state, 'security_quality', gatePayload); const operatorPayload = { schema_id: 'oracle-lab-p3b-independent-operator-authority.v1', campaign_id: String(ledger.campaign_id), decision: 'evaluate_successor_amendment_startable', scope: 'phase3b-offline-synthetic-only', gate_a_sha256: gateA.authority_sha256, external_set_sha256: String(external.external_set_sha256), conclusion_sha256s: gatePayload.conclusion_sha256s, issued_wall_ms: state.wallMs(), issued_monotonic_ns: state.monotonicNs().toString(), expires_wall_ms: state.wallMs() + 1_209_600_000 }; return deepFreeze({ gateA, operator: signAuthority(state, 'requirements', operatorPayload) })
}

export function issueIndependentCampaignInputAuthority(adapters: ProductionDryRunAdapters, evidenceRoot: string): SignedAuthority {
  const state = stateOf(adapters); const input = readCanonical(evidenceRoot, 'control/campaign-input.json').value
  assertDigestField(input, 'input_sha256', 'external_fact_authority_invalid')
  return signAuthority(state, 'requirements', { schema_id: 'oracle-lab-p3b-independent-campaign-input-authority.v1', campaign_id: input.campaign_id, campaign_input_sha256: input.input_sha256, scope: 'phase3b-offline-synthetic-materialization-only', issued_wall_ms: state.wallMs(), issued_monotonic_ns: state.monotonicNs().toString() })
}

export function verifyIndependentGateAuthority(adapters: ProductionDryRunAdapters, authority: SignedAuthority, expectedRole: SignedAuthority['role']): void { const state = stateOf(adapters); const publicKey = expectedRole === 'security_quality' ? state.securityPublic : state.operatorPublic; const signature = Buffer.from(authority.signature, 'base64'); if (signature.length !== 64 || signature.toString('base64') !== authority.signature || authority.role !== expectedRole || authority.authority_sha256 !== sha256Canonical({ payload: authority.payload, signature: authority.signature, role: authority.role }) || !verify(null, canonicalBytes(authority.payload), publicKey, signature)) throw new Phase3BProductionError('external_fact_authority_invalid', 'independent Gate authority signature or role drifted') }

export type IndependentGateBEvaluation = Readonly<{ schema_id: 'oracle-lab-p3b-independent-gate-b-evaluation.v1'; input_raw_sha256: string; result: Readonly<Record<string, unknown>>; evaluation_sha256: string }>

export function evaluateIndependentGateB(adapters: ProductionDryRunAdapters, evidenceRoot: string): IndependentGateBEvaluation {
  stateOf(adapters)
  const inputRecord = readCanonical(evidenceRoot, 'production/gate-b-input.json')
  const result = evaluateGateB(inputRecord.value as unknown as GateBEvaluationInput)
  const unsigned = { schema_id: 'oracle-lab-p3b-independent-gate-b-evaluation.v1' as const, input_raw_sha256: inputRecord.identity.sha256, result }
  const evaluation = deepFreeze({ ...unsigned, evaluation_sha256: sha256Canonical(unsigned) })
  gateBEvaluations.add(evaluation)
  return evaluation
}

export function assertIndependentGateBEvaluation(value: unknown): asserts value is IndependentGateBEvaluation { if (!value || typeof value !== 'object' || !gateBEvaluations.has(value as object)) throw new Phase3BProductionError('gate_b_result_invalid', 'opaque independent Gate B evaluation is required') }

export function destroySignerAfterVerifiedGate(adapters: ProductionDryRunAdapters, input: Readonly<{ gate_b_result_sha256: string; revalidated: boolean }>): void { const state = stateOf(adapters); if (state.signerDestroyed || input.revalidated !== true || !/^[a-f0-9]{64}$/.test(input.gate_b_result_sha256)) throw new Phase3BProductionError('signer_lifecycle_invalid', 'signer destruction requires one independently revalidated sealed Gate B result'); state.securityPrivate = null; state.operatorPrivate = null; state.signerDestroyed = true }

export async function closeProductionDryRunAdapters(adapters: ProductionDryRunAdapters): Promise<void> {
  const state = stateOf(adapters)
  state.securityPrivate = null; state.operatorPrivate = null
  if (state.child.exitCode === null) await new Promise<void>((resolve) => { const done = (): void => resolve(); state.child.once('exit', done); if (!state.child.kill('SIGTERM') || state.child.exitCode !== null) { state.child.off('exit', done); resolve() } })
  await Promise.all(state.servers.map((server) => new Promise<void>((resolve) => { try { server.closeAllConnections(); server.close(() => resolve()) } catch { resolve() } })))
}
