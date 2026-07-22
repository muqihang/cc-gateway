import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const output = process.env.ORACLE_PHASE3A_HOOK_OUTPUT
let sequence = 0
const maximum = Math.max(1, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_EVENTS ?? 10_000), 10_000))
const byteLimit = Math.max(1024, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_BYTES ?? 8 * 1024 * 1024), 8 * 1024 * 1024))
let bytes = 0
const hash = (value: unknown): string => createHash('sha256').update(String(value)).digest('hex')
function emit(kind: string, detail: Record<string, unknown>): void {
  if (!output || sequence >= maximum) return
  try {
    const line = `${JSON.stringify({ schema_version: 'oracle-lab-phase3a-bun-hook.v1', sequence: sequence++, monotonic_ns: process.hrtime.bigint().toString(), pid: process.pid, kind, detail })}\n`
    const size = Buffer.byteLength(line)
    if (bytes + size <= byteLimit) { appendFileSync(output, line, { mode: 0o600 }); bytes += size }
  } catch {}
}

const originalFetch = globalThis.fetch
if (typeof originalFetch === 'function') {
  globalThis.fetch = async function phase3aFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let destination = 'request-object'
    try { destination = new URL(input instanceof Request ? input.url : String(input)).origin } catch {}
    emit('fetch', { destination_sha256: hash(destination), body_class: init?.body ? typeof init.body : 'absent' })
    return originalFetch.call(globalThis, input, init)
  }
}
emit('hook.ready', { runtime: `bun-${(globalThis as { Bun?: { version?: string } }).Bun?.version ?? 'unknown'}` })
