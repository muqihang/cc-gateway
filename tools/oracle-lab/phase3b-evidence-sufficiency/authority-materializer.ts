import { Phase3BProductionError } from './core.js'

export type MaterializedCrossRepoAuthority = Readonly<{
  verdict: 'CROSS_REPO_PASS'
  review_sha256: string
}>

export function bindMaterializedCrossRepoAuthority(_rawRecord: Uint8Array): MaterializedCrossRepoAuthority {
  throw new Phase3BProductionError('cross_repo_authority_not_implemented', 'materialized C1 authority binding is not implemented')
}
