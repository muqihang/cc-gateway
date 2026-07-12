import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { digestFile } from '../tools/oracle-lab/harness-core.js'
import { validateRunInputs } from '../tools/oracle-lab/validate-run-manifest.js'

const registryRelative = 'docs/superpowers/registry/oracle-lab-requirements.json'
const claimsRelative = 'docs/superpowers/registry/oracle-lab-claims.json'
const catalog = path.resolve('docs/superpowers/registry/oracle-lab-command-catalog.json')
const entryBaseline = path.resolve('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json')

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

async function fixture(): Promise<{
  root: string
  registry: string
  claims: string
  manifest: string
  reviewedHead: string
  setManifestHead: (head: string) => Promise<void>
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-reviewed-snapshot-'))
  const registry = path.join(root, registryRelative)
  const claims = path.join(root, claimsRelative)
  const manifest = path.join(root, 'exit.json')
  await mkdir(path.dirname(registry), { recursive: true })
  await writeFile(registry, await readFile(path.resolve(registryRelative)))
  await writeFile(claims, await readFile(path.resolve(claimsRelative)))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'Oracle Test')
  git(root, 'add', 'docs')
  git(root, 'commit', '-qm', 'fixture: reviewed governance snapshot')
  const reviewedHead = git(root, 'rev-parse', 'HEAD')

  const template = JSON.parse(await readFile(entryBaseline, 'utf8')) as Record<string, any>
  template.phase = 'phase_0_exit'
  template.entry_kind = 'phase_0_exit'
  template.approved_tool_head = reviewedHead
  template.repositories.cc_gateway.head = reviewedHead
  template.governance = {
    requirement_registry: { status: 'present', sha256: digestFile(registry).slice(7) },
    claim_registry: { status: 'present', sha256: digestFile(claims).slice(7) },
  }
  template.parent_reference = {
    type: 'phase_0_entry_evidence',
    entry_manifest: { repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.json').toString('base64url'), sha256: 'a'.repeat(64) },
    entry_receipt: { repository_relative_path_base64url: Buffer.from('docs/superpowers/evidence/phase-0/phase-0-entry-baseline.receipt.json').toString('base64url'), sha256: 'b'.repeat(64) },
  }
  template.capture_inputs = {
    schema: { repository_relative_path_base64url: Buffer.from('docs/superpowers/schemas/oracle-lab-run-manifest.schema.json').toString('base64url'), sha256: 'c'.repeat(64) },
    tool: { repository_relative_path_base64url: Buffer.from('tools/oracle-lab/freeze-baseline.ts').toString('base64url'), sha256: 'd'.repeat(64) },
  }
  const setManifestHead = async (head: string) => {
    template.approved_tool_head = head
    template.repositories.cc_gateway.head = head
    await writeFile(manifest, `${JSON.stringify(template, null, 2)}\n`)
  }
  await setManifestHead(reviewedHead)
  return { root, registry, claims, manifest, reviewedHead, setManifestHead }
}

async function writePendingRegistry(registry: string, reviewedHead: string): Promise<void> {
  const records = JSON.parse(await readFile(registry, 'utf8')) as Array<Record<string, unknown>>
  const requirement = records.find((record) => record.requirement_id === 'HA-P0-001')!
  requirement.implementation_status = 'locally_verified'
  requirement.last_verified_commit = reviewedHead
  requirement.last_verified_at = '2026-07-12T00:00:00-07:00'
  await writeFile(registry, `${JSON.stringify(records, null, 2)}\n`)
}

test('exit validation reads reviewed governance bytes from the bound ancestor commit and accepts valid pending status bytes', async () => {
  const f = await fixture()
  await writePendingRegistry(f.registry, f.reviewedHead)
  assert.notEqual(digestFile(f.registry).slice(7), JSON.parse(await readFile(f.manifest, 'utf8')).governance.requirement_registry.sha256)
  assert.deepEqual(validateRunInputs(f.registry, f.claims, f.manifest, catalog), { ok: true, errors: [] })
})

test('exit validation rejects tampered reviewed digests, unavailable or non-ancestor commits, wrong repositories, and missing committed paths', async () => {
  const tampered = await fixture()
  const tamperedManifest = JSON.parse(await readFile(tampered.manifest, 'utf8'))
  tamperedManifest.governance.requirement_registry.sha256 = 'e'.repeat(64)
  await writeFile(tampered.manifest, JSON.stringify(tamperedManifest))
  assert.equal(validateRunInputs(tampered.registry, tampered.claims, tampered.manifest, catalog).ok, false)

  const nonAncestor = await fixture()
  const initialBranch = git(nonAncestor.root, 'branch', '--show-current')
  git(nonAncestor.root, 'checkout', '-qb', 'detached-history')
  await writeFile(path.join(nonAncestor.root, 'unrelated.txt'), 'unrelated\n')
  git(nonAncestor.root, 'add', 'unrelated.txt')
  git(nonAncestor.root, 'commit', '-qm', 'fixture: unrelated head')
  const unrelatedHead = git(nonAncestor.root, 'rev-parse', 'HEAD')
  git(nonAncestor.root, 'checkout', '-q', initialBranch)
  await nonAncestor.setManifestHead(unrelatedHead)
  assert.equal(validateRunInputs(nonAncestor.registry, nonAncestor.claims, nonAncestor.manifest, catalog).ok, false)

  const missingPath = await fixture()
  await writeFile(missingPath.claims, '[]\n')
  git(missingPath.root, 'add', claimsRelative)
  git(missingPath.root, 'commit', '-qm', 'fixture: remove path in parent')
  git(missingPath.root, 'rm', '-q', claimsRelative)
  git(missingPath.root, 'commit', '-qm', 'fixture: missing claim path')
  const missingHead = git(missingPath.root, 'rev-parse', 'HEAD')
  await writeFile(missingPath.claims, await readFile(path.resolve(claimsRelative)))
  await missingPath.setManifestHead(missingHead)
  assert.equal(validateRunInputs(missingPath.registry, missingPath.claims, missingPath.manifest, catalog).ok, false)

  const wrong = await fixture()
  const other = await fixture()
  await writeFile(path.join(wrong.root, 'repository-identity.txt'), 'wrong repository\n')
  git(wrong.root, 'add', 'repository-identity.txt')
  git(wrong.root, 'commit', '-qm', 'fixture: distinct wrong repository head')
  await other.setManifestHead(git(wrong.root, 'rev-parse', 'HEAD'))
  assert.equal(validateRunInputs(other.registry, other.claims, other.manifest, catalog).ok, false)
})

test('pending governance changes cannot replace fixed owners, gates, inventory, or claim authority', async () => {
  for (const mutate of [
    (records: Array<Record<string, any>>) => { records[0].owner = 'replacement-owner' },
    (records: Array<Record<string, any>>) => { records[0].acceptance_gate = 'replacement-gate' },
    (records: Array<Record<string, any>>) => { records.find((record) => record.requirement_id === 'HA-P0-001').implementation_status = 'failing_test_added' },
    (records: Array<Record<string, any>>) => { records.reverse() },
  ]) {
    const f = await fixture()
    const records = JSON.parse(await readFile(f.registry, 'utf8'))
    mutate(records)
    await writeFile(f.registry, JSON.stringify(records))
    assert.equal(validateRunInputs(f.registry, f.claims, f.manifest, catalog).ok, false)
  }

  const claimFixture = await fixture()
  const claims = JSON.parse(await readFile(claimFixture.claims, 'utf8'))
  claims[0].statement = 'A structurally valid but unreviewed replacement claim.'
  await writeFile(claimFixture.claims, JSON.stringify(claims))
  assert.equal(validateRunInputs(claimFixture.registry, claimFixture.claims, claimFixture.manifest, catalog).ok, false)
})

test('entry manifests retain current-working-byte digest behavior', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-h0-entry-behavior-'))
  const registry = path.join(root, 'requirements.json')
  const claims = path.join(root, 'claims.json')
  const manifest = path.join(root, 'entry.json')
  await writeFile(registry, await readFile(path.resolve(registryRelative)))
  await writeFile(claims, await readFile(path.resolve(claimsRelative)))
  const entry = JSON.parse(await readFile(entryBaseline, 'utf8'))
  entry.governance = {
    requirement_registry: { status: 'present', sha256: digestFile(registry).slice(7) },
    claim_registry: { status: 'present', sha256: digestFile(claims).slice(7) },
  }
  await writeFile(manifest, JSON.stringify(entry))
  assert.deepEqual(validateRunInputs(registry, claims, manifest, catalog), { ok: true, errors: [] })
  await writePendingRegistry(registry, entry.repositories.cc_gateway.head)
  assert.equal(validateRunInputs(registry, claims, manifest, catalog).ok, false)
})
