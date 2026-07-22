import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const output = process.env.ORACLE_PHASE3A_HOOK_OUTPUT
const limit = Math.max(1, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_EVENTS || 10000), 10000))
const byteLimit = Math.max(1024, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_BYTES || 8 * 1024 * 1024), 8 * 1024 * 1024))
let sequence = 0
let bytes = 0
let writing = false
const hash = (value) => createHash('sha256').update(String(value)).digest('hex')
function emit(kind, value) {
  if (!output || writing || sequence >= limit) return
  writing = true
  try {
    const line = `${JSON.stringify({ schema_version: 'oracle-lab-phase3a-loader.v1', sequence: sequence++, monotonic_ns: process.hrtime.bigint().toString(), pid: process.pid, kind, specifier_sha256: hash(value) })}\n`
    const size = Buffer.byteLength(line)
    if (bytes + size <= byteLimit) { appendFileSync(output, line, { mode: 0o600 }); bytes += size }
  } catch {} finally { writing = false }
}

export async function resolve(specifier, context, nextResolve) {
  emit('module.resolve', specifier)
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  emit('module.load', url)
  return nextLoad(url, context)
}
