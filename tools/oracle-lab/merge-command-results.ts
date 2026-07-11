import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { cli, COMMIT_RE, DIGEST_RE, digestValue, exactKeys, isObject, parseArgs, readJson, result, writeJson, type HarnessErrorRecord, type HarnessResult } from './harness-core.js'

export type CommandStatus = 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
export type CommandResultRecord = {
  command_id: string
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  repository_commit: string
  manifest_digest: string
  environment_digest: string
  exit_code: number
  expected_exit: 0 | 'nonzero'
  status: CommandStatus
  duration_ms: number
  output_digest: string
  output_excerpt?: string
  result_digest: string
}
export type CommandResultSet = {
  schema_version: 1
  generated_at: string
  expires_at: string
  catalog_digest: string
  manifest_digest: string
  records: CommandResultRecord[]
  result_set_digest: string
}

const setFields = ['schema_version', 'generated_at', 'expires_at', 'catalog_digest', 'manifest_digest', 'records', 'result_set_digest'] as const
const recordFields = ['command_id', 'repository', 'repository_commit', 'manifest_digest', 'environment_digest', 'exit_code', 'expected_exit', 'status', 'duration_ms', 'output_digest', 'output_excerpt', 'result_digest'] as const

export function commandRecordDigest(record: Omit<CommandResultRecord, 'duration_ms' | 'result_digest'> & { duration_ms?: number }): string {
  const { duration_ms: _duration, ...stable } = record
  return digestValue(stable)
}

export function commandSetDigest(set: Omit<CommandResultSet, 'result_set_digest'>): string {
  const { generated_at: _generated, expires_at: _expires, ...stable } = set
  return digestValue({ ...stable, records: set.records.map(({ duration_ms: _duration, ...record }) => record) })
}

export function validateCommandResultsValue(value: unknown, now = Date.now(), allowExpired = false): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exactKeys(value, setFields, '$', errors)) return result(errors)
  if (value.schema_version !== 1) errors.push({ code: 'unsupported_schema_version', path: '$.schema_version', message: 'only schema_version 1 is supported' })
  if (!DIGEST_RE.test(String(value.catalog_digest)) || !DIGEST_RE.test(String(value.manifest_digest)) || !DIGEST_RE.test(String(value.result_set_digest))) errors.push({ code: 'invalid_digest', path: '$', message: 'result set digests are required' })
  const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires <= generated) errors.push({ code: 'invalid_expiry', path: '$.expires_at', message: 'invalid result expiry' })
  else if (!allowExpired && expires <= now) errors.push({ code: 'expired_results', path: '$.expires_at', message: 'command results have expired' })
  if (!Array.isArray(value.records)) errors.push({ code: 'invalid_records', path: '$.records', message: 'records must be an array' })
  else {
    const ids = new Set<string>()
    for (const [index, record] of value.records.entries()) {
      const base = `$.records[${index}]`
      if (!exactKeys(record, recordFields.filter((field) => field !== 'output_excerpt' || isObject(record) && field in record), base, errors)) continue
      if (typeof record.command_id !== 'string' || ids.has(record.command_id)) errors.push({ code: 'duplicate_command_id', path: `${base}.command_id`, message: 'command IDs must be unique' }); else ids.add(record.command_id)
      if (!['cc-gateway', 'sub2api', 'egress-tls-sidecar'].includes(String(record.repository)) || !COMMIT_RE.test(String(record.repository_commit))) errors.push({ code: 'invalid_repository_binding', path: base, message: 'invalid repository binding' })
      for (const field of ['manifest_digest', 'environment_digest', 'output_digest', 'result_digest'] as const) if (!DIGEST_RE.test(String(record[field]))) errors.push({ code: 'invalid_digest', path: `${base}.${field}`, message: `${field} is invalid` })
      if (record.manifest_digest !== value.manifest_digest) errors.push({ code: 'cross_manifest_results', path: `${base}.manifest_digest`, message: 'record manifest differs from set manifest' })
      if (!Number.isInteger(record.exit_code) || Number(record.exit_code) < 0 || !Number.isInteger(record.duration_ms) || Number(record.duration_ms) < 0) errors.push({ code: 'invalid_result', path: base, message: 'exit code and duration must be non-negative integers' })
      if (![0, 'nonzero'].includes(record.expected_exit as never) || !['pass', 'expected_fail', 'unexpected_fail', 'unexpected_pass'].includes(String(record.status))) errors.push({ code: 'invalid_result', path: base, message: 'invalid expected exit or status' })
      if ('output_excerpt' in record && (typeof record.output_excerpt !== 'string' || record.output_excerpt.length > 2048)) errors.push({ code: 'invalid_excerpt', path: `${base}.output_excerpt`, message: 'excerpt is invalid' })
      try {
        const { result_digest: _digest, duration_ms, ...rest } = record as unknown as CommandResultRecord
        if (record.result_digest !== commandRecordDigest({ ...rest, duration_ms })) errors.push({ code: 'result_digest_mismatch', path: `${base}.result_digest`, message: 'record digest mismatch' })
      } catch { errors.push({ code: 'result_digest_mismatch', path: `${base}.result_digest`, message: 'record digest mismatch' }) }
    }
    const typed = value as unknown as CommandResultSet
    const { result_set_digest: _digest, ...unsigned } = typed
    if (value.result_set_digest !== commandSetDigest(unsigned)) errors.push({ code: 'result_set_digest_mismatch', path: '$.result_set_digest', message: 'result set digest mismatch' })
  }
  return result(errors)
}

export function mergeCommandResults(inputs: unknown[], generatedAt = new Date().toISOString()): CommandResultSet {
  if (inputs.length === 0) throw Object.assign(new Error('at least one input is required'), { code: 'invalid_arguments' })
  const sets = inputs.map((input) => {
    const validation = validateCommandResultsValue(input, Date.now(), true)
    if (!validation.ok) throw Object.assign(new Error(JSON.stringify(validation.errors)), { code: validation.errors[0].code })
    return input as CommandResultSet
  })
  const manifest = sets[0].manifest_digest; const catalog = sets[0].catalog_digest
  if (sets.some((set) => set.manifest_digest !== manifest)) throw Object.assign(new Error('cannot merge cross-manifest results'), { code: 'cross_manifest_results' })
  if (sets.some((set) => set.catalog_digest !== catalog)) throw Object.assign(new Error('cannot merge cross-catalog results'), { code: 'cross_catalog_results' })
  const records = sets.flatMap((set) => set.records).sort((a, b) => a.command_id.localeCompare(b.command_id))
  const ids = new Set<string>(); const commits = new Map<string, string>()
  for (const record of records) {
    if (ids.has(record.command_id)) throw Object.assign(new Error(`${record.command_id} is duplicated`), { code: 'duplicate_command_id' }); ids.add(record.command_id)
    const repositoryKey = record.repository === 'egress-tls-sidecar' ? 'cc-gateway' : record.repository
    const previous = commits.get(repositoryKey)
    if (previous && previous !== record.repository_commit) throw Object.assign(new Error(`${repositoryKey} commit mismatch`), { code: 'cross_commit_results' })
    commits.set(repositoryKey, record.repository_commit)
  }
  const generated = new Date(generatedAt)
  const withoutDigest = { schema_version: 1 as const, generated_at: generated.toISOString(), expires_at: new Date(generated.getTime() + 7 * 86_400_000).toISOString(), catalog_digest: catalog, manifest_digest: manifest, records }
  return { ...withoutDigest, result_set_digest: commandSetDigest(withoutDigest) }
}

if (realpathSync(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) cli(() => {
  const args = parseArgs(process.argv.slice(2)); const inputFiles = args.values.inputs ?? []; const out = args.values.out?.[0]
  if (!out || inputFiles.length === 0) throw Object.assign(new Error('--inputs and --out are required'), { code: 'invalid_arguments' })
  writeJson(out, mergeCommandResults(inputFiles.map(readJson)))
})
