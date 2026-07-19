import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import canonicalize from 'canonicalize'

import {
  CC_BUNDLE_PATH,
  INDEXED_CONTRACT_FILES,
  PHASE1_CONTRACT_DIGEST,
  PHASE1_CONTRACT_PATH,
  SUB_BUNDLE_PATH,
  SharedContractError,
  checkSharedContract,
  parseStrictJson,
  sha256File,
} from './check-shared-contract.js'

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function buildIndex(source: string): string {
  const entries = readdirSync(source, { withFileTypes: true })
  const actual = entries.filter((entry) => entry.name !== 'contract-index.json').map((entry) => entry.name).sort()
  if (actual.length !== INDEXED_CONTRACT_FILES.length || actual.some((file, index) => file !== INDEXED_CONTRACT_FILES[index])) {
    throw new SharedContractError('contract_file_set_invalid', `source contract file set differs: ${actual.join(',')}`)
  }
  for (const entry of entries) {
    const candidate = path.join(source, entry.name)
    if (entry.isSymbolicLink() || lstatSync(candidate).isSymbolicLink()) throw new SharedContractError('contract_symlink', `source path is a symlink: ${candidate}`)
    if (!entry.isFile()) throw new SharedContractError('contract_file_set_invalid', `source path is not a regular file: ${candidate}`)
    if (entry.name.endsWith('.json') && entry.name !== 'contract-index.json') parseStrictJson(readFileSync(candidate), entry.name)
  }
  const index = {
    bundle_id: 'oracle.compatibility.v1',
    compatibility: [{ maximum_revision: 0, minimum_revision: 0, schema_major: 1 }],
    files: INDEXED_CONTRACT_FILES.map((relative_path) => ({ relative_path, sha256: sha256File(path.join(source, relative_path)) })),
    predecessor: { path: PHASE1_CONTRACT_PATH, repository: 'sub2api', sha256: PHASE1_CONTRACT_DIGEST },
    schema_id: 'oracle.compatibility',
    schema_major: 1,
    schema_revision: 0,
  }
  const encoded = canonicalize(index)
  if (!encoded) throw new SharedContractError('contract_index_not_canonical', 'unable to canonicalize contract index')
  return encoded
}

export function syncSharedContract(input: { ccGatewayRoot: string; sub2apiRoot: string }): void {
  const ccRoot = path.resolve(input.ccGatewayRoot)
  const subRoot = path.resolve(input.sub2apiRoot)
  const source = path.resolve(ccRoot, CC_BUNDLE_PATH)
  const target = path.resolve(subRoot, SUB_BUNDLE_PATH)
  if (!inside(ccRoot, source) || !inside(subRoot, target)) throw new SharedContractError('contract_path_escape', 'contract bundle path escapes a repository root')
  if (!existsSync(source) || !lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) {
    throw new SharedContractError('contract_bundle_missing', `source contract bundle is missing: ${source}`)
  }
  writeFileSync(path.join(source, 'contract-index.json'), buildIndex(source))
  mkdirSync(target, { recursive: true })
  for (const file of ['contract-index.json', ...INDEXED_CONTRACT_FILES].sort()) {
    copyFileSync(path.join(source, file), path.join(target, file))
  }
  checkSharedContract({ ccGatewayRoot: ccRoot, sub2apiRoot: subRoot })
}

function argument(name: string): string | undefined {
  const position = process.argv.indexOf(name)
  return position === -1 ? undefined : process.argv[position + 1]
}

function runCli(): void {
  if (!process.argv.includes('--sync')) throw new SharedContractError('contract_cli_usage', 'usage: sync-shared-contract.ts --sub2api-root PATH [--cc-gateway-root PATH] --sync')
  const sub2apiRoot = argument('--sub2api-root')
  if (!sub2apiRoot) throw new SharedContractError('contract_cli_usage', '--sub2api-root is required')
  syncSharedContract({ ccGatewayRoot: argument('--cc-gateway-root') ?? process.cwd(), sub2apiRoot })
  console.log(JSON.stringify({ ok: true }))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli()
  } catch (error) {
    const typed = error instanceof SharedContractError ? error : new SharedContractError('contract_sync_failed', (error as Error).message)
    console.error(JSON.stringify({ code: typed.code, message: typed.message }))
    process.exitCode = 1
  }
}
