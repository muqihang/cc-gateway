import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'fs'
import { dirname, isAbsolute, join, relative, resolve } from 'path'

const contractRelativePath = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
const contractPathCategory = 'sub2api_formal_pool_contract'
const observedDigests = new Map<string, string>()

export type SharedContractFixture = {
  materials: Record<string, string>
  account: Record<string, string>
  client_input: Record<string, unknown>
  valid_context: Record<string, unknown>
  cases?: Record<string, unknown>
}

export type FormalPoolContractResolution = {
  path: string
  sourceCategory: 'explicit_env' | 'sibling_main' | 'declared_root' | 'declared_worktree'
  digest: string
  fixture: SharedContractFixture
}

type Manifest = {
  entry_kind?: unknown
  repositories?: { sub2api?: { head?: unknown; branch?: unknown; root_realpath?: unknown } }
  contract?: {
    repository_role?: unknown
    path_category?: unknown
    repository_relative_path_base64url?: unknown
    sha256?: unknown
  }
}

function git(root: string, ...args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    throw new Error(`Sub2API root is not a readable Git repository: ${root}`)
  }
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function assertInside(root: string, candidate: string, label: string) {
  const rel = relative(root, candidate)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error(`${label} realpath escapes declared Sub2API root`)
}

function resolveManifestPath(gatewayRoot: string, manifestPath: string): string {
  return isAbsolute(manifestPath) ? resolve(manifestPath) : resolve(gatewayRoot, manifestPath)
}

function loadCommittedManifest(gatewayRoot: string, manifestPath: string): Manifest {
  const absolute = resolveManifestPath(gatewayRoot, manifestPath)
  if (!existsSync(absolute)) throw new Error(`manifest file does not exist: ${absolute}`)
  const gatewayReal = realpathSync(gatewayRoot)
  const manifestReal = realpathSync(absolute)
  assertInside(gatewayReal, manifestReal, 'manifest')
  const rel = relative(gatewayReal, manifestReal).split('\\').join('/')
  let committed: string
  try {
    committed = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: gatewayReal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    throw new Error('manifest must be committed in the Gateway current HEAD')
  }
  const current = readFileSync(manifestReal, 'utf8')
  if (current !== committed) throw new Error('manifest must match the committed Gateway current HEAD')
  try {
    return JSON.parse(current) as Manifest
  } catch {
    throw new Error('manifest is not valid JSON')
  }
}

function validateManifest(input: {
  gatewayRoot: string
  manifestPath?: string
  rootReal: string
  branch: string
  head: string
  contractDigest: string
}) {
  if (!input.manifestPath) throw new Error('declared feature worktree requires manifest input')
  const manifest = loadCommittedManifest(input.gatewayRoot, input.manifestPath)
  if (typeof manifest.entry_kind !== 'string' || !/(^|_)(entry|exit)$/.test(manifest.entry_kind)) {
    throw new Error('manifest must be a committed entry/exit manifest')
  }
  const repository = manifest.repositories?.sub2api
  if (!repository) throw new Error('manifest Sub2API role is missing')
  if (repository.head !== input.head) throw new Error('manifest Sub2API HEAD does not match repository state')
  if (repository.branch !== input.branch) throw new Error('manifest Sub2API branch does not match repository state')
  if (repository.root_realpath !== undefined) {
    let manifestRootReal: string
    try {
      manifestRootReal = realpathSync(String(repository.root_realpath))
    } catch {
      throw new Error('manifest Sub2API realpath does not exist')
    }
    if (manifestRootReal !== input.rootReal) throw new Error('manifest Sub2API realpath does not match declared root')
  }
  if (manifest.contract?.repository_role !== 'sub2api') {
    throw new Error('manifest contract role is not Sub2API')
  }
  if (manifest.contract?.path_category !== contractPathCategory) throw new Error('manifest contract path category does not match')
  let manifestRelativePath: string
  try {
    manifestRelativePath = Buffer.from(String(manifest.contract.repository_relative_path_base64url), 'base64url').toString('utf8')
  } catch {
    throw new Error('manifest contract path category payload is invalid')
  }
  if (manifestRelativePath !== contractRelativePath) throw new Error('manifest contract path category resolves to an unexpected path')
  if (manifest.contract.sha256 !== input.contractDigest) throw new Error('manifest contract digest does not match')
}

function validateFixture(value: unknown): asserts value is SharedContractFixture {
  if (!value || typeof value !== 'object') throw new Error('formal-pool contract fixture must be an object')
  const fixture = value as Record<string, unknown>
  for (const field of ['materials', 'account', 'client_input', 'valid_context']) {
    if (!fixture[field] || typeof fixture[field] !== 'object' || Array.isArray(fixture[field])) {
      throw new Error(`formal-pool contract fixture is missing object field ${field}`)
    }
  }
  if (fixture.cases !== undefined && (!fixture.cases || typeof fixture.cases !== 'object' || Array.isArray(fixture.cases))) {
    throw new Error('formal-pool contract fixture cases must be an object')
  }
}

export function resolveFormalPoolContract(input: {
  explicitPath?: string
  gatewayRoot: string
  sub2apiRoot?: string
  manifestPath?: string
  expectedBranch?: string
  expectedHead?: string
  expectedDigest?: string
}): FormalPoolContractResolution {
  const gatewayRoot = realpathSync(input.gatewayRoot)
  let rootCandidate: string
  let pathCandidate: string
  let sourceCategory: FormalPoolContractResolution['sourceCategory']

  if (input.explicitPath) {
    pathCandidate = resolve(input.explicitPath)
    rootCandidate = input.sub2apiRoot
      ? resolve(input.sub2apiRoot)
      : resolve(pathCandidate, ...Array(contractRelativePath.split('/').length).fill('..'))
    sourceCategory = 'explicit_env'
  } else if (input.sub2apiRoot) {
    rootCandidate = resolve(input.sub2apiRoot)
    pathCandidate = join(rootCandidate, contractRelativePath)
    sourceCategory = 'declared_root'
  } else {
    rootCandidate = join(dirname(gatewayRoot), 'sub2api-zhumeng-main')
    pathCandidate = join(rootCandidate, contractRelativePath)
    sourceCategory = 'sibling_main'
  }

  if (!existsSync(rootCandidate)) throw new Error(`Sub2API root does not exist: ${rootCandidate}`)
  if (!existsSync(pathCandidate)) throw new Error(`formal-pool contract does not exist: ${pathCandidate}`)
  const rootReal = realpathSync(rootCandidate)
  const contractReal = realpathSync(pathCandidate)
  assertInside(rootReal, contractReal, 'contract')
  const expectedContractReal = join(rootReal, contractRelativePath)
  if (contractReal !== expectedContractReal) throw new Error('formal-pool contract path is not the declared path inside Sub2API root')
  if (!statSync(contractReal).isFile()) throw new Error('formal-pool contract is not a regular file')

  const branch = git(rootReal, 'rev-parse', '--abbrev-ref', 'HEAD')
  const head = git(rootReal, 'rev-parse', 'HEAD')
  if (sourceCategory === 'sibling_main' && branch !== 'main') {
    throw new Error(`deterministic sibling Sub2API checkout must be on main, found ${branch}`)
  }

  const before = statSync(contractReal)
  const bytes = readFileSync(contractReal)
  const after = statSync(contractReal)
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('formal-pool contract changed while being read')
  const contractDigest = digest(bytes)
  const previouslyObserved = observedDigests.get(contractReal)
  if (previouslyObserved && previouslyObserved !== contractDigest) throw new Error('formal-pool contract digest changed during this process')
  observedDigests.set(contractReal, contractDigest)

  const exactPinnedExplicitPath = sourceCategory === 'explicit_env'
    && !input.sub2apiRoot
    && input.expectedDigest !== undefined
    && contractDigest === input.expectedDigest
  if (branch !== 'main') {
    if (!input.sub2apiRoot && !exactPinnedExplicitPath) throw new Error('explicit feature-worktree contract requires an explicitly declared sub2apiRoot or exact expectedDigest')
    if (!exactPinnedExplicitPath) validateManifest({ gatewayRoot, manifestPath: input.manifestPath, rootReal, branch, head, contractDigest })
    if (sourceCategory !== 'explicit_env') sourceCategory = 'declared_worktree'
  }
  if (input.expectedBranch && branch !== input.expectedBranch) throw new Error(`Sub2API branch mismatch: expected ${input.expectedBranch}, found ${branch}`)
  if (input.expectedHead && head !== input.expectedHead) throw new Error(`Sub2API HEAD mismatch: expected ${input.expectedHead}, found ${head}`)
  if (input.expectedDigest && contractDigest !== input.expectedDigest) throw new Error(`formal-pool contract digest mismatch: expected ${input.expectedDigest}, found ${contractDigest}`)

  let fixture: unknown
  try {
    fixture = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('formal-pool contract fixture is not valid JSON')
  }
  validateFixture(fixture)
  return { path: contractReal, sourceCategory, digest: contractDigest, fixture }
}
