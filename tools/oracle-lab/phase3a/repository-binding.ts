import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'

import { canonicalJson, Phase3AError, sha256Bytes } from './core.js'

type JsonObject = Record<string, any>
export type RepositoryBinding = {
  repository: string
  base: string
  tool_review_freeze_head: string
  head: string
  tree: string
  dirty_path_count: 0
  dirty_state_sha256: string
  codegraph: {
    version: string
    built_with_version: string
    extraction_version: number
    file_count: number
    node_count: number
    edge_count: number
    up_to_date: true
    binding_sha256: string
  }
  repository_binding_sha256: string
}

function git(root: string, args: string[]): string { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim() }

function dirtySnapshot(root: string): Array<{ path: string; status: string; content_sha256: string }> {
  const output = execFileSync('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'])
  return output.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const relative = line.slice(3)
    const file = path.join(root, relative)
    let content = 'missing'
    try {
      const stat = lstatSync(file)
      content = stat.isSymbolicLink() ? `symlink:${readlinkSync(file)}` : stat.isFile() ? readFileSync(file).toString('base64') : `other:${stat.mode}`
    } catch { /* deletion remains bound as missing */ }
    return { path: relative, status: line.slice(0, 2), content_sha256: sha256Bytes(content) }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function normalizeCodeGraph(status: JsonObject): Omit<RepositoryBinding['codegraph'], 'binding_sha256'> {
  const pending = status.pendingChanges ?? {}
  const upToDate = pending.added === 0 && pending.modified === 0 && pending.removed === 0 && status.worktreeMismatch === null && status.index?.reindexRecommended === false && status.index?.builtWithExtractionVersion === status.index?.currentExtractionVersion
  if (!upToDate) throw new Phase3AError('codegraph_not_current', 'CodeGraph is not current for the repository freeze')
  return {
    version: String(status.version), built_with_version: String(status.index.builtWithVersion), extraction_version: Number(status.index.currentExtractionVersion),
    file_count: Number(status.fileCount), node_count: Number(status.nodeCount), edge_count: Number(status.edgeCount), up_to_date: true,
  }
}

export function captureRepositoryBinding(root: string, input: { repository: string; base: string; freezeHead: string; codegraphStatus?: JsonObject }): RepositoryBinding {
  const head = git(root, ['rev-parse', 'HEAD'])
  const tree = git(root, ['rev-parse', 'HEAD^{tree}'])
  if (head !== input.freezeHead) throw new Phase3AError('repository_freeze_mismatch', `${input.repository} head does not match tool/review freeze`)
  try { execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', input.base, head]) } catch { throw new Phase3AError('repository_freeze_mismatch', `${input.repository} base is not an ancestor`) }
  const dirty = dirtySnapshot(root)
  if (dirty.length !== 0) throw new Phase3AError('repository_dirty', `${input.repository} has ${dirty.length} dirty paths`)
  const dirtyStateSha256 = sha256Bytes(canonicalJson(dirty))
  const rawCodeGraph = input.codegraphStatus ?? JSON.parse(execFileSync('codegraph', ['status', '--json'], { cwd: root, encoding: 'utf8' }))
  const normalizedCodeGraph = normalizeCodeGraph(rawCodeGraph)
  const codegraph = { ...normalizedCodeGraph, binding_sha256: sha256Bytes(canonicalJson(normalizedCodeGraph)) }
  const unsigned = { repository: input.repository, base: input.base, tool_review_freeze_head: input.freezeHead, head, tree, dirty_path_count: 0 as const, dirty_state_sha256: dirtyStateSha256, codegraph }
  return { ...unsigned, repository_binding_sha256: sha256Bytes(canonicalJson(unsigned)) }
}

export function validateRepositoryBinding(binding: RepositoryBinding): void {
  if (!/^[a-f0-9]{40}$/.test(binding.base) || !/^[a-f0-9]{40}$/.test(binding.head) || !/^[a-f0-9]{40}$/.test(binding.tree) || binding.head !== binding.tool_review_freeze_head) throw new Phase3AError('repository_binding_invalid', 'repository git binding is invalid')
  if (binding.dirty_path_count !== 0 || binding.codegraph.up_to_date !== true) throw new Phase3AError('repository_binding_invalid', 'repository freeze is dirty or CodeGraph is stale')
  const { repository_binding_sha256: observed, ...unsigned } = binding
  if (observed !== sha256Bytes(canonicalJson(unsigned))) throw new Phase3AError('repository_binding_invalid', 'repository aggregate digest mismatch')
  const { binding_sha256: codegraphDigest, ...codegraphUnsigned } = binding.codegraph
  if (codegraphDigest !== sha256Bytes(canonicalJson(codegraphUnsigned))) throw new Phase3AError('repository_binding_invalid', 'CodeGraph binding digest mismatch')
}
