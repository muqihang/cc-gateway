import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { captureRepositoryBinding, validateRepositoryBinding } from '../tools/oracle-lab/phase3a/repository-binding.js'
import { Phase3AError } from '../tools/oracle-lab/phase3a/core.js'

console.log('\ntests/oracle-phase3a-repository-binding.test.ts')

const root = mkdtempSync(path.join(tmpdir(), 'phase3a-repository-'))
execFileSync('git', ['init', '-q', root])
execFileSync('git', ['-C', root, 'config', 'user.email', 'phase3a@example.invalid'])
execFileSync('git', ['-C', root, 'config', 'user.name', 'Phase 3A Test'])
writeFileSync(path.join(root, 'tracked.txt'), 'frozen\n')
execFileSync('git', ['-C', root, 'add', 'tracked.txt'])
execFileSync('git', ['-C', root, 'commit', '-qm', 'freeze'])
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const codegraph = { version: '1.1.6', fileCount: 1, nodeCount: 1, edgeCount: 0, pendingChanges: { added: 0, modified: 0, removed: 0 }, worktreeMismatch: null, index: { builtWithVersion: '1.1.6', builtWithExtractionVersion: 24, currentExtractionVersion: 24, reindexRecommended: false } }

const binding = captureRepositoryBinding(root, { repository: 'fixture', base: head, freezeHead: head, codegraphStatus: codegraph })
validateRepositoryBinding(binding)
assert.equal(binding.dirty_path_count, 0)
assert.equal(binding.codegraph.up_to_date, true)
assert.match(binding.dirty_state_sha256, /^[a-f0-9]{64}$/)
assert.match(binding.codegraph.binding_sha256, /^[a-f0-9]{64}$/)
assert.match(binding.repository_binding_sha256, /^[a-f0-9]{64}$/)

writeFileSync(path.join(root, 'untracked.txt'), 'dirty\n')
assert.throws(
  () => captureRepositoryBinding(root, { repository: 'fixture', base: head, freezeHead: head, codegraphStatus: codegraph }),
  (error: unknown) => error instanceof Phase3AError && error.code === 'repository_dirty',
)

console.log(JSON.stringify({ ok: true, repository: binding.repository }))
