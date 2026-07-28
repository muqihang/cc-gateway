import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { canonicalBytes, canonicalJson, sha256Bytes } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import { main as admissionMain, sealPreEpochAdmissionReceiptAt } from '../tools/oracle-lab/phase3b-evidence-sufficiency/pre-epoch-admission-cli.js'
import { evaluatePreEpochAdmission, PRE_EPOCH_ADMISSION_AUTHORITY, type PreEpochAdmissionAuthority, type PreEpochAdmissionInput } from '../tools/oracle-lab/phase3b-evidence-sufficiency/pre-epoch-admission.js'
import { verifyGithubWebFlowCommit } from '../tools/oracle-lab/phase3b-evidence-sufficiency/trust.js'

const CONFIG_AUTH = '{"conclusion_id":"CL-P3A-R2-CONFIG-AUTH","contradicting_artifact_ids":[],"dynamic_reproduction":{"control_run_ids":["closure-r2-config-v2-control"],"run_ids":["closure-r2-config-v2","closure-r2-auth-v1","closure-r2-auth-co-v2"],"source_count":2},"expiry":"2026-08-03T00:00:00.000Z","level":"Reproduced","negative_capabilities":[],"phase3b_usable":true,"platform_limits":["darwin-arm64 only","synthetic loopback observers only"],"prohibited_claims":["CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED"],"schema_version":"oracle-lab-phase3a-conclusion.v1","scope":"claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures","single_source_reason":null,"statement":"Config precedence and placeholder credential lifecycle were stable in the bounded local campaign.","static_anchor":{"artifact_digest":"90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58","location":"P3A-1 bounded static inventory and extracted indexes","reproduction_command_digest":"cc30442a88516f17aefbdae360e0f00ceaa53429d68e02d0848f34c5a230a555"},"supporting_artifact_ids":["p3a2-closure-config","p3a2-closure-auth-primary","p3a2-closure-auth-supplement","p3a2-closure-coverage-v8"]}\n'
const FAILURE_STREAM = '{"conclusion_id":"CL-P3A-R2-FAILURE-STREAM","contradicting_artifact_ids":[],"dynamic_reproduction":{"control_run_ids":["closure-r2-scenario-v2-control"],"run_ids":["closure-r2-scenario-v2","closure-r2-partial-v6","closure-r2-complete-v7"],"source_count":2},"expiry":"2026-08-03T00:00:00.000Z","level":"Reproduced","negative_capabilities":[],"phase3b_usable":true,"platform_limits":["darwin-arm64 only","synthetic loopback observers only"],"prohibited_claims":["CL-LOCAL-EVIDENCE-PRODUCTION-PROHIBITED"],"schema_version":"oracle-lab-phase3a-conclusion.v1","scope":"claude-code-2.1.215 darwin-arm64 synthetic loopback fixtures","single_source_reason":null,"statement":"HTTP failure, reset, partial stream, and complete stream terminal classes were stable in the bounded local campaign.","static_anchor":{"artifact_digest":"90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58","location":"P3A-1 bounded static inventory and extracted indexes","reproduction_command_digest":"54453c7a3780e9a2d29dd6a99b41db02b52b9d4f80c1e31581beaf07cf032e2d"},"supporting_artifact_ids":["p3a2-closure-scenarios-v2","p3a2-closure-coverage-v8"]}\n'

function git(repository: string, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-C', repository, ...args], { encoding: 'utf8' }).trim()
}

function commit(repository: string, name: string): string {
  writeFileSync(path.join(repository, name), `${name}\n`, { flag: 'wx' })
  git(repository, ['add', name])
  git(repository, ['commit', '-q', '-m', name])
  return git(repository, ['rev-parse', 'HEAD'])
}

function initRepository(root: string, name: string): string {
  const repository = path.join(root, name)
  mkdirSync(repository, { mode: 0o700 })
  git(repository, ['init', '-q'])
  git(repository, ['config', 'user.name', 'Phase3B Test'])
  git(repository, ['config', 'user.email', 'phase3b-test@example.invalid'])
  return repository
}

function fixture(): { root: string; inputPath: string; input: Record<string, unknown>; container: string; authority: PreEpochAdmissionAuthority } {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'phase3b-pre-epoch-admission-')))
  chmodSync(root, 0o700)
  const cc = initRepository(root, 'cc')
  const requiredCommit = commit(cc, 'required')
  const requiredTree = git(cc, ['rev-parse', `${requiredCommit}^{tree}`])
  const head = commit(cc, 'candidate')
  const tree = git(cc, ['rev-parse', 'HEAD^{tree}'])
  git(cc, ['update-ref', 'refs/remotes/muqihang/main', head])

  const sub = initRepository(root, 'sub')
  commit(sub, 'base')
  const initialBranch = git(sub, ['branch', '--show-current'])
  git(sub, ['switch', '-q', '-c', 'side'])
  commit(sub, 'side')
  git(sub, ['switch', '-q', initialBranch])
  commit(sub, 'main')
  git(sub, ['merge', '-q', '--no-ff', 'side', '-m', 'authority merge'])
  const subCommit = git(sub, ['rev-parse', 'HEAD'])
  const subTree = git(sub, ['rev-parse', 'HEAD^{tree}'])
  const subParents = git(sub, ['show', '-s', '--format=%P', subCommit]).split(' ')

  const container = path.join(root, 'campaign-container')
  mkdirSync(container, { mode: 0o700 })
  const configPath = path.join(root, 'config-auth.json')
  const failurePath = path.join(root, 'failure-stream.json')
  writeFileSync(configPath, CONFIG_AUTH, { flag: 'wx', mode: 0o600 })
  writeFileSync(failurePath, FAILURE_STREAM, { flag: 'wx', mode: 0o600 })
  const input = {
    schema_id: 'oracle-lab-p3b-pre-epoch-admission-input.v1',
    campaign_container: container,
    cc_expected_head: head,
    cc_expected_tree: tree,
    cc_repository: cc,
    predecessor_config_auth_path: configPath,
    predecessor_failure_stream_path: failurePath,
    receipt_path: path.join(root, 'admission-receipt.json'),
    sub_repository: sub,
  }
  const authority: PreEpochAdmissionAuthority = {
    cc_required_ancestor_commit: requiredCommit,
    cc_required_ancestor_tree: requiredTree,
    cc_remote_ref: 'refs/remotes/muqihang/main',
    require_github_web_flow_signature: false,
    sub_commit: subCommit,
    sub_tree: subTree,
    sub_parents: subParents as [string, string],
    predecessor_expiry: '2026-08-03T00:00:00.000Z',
    predecessors: {
      'CL-P3A-R2-CONFIG-AUTH': sha256Bytes(Buffer.from(CONFIG_AUTH)),
      'CL-P3A-R2-FAILURE-STREAM': sha256Bytes(Buffer.from(FAILURE_STREAM)),
    },
  }
  const inputPath = path.join(root, 'admission-input.json')
  writeFileSync(inputPath, Buffer.concat([canonicalBytes(input), Buffer.from('\n')]), { flag: 'wx', mode: 0o600 })
  return { root, inputPath, input, container, authority }
}

function run(inputPath: string, authority: PreEpochAdmissionAuthority, nowMs = Date.parse('2026-07-28T00:00:00.000Z')) {
  let stdout = ''
  try {
    const input = JSON.parse(readFileSync(inputPath).subarray(0, -1).toString('utf8')) as PreEpochAdmissionInput
    const prepared = evaluatePreEpochAdmission(input, { authority })
    stdout = `${canonicalJson(sealPreEpochAdmissionReceiptAt(input, prepared, nowMs))}\n`
    return { status: 0, stdout, stderr: '' }
  } catch (error: unknown) {
    const typed = error as Error & { code?: string }
    return { status: 1, stdout, stderr: canonicalJson({ code: typed.code ?? 'pre_epoch_admission_failed', message: typed.message }) }
  }
}

function rewriteInput(file: string, value: Record<string, unknown>): void {
  writeFileSync(file, Buffer.concat([canonicalBytes(value), Buffer.from('\n')]), { flag: 'w', mode: 0o600 })
}

test('RED: checked-in pre-epoch evaluator seals canonical PASS without consuming an epoch', () => {
  const value = fixture()
  const before = readdirSync(value.container)
  const result = run(value.inputPath, value.authority)

  assert.equal(result.status, 0, result.stderr)
  const bytes = Buffer.from(result.stdout, 'utf8')
  assert.equal(bytes.at(-1), 0x0a)
  assert.equal(bytes.subarray(0, -1).includes(0x0a), false)
  const sealed = JSON.parse(bytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  assert.deepEqual(canonicalBytes(sealed), bytes.subarray(0, -1))
  assert.equal(sealed.schema_id, 'oracle-lab-p3b-pre-epoch-admission-seal.v1')
  assert.equal(sealed.decision, 'PASS')
  assert.equal(sealed.epoch_consumed, false)
  assert.equal(sealed.signer_starts, 0)
  const receiptBytes = readFileSync(String(value.input.receipt_path))
  assert.equal(sealed.receipt_raw_sha256, sha256Bytes(receiptBytes))
  const output = JSON.parse(receiptBytes.subarray(0, -1).toString('utf8')) as Record<string, unknown>
  assert.deepEqual(canonicalBytes(output), receiptBytes.subarray(0, -1))
  assert.equal(output.output_sha256, sha256Bytes(canonicalBytes(Object.fromEntries(Object.entries(output).filter(([key]) => key !== 'output_sha256')))))
  assert.deepEqual(readdirSync(value.container), before)
})

test('RED: admission rejects predecessor byte drift before epoch consumption', () => {
  const value = fixture()
  writeFileSync(String(value.input.predecessor_config_auth_path), CONFIG_AUTH.replace('Reproduced', 'Unknown'), { flag: 'w', mode: 0o600 })
  const result = run(value.inputPath, value.authority)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /pre_epoch_predecessor_invalid/)
  assert.deepEqual(readdirSync(value.container), [])
})

test('RED: admission rejects Sub parent substitution and nonempty campaign containers', () => {
  const parentDrift = fixture()
  const parentAuthority = { ...parentDrift.authority, sub_parents: [...parentDrift.authority.sub_parents].reverse() as [string, string] }
  const parentResult = run(parentDrift.inputPath, parentAuthority)
  assert.equal(parentResult.status, 1)
  assert.match(parentResult.stderr, /pre_epoch_repository_invalid/)

  const nonempty = fixture()
  writeFileSync(path.join(nonempty.container, 'unexpected'), 'occupied', { flag: 'wx' })
  const containerResult = run(nonempty.inputPath, nonempty.authority)
  assert.equal(containerResult.status, 1)
  assert.match(containerResult.stderr, /pre_epoch_container_invalid/)
})

test('RED: admission CLI rejects unknown fields instead of coercing input', () => {
  const value = fixture()
  rewriteInput(value.inputPath, { ...value.input, git: ['not-used'] })
  assert.throws(() => admissionMain(['--input', value.inputPath]), (error: Error & { code?: string }) => error.code === 'pre_epoch_admission_cli_invalid')
  assert.equal(readFileSync(value.inputPath).at(-1), 0x0a)
})

test('RED: admission rejects remote-ref drift and the exact expiry boundary', () => {
  const remoteDrift = fixture()
  git(String(remoteDrift.input.cc_repository), ['update-ref', 'refs/remotes/muqihang/main', remoteDrift.authority.cc_required_ancestor_commit])
  const remoteResult = run(remoteDrift.inputPath, remoteDrift.authority)
  assert.equal(remoteResult.status, 1)
  assert.match(remoteResult.stderr, /pre_epoch_repository_invalid/)

  const expired = fixture()
  const expiryResult = run(expired.inputPath, expired.authority, Date.parse(expired.authority.predecessor_expiry))
  assert.equal(expiryResult.status, 1)
  assert.match(expiryResult.stderr, /pre_epoch_predecessor_invalid/)
})

test('RED: terminal CC coherence rejects a mutation during later validation', () => {
  const value = fixture()
  const input = value.input as PreEpochAdmissionInput
  assert.throws(
    () => evaluatePreEpochAdmission(input, { authority: value.authority, hooks: { after_initial_cc: () => { writeFileSync(path.join(String(input.cc_repository), 'late-drift'), 'drift', { flag: 'wx' }) } } }),
    (error: Error & { code?: string }) => error.code === 'pre_epoch_repository_invalid',
  )
})

test('RED: container fd/path coherence rejects chmod and pathname substitution races', () => {
  const chmodRace = fixture()
  assert.throws(
    () => evaluatePreEpochAdmission(chmodRace.input as PreEpochAdmissionInput, { authority: chmodRace.authority, hooks: { after_container_open: () => { chmodSync(chmodRace.container, 0o755) } } }),
    (error: Error & { code?: string }) => error.code === 'pre_epoch_container_invalid',
  )

  const swapRace = fixture()
  assert.throws(
    () => evaluatePreEpochAdmission(swapRace.input as PreEpochAdmissionInput, { authority: swapRace.authority, hooks: { after_container_open: () => { renameSync(swapRace.container, `${swapRace.container}-opened`); mkdirSync(swapRace.container, { mode: 0o700 }) } } }),
    (error: Error & { code?: string }) => error.code === 'pre_epoch_container_invalid',
  )
})

test('RED: a duplicate admission receipt fails without overwriting the first bytes', () => {
  const value = fixture()
  const first = run(value.inputPath, value.authority)
  assert.equal(first.status, 0, first.stderr)
  const before = readFileSync(String(value.input.receipt_path))
  const second = run(value.inputPath, value.authority)
  assert.equal(second.status, 1)
  assert.match(second.stderr, /pre_epoch_admission_receipt_invalid/)
  assert.deepEqual(readFileSync(String(value.input.receipt_path)), before)
})

test('RED: admission outputs cannot dirty either authority repository', () => {
  for (const repositoryField of ['cc_repository', 'sub_repository'] as const) {
    const receipt = fixture()
    const input = { ...receipt.input, receipt_path: path.join(String(receipt.input[repositoryField]), 'admission-receipt.json') } as PreEpochAdmissionInput
    assert.throws(
      () => evaluatePreEpochAdmission(input, { authority: receipt.authority }),
      (error: Error & { code?: string }) => error.code === 'pre_epoch_admission_input_invalid',
    )
    assert.equal(git(String(receipt.input.cc_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
    assert.equal(git(String(receipt.input.sub_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')

    const container = fixture()
    const nestedContainer = path.join(String(container.input[repositoryField]), 'campaign-container')
    mkdirSync(nestedContainer, { mode: 0o700 })
    assert.equal(git(String(container.input[repositoryField]), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
    assert.throws(
      () => evaluatePreEpochAdmission({ ...container.input, campaign_container: nestedContainer } as PreEpochAdmissionInput, { authority: container.authority }),
      (error: Error & { code?: string }) => error.code === 'pre_epoch_admission_input_invalid',
    )
    assert.equal(git(String(container.input.cc_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
    assert.equal(git(String(container.input.sub_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
  }
})

test('RED: repository aliases cannot narrow either authority root', () => {
  for (const repositoryField of ['cc_repository', 'sub_repository'] as const) {
    for (const outputField of ['campaign_container', 'receipt_path'] as const) {
      const value = fixture()
      const repository = String(value.input[repositoryField])
      const alias = path.join(repository, 'admission-root-alias')
      const output = path.join(repository, outputField === 'campaign_container' ? 'campaign-container-alias-output' : 'admission-receipt-alias-output.json')
      mkdirSync(alias, { mode: 0o700 })
      if (outputField === 'campaign_container') mkdirSync(output, { mode: 0o700 })
      assert.equal(git(repository, ['status', '--porcelain=v1', '--untracked-files=normal']), '')

      assert.throws(
        () => evaluatePreEpochAdmission({ ...value.input, [repositoryField]: alias, [outputField]: output } as PreEpochAdmissionInput, { authority: value.authority }),
        (error: Error & { code?: string }) => error.code === 'pre_epoch_repository_invalid',
      )
      assert.equal(git(String(value.input.cc_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
      assert.equal(git(String(value.input.sub_repository), ['status', '--porcelain=v1', '--untracked-files=normal']), '')
    }
  }
})

test('RED: production authority and source closures bind the pre-epoch executable', () => {
  assert.deepEqual(PRE_EPOCH_ADMISSION_AUTHORITY, {
    cc_required_ancestor_commit: '04003be69f86225da59fa27cf294c43b3d7e0285',
    cc_required_ancestor_tree: 'e62a46de130c874aa53d7232b3a4cf06be45065e',
    cc_remote_ref: 'refs/remotes/muqihang/main',
    require_github_web_flow_signature: true,
    sub_commit: '910a8fb3caa317409be48af31af699932be1f2a7',
    sub_tree: 'e6a788c98c9b529a47e88f97ae82fb489cff15cd',
    sub_parents: ['a4ce6e375a5b6ac46d4605bc3be2da1f9a2351a8', 'd2ff3956d3841b51c22de0db95c27dbc47378fcd'],
    predecessor_expiry: '2026-08-03T00:00:00.000Z',
    predecessors: {
      'CL-P3A-R2-CONFIG-AUTH': 'acaffa9fe6e2d9f1eede5d6bf65f32369558275cfa893b9e97187bed3f37b905',
      'CL-P3A-R2-FAILURE-STREAM': 'fa0dafe1edc8afccbcc4f10f94513c432c2e61e518bf6e38c47c90b7ba8224e4',
    },
  })
  const root = path.join(import.meta.dirname, '..')
  assert.doesNotThrow(() => verifyGithubWebFlowCommit(root, PRE_EPOCH_ADMISSION_AUTHORITY.cc_required_ancestor_commit))
  const materializer = readFileSync(path.join(root, 'tools/oracle-lab/phase3b-evidence-sufficiency/authority-materializer.ts'), 'utf8')
  const admissionCli = readFileSync(path.join(root, 'tools/oracle-lab/phase3b-evidence-sufficiency/pre-epoch-admission-cli.ts'), 'utf8')
  const sourceIdentity = readFileSync(path.join(root, 'tools/oracle-lab/phase3b-evidence-sufficiency/source-identity.ts'), 'utf8')
  assert.match(materializer, /const focused = \[[^\]]*tests\/oracle-phase3b-pre-epoch-admission-red\.test\.ts[^\]]*\]/s)
  assert.match(materializer, /const sources = \[[^\]]*pre-epoch-admission-cli\.ts[^\]]*pre-epoch-admission\.ts[^\]]*\]/s)
  assert.match(materializer, /const schemaFiles = \[[^\]]*pre-epoch-admission-cli\.ts[^\]]*pre-epoch-admission\.ts[^\]]*\]/s)
  assert.match(sourceIdentity, /const CONTROLLER_SOURCES = \[[^\]]*pre-epoch-admission-cli\.ts[^\]]*pre-epoch-admission\.ts[^\]]*\]/s)
  assert.doesNotMatch(admissionCli, /authority\?:|now_ms\?:/)
})
