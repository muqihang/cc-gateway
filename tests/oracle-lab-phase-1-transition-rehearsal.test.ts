import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  parsePhase1TransitionRehearsalCli,
  runPhase1TransitionRehearsal,
  type Phase1TransitionRehearsalBindings,
  type Phase1TransitionRehearsalDependencies,
} from '../tools/oracle-lab/phase-1-transition-rehearsal.js'

function git(repository: string, ...args: string[]): string {
  return execFileSync('/usr/bin/git', args, {
    cwd: repository,
    encoding: 'utf8',
    env: {
      HOME: '/dev/null', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_COUNT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    },
  }).trim()
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function init(repository: string, remoteUrl: string): string {
  mkdirSync(repository, { recursive: true, mode: 0o700 })
  git(repository, 'init', '-q', '--initial-branch=main')
  git(repository, 'config', 'user.email', 'oracle@example.invalid')
  git(repository, 'config', 'user.name', 'Oracle Test')
  writeFileSync(path.join(repository, 'common.txt'), 'common\n')
  git(repository, 'add', 'common.txt')
  git(repository, 'commit', '-qm', 'common')
  git(repository, 'remote', 'add', 'muqihang', remoteUrl)
  const head = git(repository, 'rev-parse', 'HEAD')
  git(repository, 'update-ref', 'refs/remotes/muqihang/main', head)
  return head
}

function commit(repository: string, file: string, content: string, message: string): string {
  writeFileSync(path.join(repository, file), content)
  git(repository, 'add', '--', file)
  git(repository, 'commit', '-qm', message)
  return git(repository, 'rev-parse', 'HEAD')
}

async function expectCode(fn: () => unknown | Promise<unknown>, code: string): Promise<void> {
  const verify = (error: unknown) => {
    assert.equal((error as { code?: string }).code, code)
    return true
  }
  await assert.rejects(Promise.resolve().then(fn), verify)
}

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'oracle-delivery-rehearsal-'))
  const tool = path.join(parent, 'tool')
  const ccSource = path.join(parent, 'cc-source')
  const subSource = path.join(parent, 'sub-source')
  const ccAuthorization = path.join(parent, 'cc-authorization')
  const subAuthorization = path.join(parent, 'sub-authorization')
  const ccUrl = 'https://example.invalid/cc.git'
  const subUrl = 'https://example.invalid/sub.git'
  const toolBase = init(tool, ccUrl)
  mkdirSync(path.join(tool, 'tools/oracle-lab'), { recursive: true })
  writeFileSync(path.join(tool, 'tools/oracle-lab/oracle-phase1-authority-restart'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  git(tool, 'add', 'tools/oracle-lab/oracle-phase1-authority-restart')
  git(tool, 'commit', '-qm', 'tool launcher')
  const toolHead = git(tool, 'rev-parse', 'HEAD')
  git(tool, 'update-ref', 'refs/remotes/muqihang/main', toolHead)

  init(ccSource, ccUrl)
  const ccSource1 = commit(ccSource, 'cc-one.txt', 'one\n', 'cc one')
  const ccSource2 = commit(ccSource, 'cc-two.txt', 'two\n', 'cc two')
  init(subSource, subUrl)
  const subSource1 = commit(subSource, 'sub-one.txt', 'one\n', 'sub one')

  const ccBase = init(ccAuthorization, ccUrl)
  const subBase = init(subAuthorization, subUrl)
  const artifactPath = 'docs/superpowers/evidence/phase-1/restart.json'
  const bindings: Phase1TransitionRehearsalBindings = {
    artifact_path: artifactPath,
    authority_paths: { plan: 'plan.md', plan_review: 'review.json', execution_context: 'context.json' },
    tool_remote_url_digest: sha256(ccUrl),
    cc_gateway: {
      replacement_branch: 'codex/oracle-phase-1-cc-gateway-v8',
      remote_url_digest: sha256(ccUrl),
      remote_main_head: ccBase,
      authorization_base_head: ccBase,
      source_commits: [ccSource1, ccSource2],
    },
    sub2api: {
      replacement_branch: 'codex/oracle-phase-1-sub2api-v8',
      remote_url_digest: sha256(subUrl),
      remote_main_head: subBase,
      authorization_base_head: subBase,
      source_commits: [subSource1],
    },
  }
  const dependencies: Phase1TransitionRehearsalDependencies = {
    validate_sources: () => undefined,
    invoke_launcher: ({ command, cc_replacement_root, artifact_path }) => {
      if (command === 'build') {
        const target = path.join(cc_replacement_root, artifact_path)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, '{"fixture":true}\n', { mode: 0o600 })
      }
      return { status: 0, stdout: '', stderr: '' }
    },
  }
  const input = {
    tool_root: tool,
    cc_source_root: ccSource,
    sub2api_source_root: subSource,
    cc_authorization_root: ccAuthorization,
    sub2api_authorization_root: subAuthorization,
    replacement_parent_root: path.join(parent, 'replacement-parent'),
    output_root: path.join(parent, 'output'),
  }
  return { parent, input, bindings, dependencies, toolBase }
}

test('transition rehearsal CLI is closed and accepts only absolute explicit roots', async () => {
  const current = fixture()
  const argv = Object.entries(current.input).flatMap(([name, value]) => [`--${name.replaceAll('_', '-')}`, value])
  assert.deepEqual(parsePhase1TransitionRehearsalCli(argv), current.input)
  await expectCode(() => parsePhase1TransitionRehearsalCli([...argv, '--source-commit', 'caller-selected']), 'transition_rehearsal_cli_invalid')
  await expectCode(() => parsePhase1TransitionRehearsalCli([...argv, '--tool-root', current.input.tool_root]), 'transition_rehearsal_cli_invalid')
  await expectCode(() => parsePhase1TransitionRehearsalCli(argv.map((value, index) => index === 1 ? 'relative/tool' : value)), 'transition_rehearsal_cli_invalid')
})

test('temporary transaction replays compiled commits and commits exactly one artifact path', async () => {
  const current = fixture()
  const record = await runPhase1TransitionRehearsal(current.input, current.bindings, current.dependencies)
  assert.equal(record.status, 'green')
  assert.equal(record.repositories.cc_gateway.replay_commit_count, 2)
  assert.equal(record.repositories.sub2api.replay_commit_count, 1)
  assert.equal(record.repositories.cc_gateway.artifact_parent_head, record.repositories.cc_gateway.replay_head)
  assert.match(record.repositories.cc_gateway.artifact_commit, /^[0-9a-f]{40}$/)
  assert.equal(existsSync(path.join(current.input.output_root, 'phase-1-transition-transaction.json')), true)
  const persisted = readFileSync(path.join(current.input.output_root, 'phase-1-transition-transaction.json'), 'utf8')
  assert.equal(persisted.includes(current.parent), false, 'transaction record must not persist absolute fixture paths')
  assert.equal(git(current.input.cc_source_root, 'status', '--porcelain=v1'), '')
  assert.equal(git(current.input.sub2api_source_root, 'status', '--porcelain=v1'), '')
  assert.equal(git(current.input.cc_authorization_root, 'status', '--porcelain=v1'), '')
  assert.equal(git(current.input.sub2api_authorization_root, 'status', '--porcelain=v1'), '')
})

test('pre-existing outputs and failed launcher runs fail closed without cleanup', async () => {
  const occupied = fixture()
  mkdirSync(occupied.input.output_root, { mode: 0o700 })
  await expectCode(() => runPhase1TransitionRehearsal(occupied.input, occupied.bindings, occupied.dependencies), 'transition_rehearsal_output_exists')

  const failed = fixture()
  const dependencies: Phase1TransitionRehearsalDependencies = {
    ...failed.dependencies,
    invoke_launcher: (input) => input.command === 'build'
      ? { status: 1, stdout: '', stderr: 'fixture_launcher_failed\n' }
      : { status: 0, stdout: '', stderr: '' },
  }
  await expectCode(() => runPhase1TransitionRehearsal(failed.input, failed.bindings, dependencies), 'fixture_launcher_failed')
  assert.equal(existsSync(path.join(failed.input.replacement_parent_root, 'cc')), true)
  assert.equal(existsSync(path.join(failed.input.replacement_parent_root, 'sub2api')), true)
  assert.equal(existsSync(failed.input.output_root), true)
  assert.equal(existsSync(path.join(failed.input.output_root, 'phase-1-transition-transaction.json')), false)
})
