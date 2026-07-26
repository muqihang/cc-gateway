import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { materializeAuthorityArtifacts, type AuthorityMaterializerInput } from './authority-materializer.js'
import { Phase3BProductionError, assertExactKeys, canonicalBytes } from './core.js'
import { stableRead } from './sealed-fs.js'

const INPUT_KEYS = ['output_root', 'evidence_root', 'campaign_id', 'cc_repository', 'sub_repository', 'reviewed_candidate_commit', 'reviewed_candidate_tree', 'cross_review_task_id', 'cross_review_artifact_path', 'original_source', 'probe_source', 'probe_unsigned_source', 'platform_archive_path', 'source_tree_path', 'toolchain_path', 'predecessor_config_auth_path', 'predecessor_failure_stream_path'] as const

function parseInput(file: string): AuthorityMaterializerInput {
  const { bytes } = stableRead(path.resolve(file), { mode: 0o600, maximumBytes: 1_048_576 })
  if (bytes.at(-1) !== 0x0a) throw new Phase3BProductionError('authority_materializer_cli_invalid', 'materializer input must be canonical JSON plus LF')
  let value: unknown
  try { value = JSON.parse(bytes.subarray(0, -1).toString('utf8')) } catch { throw new Phase3BProductionError('authority_materializer_cli_invalid', 'materializer input JSON is invalid') }
  assertExactKeys(value, INPUT_KEYS, 'authority_materializer_cli_invalid')
  if (!canonicalBytes(value).equals(bytes.subarray(0, -1))) throw new Phase3BProductionError('authority_materializer_cli_invalid', 'materializer input is not canonical JSON')
  return value as AuthorityMaterializerInput
}

export function main(argv = process.argv.slice(2)): void {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) throw new Phase3BProductionError('authority_materializer_cli_invalid', 'usage: authority-materializer-cli.ts --input ABSOLUTE_PATH')
  process.stdout.write(`${JSON.stringify(materializeAuthorityArtifacts(parseInput(argv[1])))}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { main() } catch (error) {
    const typed = error instanceof Phase3BProductionError ? error : new Phase3BProductionError('authority_materialization_failed', (error as Error).message)
    process.stderr.write(`${JSON.stringify({ code: typed.code, message: typed.message })}\n`)
    process.exitCode = 1
  }
}
