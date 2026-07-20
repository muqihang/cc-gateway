import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { scanSafePersisted } from './schemas.js'

export type LeakScanResult = {
  schema_version: 'oracle-lab-phase3a-leak-scan.v1'
  status: 'PASS'
  index_sha256: string
  scanned_artifact_ids: string[]
  quarantined_artifact_ids: string[]
  scanned_bytes: number
  findings: []
}

export function scanArtifactIndex(evidenceRootInput: string, indexPathInput: string): LeakScanResult {
  const evidenceRoot = ensureEvidenceRoot(evidenceRootInput)
  const indexPath = realFileBelow(evidenceRoot, indexPathInput)
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { artifacts: Array<Record<string, any>> }
  const scanned: string[] = []
  const quarantined: string[] = []
  let scannedBytes = 0
  for (const row of index.artifacts) {
    if (row.sensitivity === 'quarantine') { quarantined.push(row.artifact_id); continue }
    if (row.sensitivity !== 'normalized-safe') continue
    const absolute = realFileBelow(evidenceRoot, path.join(evidenceRoot, ...String(row.relative_path).split('/')))
    const bytes = readFileSync(absolute)
    scannedBytes += bytes.length
    if (bytes.length > 16 * 1024 * 1024) throw new Phase3AError('disk_limit', `safe artifact exceeds leak-scan cap: ${row.artifact_id}`)
    let value: unknown
    try { value = JSON.parse(bytes.toString('utf8')) } catch { value = bytes.toString('utf8') }
    const findings = scanSafePersisted(value)
    if (findings.length !== 0) throw new Phase3AError('sensitive_material', canonicalJson({ artifact_id: row.artifact_id, findings }))
    if (sha256File(absolute) !== row.sha256 || bytes.length !== row.byte_size) throw new Phase3AError('artifact_hash_mismatch', `safe artifact changed before leak scan: ${row.artifact_id}`)
    scanned.push(row.artifact_id)
  }
  if (quarantined.length === 0) throw new Phase3AError('sensitive_material', 'expected raw signed-URL artifacts are not explicitly quarantined')
  return { schema_version: 'oracle-lab-phase3a-leak-scan.v1', status: 'PASS', index_sha256: sha256File(indexPath), scanned_artifact_ids: scanned.sort(), quarantined_artifact_ids: quarantined.sort(), scanned_bytes: scannedBytes, findings: [] }
}

function realFileBelow(evidenceRoot: string, candidate: string): string {
  const absolute = realpathSync(path.resolve(candidate))
  const relation = path.relative(realpathSync(evidenceRoot), absolute)
  if (relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Phase3AError('path_outside_evidence_root', 'leak scan path escapes evidence root')
  if (!lstatSync(absolute).isFile()) throw new Phase3AError('path_outside_evidence_root', 'leak scan target is not a regular file')
  return absolute
}

export function writeLeakScan(evidenceRoot: string, indexPath: string, outputPath?: string): LeakScanResult {
  const result = scanArtifactIndex(evidenceRoot, indexPath)
  const output = assertEvidencePath(evidenceRoot, outputPath ?? path.join(evidenceRoot, 'guards', 'leak-scan.json'))
  mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, `${canonicalJson(result)}\n`, { flag: 'wx', mode: 0o600 })
  return result
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index === -1 ? undefined : process.argv[index + 1] }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const root = argument('--evidence-root'); const index = argument('--artifact-index'); const out = argument('--out')
    if (!root || !index) throw new Phase3AError('leak_guard_usage', '--evidence-root and --artifact-index are required')
    console.log(canonicalJson(writeLeakScan(root, index, out)))
  } catch (error) { console.error(canonicalJson(stableError(error))); process.exitCode = 1 }
}
