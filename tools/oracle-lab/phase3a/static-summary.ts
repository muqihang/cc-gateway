import { spawnSync } from 'node:child_process'
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import { REQUIRED_STATIC_ROOTS, type AstRecovery } from './recover-ast.js'
import type { ExtractionIndex } from './extract-bundle.js'
import type { StaticInventory } from './static-inventory.js'

function readJson<T>(file: string): T { return JSON.parse(readFileSync(file, 'utf8')) as T }

function command(command: string, args: string[]): { status: number | null; stdout: string; stderr: string; command_sha256: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, command_sha256: sha256Bytes(canonicalJson({ command, args })) }
}

function codesignFacts(entrypoint: string): Record<string, unknown> {
  const verify = command('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', entrypoint])
  const detail = command('/usr/bin/codesign', ['-dv', '--verbose=4', entrypoint])
  const text = `${detail.stdout}\n${detail.stderr}`
  const field = (name: string): string | null => text.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim() ?? null
  const authority = text.match(/^Authority=(.+)$/m)?.[1]?.trim() ?? null
  return {
    verification_status: verify.status === 0 ? 'valid' : 'invalid',
    identifier: field('Identifier'), team_identifier: field('TeamIdentifier'), authority,
    verify_command_sha256: verify.command_sha256, detail_command_sha256: detail.command_sha256,
    raw_command_output_persisted: false,
  }
}

export function buildStaticSummary(input: { entrypoint: string; inventory: string; extraction_a: string; extraction_b: string; ast_a: string; ast_b: string }): Record<string, unknown> {
  if (!lstatSync(input.entrypoint).isFile()) throw new Phase3AError('static_input_missing', 'entrypoint is not a regular file')
  const inventory = readJson<StaticInventory>(input.inventory)
  const extractionA = readJson<ExtractionIndex>(input.extraction_a)
  const extractionB = readJson<ExtractionIndex>(input.extraction_b)
  if (canonicalJson(extractionA) !== canonicalJson(extractionB)) throw new Phase3AError('parser_disagreement', 'independent extraction indexes disagree')
  const astNamesA = readdirSync(input.ast_a).filter((name) => name.endsWith('.json')).sort()
  const astNamesB = readdirSync(input.ast_b).filter((name) => name.endsWith('.json')).sort()
  if (canonicalJson(astNamesA) !== canonicalJson(astNamesB)) throw new Phase3AError('parser_disagreement', 'AST file lists disagree')
  const astRows = astNamesA.map((name) => {
    const file = path.join(input.ast_a, name)
    const peer = path.join(input.ast_b, name)
    const left = readJson<AstRecovery>(file)
    const right = readJson<AstRecovery>(peer)
    if (canonicalJson(left) !== canonicalJson(right)) throw new Phase3AError('parser_disagreement', `AST recovery disagrees for ${path.basename(file)}`)
    return {
      candidate_sha256: left.binding.candidate_sha256, deterministic_digest: left.deterministic_digest,
      source_bytes: left.parse.source_bytes, node_count: left.parse.node_count, canonical_ast_sha256: left.parse.canonical_ast_sha256,
      observed_roots: left.root_coverage.filter((row) => row.status === 'observed').map((row) => row.root).sort(),
      output_truncations: left.parse.output_truncations,
    }
  })
  const bunModules = extractionA.candidates.filter((candidate) => candidate.source === 'bun-standalone-module')
  const main = bunModules.find((candidate) => candidate.container?.module_index === 0)
  if (!main) throw new Phase3AError('static_input_missing', 'Bun standalone graph has no entry module')
  return {
    schema_version: 'oracle-lab-phase3a-static-summary.v1',
    artifact_sha256: sha256File(input.entrypoint), inventory_sha256: sha256File(input.inventory),
    extraction_index_sha256: sha256File(input.extraction_a), extraction_deterministic_digest: extractionA.deterministic_digest,
    independent_extraction_roots: 2, independent_extraction_match: true,
    format: inventory.format, slices: inventory.slices.length, sections: inventory.slices.flatMap((slice) => slice.sections).length,
    signature: codesignFacts(input.entrypoint),
    bun_standalone_graph: {
      runtime_version: '1.4.0', runtime_revision: 'f6d0fcd24', module_count: bunModules.length,
      entry_module: { sha256: main.sha256, byte_length: main.byte_length, location: main.location, classification: main.classification },
      utf8_modules: bunModules.filter((candidate) => candidate.encoding === 'utf8').length,
      opaque_modules: bunModules.filter((candidate) => candidate.encoding === 'binary').length,
    },
    ast_recoveries: astRows,
    entry_module_ast: {
      status: 'Unknown', failure_code: 'static_budget_exceeded', node_limit: 2_000_000,
      invalid_superseded_output_retained: true,
      searched_surfaces: ['typescript-parser', 'bun-module-table', 'formatter-reparse'],
      required_roots: REQUIRED_STATIC_ROOTS.map((root) => ({ root, status: 'Unknown', next_minimal_action: 'slice the entry bundle by recovered module table before root-neighborhood recovery' })),
    },
    raw_vendor_source_persisted_in_repository: false,
  }
}

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const entrypoint = argument('--entrypoint'); const inventory = argument('--inventory'); const extractionA = argument('--extraction-a'); const extractionB = argument('--extraction-b')
    const astA = argument('--ast-a'); const astB = argument('--ast-b'); const out = argument('--out')
    if (!entrypoint || !inventory || !extractionA || !extractionB || !astA || !astB || !out) throw new Phase3AError('invalid_arguments', 'static-summary requires all input and output paths')
    const summary = buildStaticSummary({ entrypoint, inventory, extraction_a: extractionA, extraction_b: extractionB, ast_a: astA, ast_b: astB })
    mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 })
    writeFileSync(out, `${canonicalJson(summary)}\n`, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`${canonicalJson({ out, sha256: sha256File(out) })}\n`)
  } catch (error) { process.stderr.write(`${canonicalJson(stableError(error))}\n`); process.exitCode = 1 }
}
