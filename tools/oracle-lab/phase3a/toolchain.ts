import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { assertEvidencePath, canonicalJson, ensureEvidenceRoot, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'

export type ToolStatus = 'available' | 'permission_denied' | 'unsupported' | 'unknown'
export type ToolRecord = {
  name: string
  status: ToolStatus
  executable_path: string | null
  executable_sha256: string | null
  version_output_sha256: string | null
  version_first_line: string | null
  probe_exit_code: number | null
  fallback: string
}

type ToolSpec = { name: string; command: string; args: string[]; fallback: string; probe?: 'path-only' }

const TOOL_SPECS: ToolSpec[] = [
  { name: 'node', command: 'node', args: ['--version'], fallback: 'none' },
  { name: 'npm', command: 'npm', args: ['--version'], fallback: 'none' },
  { name: 'typescript', command: 'node_modules/.bin/tsc', args: ['--version'], fallback: 'syntax-only TypeScript inspection' },
  { name: 'python3', command: 'python3', args: ['--version'], fallback: 'Node.js standard library' },
  { name: 'go', command: 'go', args: ['version'], fallback: 'Sub2API adapter marked unsupported' },
  { name: 'curl', command: 'curl', args: ['--version'], fallback: 'Node.js fetch with HTTPS host allowlist' },
  { name: 'tar', command: 'tar', args: ['--version'], fallback: 'H3A streaming tar parser' },
  { name: 'jq', command: 'jq', args: ['--version'], fallback: 'JSON.parse plus canonical JSON' },
  { name: 'openssl', command: 'openssl', args: ['version'], fallback: 'Node.js crypto and tls modules' },
  { name: 'codegraph', command: 'codegraph', args: ['--version'], fallback: 'bounded source reads after graph status is recorded' },
  { name: 'codesign', command: 'codesign', args: ['--version'], fallback: 'otool plus entrypoint digest; signing identity Unknown' },
  { name: 'otool', command: 'otool', args: ['-h'], fallback: 'llvm-objdump or file' },
  { name: 'nm', command: 'nm', args: ['-V'], fallback: 'llvm-nm or section/string xrefs' },
  { name: 'xcrun', command: 'xcrun', args: ['--version'], fallback: 'direct Apple command-line tools' },
  { name: 'llvm-objdump', command: 'xcrun', args: ['llvm-objdump', '--version'], fallback: 'otool' },
  { name: 'ghidra-headless', command: 'analyzeHeadless', args: [], fallback: 'rizin plus Bun section extraction', probe: 'path-only' },
  { name: 'rizin', command: 'rizin', args: ['-v'], fallback: 'otool/llvm-objdump plus custom extractors' },
  { name: 'mitmproxy', command: 'mitmproxy', args: ['--version'], fallback: 'H3A loopback CONNECT observer' },
  { name: 'tcpdump', command: 'tcpdump', args: ['--version'], fallback: 'lsof plus loopback observer event log' },
  { name: 'fs_usage', command: 'fs_usage', args: [], fallback: 'process sampler plus hooks', probe: 'path-only' },
  { name: 'opensnoop', command: 'opensnoop', args: [], fallback: 'process sampler plus hooks', probe: 'path-only' },
  { name: 'dtruss', command: 'dtruss', args: [], fallback: 'process sampler plus hooks', probe: 'path-only' },
  { name: 'strace', command: 'strace', args: ['--version'], fallback: 'macOS process sampler plus hooks' },
  { name: 'lsof', command: 'lsof', args: ['-v'], fallback: 'netstat plus process sampler' },
]

function resolveCommand(command: string, repositoryRoot: string): string | null {
  if (command.includes('/')) {
    const candidate = path.resolve(repositoryRoot, command)
    return existsSync(candidate) ? realpathSync(candidate) : null
  }
  const result = spawnSync('/usr/bin/which', [command], { encoding: 'utf8', timeout: 5_000 })
  const candidate = result.status === 0 ? result.stdout.trim().split(/\r?\n/, 1)[0] : ''
  return candidate && existsSync(candidate) ? realpathSync(candidate) : null
}

export function validateToolRecord(record: ToolRecord): void {
  if (record.status === 'available') {
    if (!record.executable_path || !/^[a-f0-9]{64}$/.test(record.executable_sha256 ?? '')) {
      throw new Phase3AError('toolchain_unpinned', `${record.name} lacks executable path or digest`)
    }
    if (record.probe_exit_code === null || !/^[a-f0-9]{64}$/.test(record.version_output_sha256 ?? '')) {
      throw new Phase3AError('toolchain_unpinned', `${record.name} has only a version string`)
    }
  }
  if (!record.fallback) throw new Phase3AError('toolchain_unpinned', `${record.name} lacks a fallback`) 
}

function probe(spec: ToolSpec, repositoryRoot: string): ToolRecord {
  const executable = resolveCommand(spec.command, repositoryRoot)
  if (!executable) {
    return { name: spec.name, status: 'unsupported', executable_path: null, executable_sha256: null, version_output_sha256: null, version_first_line: null, probe_exit_code: null, fallback: spec.fallback }
  }
  const args = spec.probe === 'path-only' ? [] : spec.args
  const result = spec.probe === 'path-only'
    ? { status: 0, stdout: 'path-only capability probe', stderr: '' }
    : spawnSync(executable, args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const status: ToolStatus = /permission denied|operation not permitted/i.test(output) ? 'permission_denied' : 'available'
  const record: ToolRecord = {
    name: spec.name,
    status,
    executable_path: executable,
    executable_sha256: sha256File(executable),
    version_output_sha256: sha256Bytes(output),
    version_first_line: output.split(/\r?\n/, 1)[0]?.slice(0, 240) || '(no version output)',
    probe_exit_code: result.status,
    fallback: spec.fallback,
  }
  validateToolRecord(record)
  return record
}

function moduleCapability(name: string, python: ToolRecord, importName: string, fallback: string): ToolRecord {
  if (!python.executable_path || !python.executable_sha256) {
    return { name, status: 'unsupported', executable_path: null, executable_sha256: null, version_output_sha256: null, version_first_line: null, probe_exit_code: null, fallback }
  }
  const result = spawnSync(python.executable_path, ['-c', `import ${importName}; print(getattr(${importName}, '__version__', 'available'))`], { encoding: 'utf8', timeout: 10_000 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const record: ToolRecord = {
    name,
    status: result.status === 0 ? 'available' : 'unsupported',
    executable_path: python.executable_path,
    executable_sha256: python.executable_sha256,
    version_output_sha256: sha256Bytes(output),
    version_first_line: output.split(/\r?\n/, 1)[0]?.slice(0, 240) || '(module unavailable)',
    probe_exit_code: result.status,
    fallback,
  }
  if (record.status === 'available') validateToolRecord(record)
  return record
}

export function captureToolchain(repositoryRoot: string): { schema_version: string; records: ToolRecord[]; digest: string } {
  const records = TOOL_SPECS.map((spec) => probe(spec, repositoryRoot))
  const python = records.find((record) => record.name === 'python3')!
  records.push(moduleCapability('lief', python, 'lief', 'otool/llvm-objdump plus custom section parser'))
  records.sort((left, right) => left.name.localeCompare(right.name))
  const value = { schema_version: 'oracle-lab-phase3a-toolchain.v1', records }
  return { ...value, digest: sha256Bytes(canonicalJson(value)) }
}

export function writeToolchain(repositoryRoot: string, evidenceRootInput: string): { toolchain_path: string; capabilities_path: string; digest: string } {
  const evidenceRoot = ensureEvidenceRoot(evidenceRootInput)
  const directory = assertEvidencePath(evidenceRoot, path.join(evidenceRoot, 'toolchain'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const toolchain = captureToolchain(repositoryRoot)
  const capabilities = {
    schema_version: 'oracle-lab-phase3a-capabilities.v1',
    toolchain_digest: toolchain.digest,
    capabilities: toolchain.records.map(({ name, status, fallback }) => ({ name, status, fallback })),
  }
  const toolchainPath = path.join(directory, 'toolchain.json')
  const capabilitiesPath = path.join(directory, 'capabilities.json')
  writeFileSync(toolchainPath, `${canonicalJson(toolchain)}\n`, { flag: 'wx', mode: 0o600 })
  writeFileSync(capabilitiesPath, `${canonicalJson(capabilities)}\n`, { flag: 'wx', mode: 0o600 })
  return { toolchain_path: toolchainPath, capabilities_path: capabilitiesPath, digest: toolchain.digest }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const evidenceRoot = argument('--evidence-root')
    const repositoryRoot = argument('--repository-root') ?? process.cwd()
    if (!evidenceRoot) throw new Phase3AError('toolchain_usage', '--evidence-root is required')
    console.log(canonicalJson(writeToolchain(repositoryRoot, evidenceRoot)))
  } catch (error) {
    console.error(canonicalJson(stableError(error)))
    process.exitCode = 1
  }
}
