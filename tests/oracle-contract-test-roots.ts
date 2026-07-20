import path from 'node:path'

const FORMAL_POOL_CONTRACT_RELATIVE = path.join(
  'backend',
  'internal',
  'service',
  'testdata',
  'cc_gateway_formal_pool_contract',
  'vectors.json',
)

export function resolveSub2apiTestRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.SUB2API_ROOT) return path.resolve(environment.SUB2API_ROOT)

  const contractPath = environment.SUB2API_FORMAL_POOL_CONTRACT_PATH
  if (!contractPath) {
    throw new Error('SUB2API_ROOT or SUB2API_FORMAL_POOL_CONTRACT_PATH must identify the clean Phase 2 Sub2API worktree')
  }
  const resolvedContract = path.resolve(contractPath)
  const root = path.resolve(path.dirname(resolvedContract), '..', '..', '..', '..', '..')
  if (path.join(root, FORMAL_POOL_CONTRACT_RELATIVE) !== resolvedContract) {
    throw new Error('SUB2API_FORMAL_POOL_CONTRACT_PATH must use the canonical Sub2API contract path')
  }
  return root
}
