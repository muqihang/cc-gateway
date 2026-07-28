import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as campaignController from '../tools/oracle-lab/phase3b-evidence-sufficiency/campaign-controller.js'

function privateRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), prefix)))
  chmodSync(root, 0o700)
  return root
}

const MODULE_ROOT = realpathSync(path.join(import.meta.dirname, '../tools/oracle-lab/phase3b-evidence-sufficiency'))
const ENTRY_SOURCE = path.join(MODULE_ROOT, 'campaign-controller.ts')
const BANNED_SECURITY_PATHS = new Set(['production-executor.ts', 'production-dry-run-adapters.ts'])

function reachableTypescriptFiles(entry: string): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string): void => {
    const normalized = realpathSync(file)
    if (seen.has(normalized)) return
    seen.add(normalized)
    const source = readFileSync(normalized, 'utf8')
    for (const match of source.matchAll(/(?:from\s+|import\s*)['\"](\.\.?\/[^'\"]+)['\"]/g)) {
      const candidate = path.resolve(path.dirname(normalized), match[1].replace(/\.js$/, '.ts'))
      if (candidate.startsWith(`${MODULE_ROOT}${path.sep}`)) visit(candidate)
    }
  }
  visit(entry)
  return seen
}

async function waitForFile(file: string, timeoutMs = 900_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${path.basename(file)}`)
}

function childExit(child: ChildProcess): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('close', (code) => resolve({ code, stderr }))
  })
}

function persistedFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name)
      const stat = lstatSync(file)
      assert.equal(stat.isSymbolicLink(), false)
      if (stat.isDirectory()) walk(file)
      else if (stat.isFile()) files.push(file)
    }
  }
  walk(root)
  return files
}

test('production path RED: only the real campaign-controller entry is reachable', () => {
  const thisTest = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  const requirementsFixture = readFileSync(path.join(import.meta.dirname, 'fixtures/phase3b-test-requirements-signer.ts'), 'utf8')
  const productionImports = [...thisTest.matchAll(/from ['\"]\.\.\/tools\/oracle-lab\/phase3b-evidence-sufficiency\/([^'\"]+)['\"]/g)].map((match) => match[1])
  assert.deepEqual(productionImports, ['campaign-controller.js'])
  const reachable = [...reachableTypescriptFiles(ENTRY_SOURCE)].map((file) => path.basename(file))
  assert.deepEqual(reachable.filter((name) => BANNED_SECURITY_PATHS.has(name)), [])
  assert.match(requirementsFixture, /await waitFor\(externalSetPath\)/)
  assert.doesNotMatch(requirementsFixture, /await waitFor\(terminalPath\)/)
})

test('production path RED: the real controller owns the complete sealed lifecycle', async () => {
  const root = privateRoot('p3b-real-controller-red-')
  const fixtureRoot = privateRoot('p3b-real-controller-authority-red-')
  const materializedRoot = privateRoot('p3b-real-controller-materialized-red-')
  const securityRoot = privateRoot('p3b-real-controller-security-red-')
  const repository = realpathSync(path.join(import.meta.dirname, '..'))
  const subRepository = realpathSync(process.env.ORACLE_SUB2API_ROOT ?? '/Users/muqihang/.codex/worktrees/79ad/sub2api-zhumeng-main')
  const materializer = spawnSync(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'fixtures/phase3b-test-materializer.ts'), materializedRoot, repository, subRepository], { cwd: repository, encoding: 'utf8', timeout: 900_000, maxBuffer: 8_388_608 })
  assert.equal(materializer.status, 0, materializer.stderr)
  const materializedPath = materializer.stdout.trim()
  assert.equal(realpathSync(materializedPath).startsWith(`${materializedRoot}${path.sep}`), true)

  const requirements = spawn(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'fixtures/phase3b-test-requirements-signer.ts'), materializedPath, securityRoot, fixtureRoot, root], { cwd: repository, stdio: ['ignore', 'pipe', 'pipe'] })
  const requirementsExit = childExit(requirements)
  const requirementsPublicPath = path.join(fixtureRoot, 'phase3b-test-requirements-public-entry.json')
  await waitForFile(requirementsPublicPath)
  const security = spawnSync(process.execPath, ['--import', 'tsx', path.join(import.meta.dirname, 'fixtures/phase3b-test-security-reviewer.ts'), materializedPath, requirementsPublicPath, securityRoot], { cwd: repository, encoding: 'utf8', timeout: 60_000, maxBuffer: 1_048_576 })
  assert.equal(security.status, 0, security.stderr)
  const authorityManifestPath = path.join(fixtureRoot, 'phase3b-test-authority-manifest.json')
  await waitForFile(authorityManifestPath)

  const entry = (campaignController as Record<string, unknown>).runCampaignController
  assert.equal(typeof entry, 'function', 'campaign-controller must expose the one complete production entry')
  let result: Readonly<Record<string, unknown>>
  try {
    result = await (entry as (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>)({
      mode: 'test-owned-offline-full-path',
      authority_manifest_path: authorityManifestPath,
      evidence_root: root,
    })
  } catch (error) {
    if (requirements.exitCode !== null || requirements.signalCode !== null) {
      const exited = await requirementsExit
      throw new Error(`requirements signer exited before controller completion: ${exited.stderr}`, { cause: error })
    }
    requirements.kill('SIGKILL')
    await requirementsExit
    throw error
  }
  assert.equal(result.schema_id, 'oracle-lab-p3b-campaign-controller-result.v1')
  assert.equal(result.row_count, 340)
  assert.equal(result.receipt_count, 1020)
  assert.equal(result.normative_leaf_count, 152)
  assert.equal(result.pre_gate_leak_status, 'PASS')
  assert.equal(result.post_gate_leak_status, 'PASS')
  assert.equal(result.gate_b_validated, true)
  assert.equal(result.signer_destroyed, true)
  const signerExit = await requirementsExit
  assert.equal(signerExit.code, 0, signerExit.stderr)

  const ledger = JSON.parse(readFileSync(path.join(root, 'prelaunch/run-ledger.json'), 'utf8')) as Record<string, unknown>
  const rows = ledger.rows as Array<Record<string, unknown>>
  const processEnvRow = rows.find((row) => row.schedule_id === 'config-precedence-process-env-vs-local' && String(row.arm).startsWith('treatment/'))
  assert.ok(processEnvRow)
  const observationName = readdirSync(path.join(root, 'observations')).find((name) => name.startsWith(`${String(processEnvRow.sequence_index).padStart(3, '0')}-`))
  assert.ok(observationName)
  const observation = JSON.parse(readFileSync(path.join(root, 'observations', observationName), 'utf8')) as Record<string, unknown>
  assert.equal(observation.route_ordinal, 1)
  assert.equal(Number(observation.target_pid) > 0, true)
  assert.match(String(observation.executable_identity_sha256), /^[a-f0-9]{64}$/)

  for (const file of persistedFiles(root)) {
    const relative = path.relative(root, file)
    if (relative === 'launch-images/original-image' || relative === 'launch-images/probe-image') continue
    const text = readFileSync(file).toString('utf8')
    if (relative === 'control/trusted-reviewers.json') continue
    assert.doesNotMatch(text, /oracle-phase3b-placeholder|BEGIN .*PRIVATE KEY|"(?:[^"\n]*(?:secret|password|credential|authorization|raw_body|raw_bytes|_hex|url_encoded|_base64))"\s*:/i, relative)
  }
})

test('production path RED: public entry accepts sealed paths, never authored verdict fields', async () => {
  const entry = (campaignController as Record<string, unknown>).runCampaignController
  assert.equal(typeof entry, 'function')
  for (const forged of [
    { gate_a: { decision: 'PASS' } },
    { gate_b: { decision: 'PASS' } },
    { leak_status: 'PASS' },
    { child_pid: process.pid },
    { peer: '127.0.0.1' },
    { es9_values: [] },
    { signer_destroyed: true },
  ]) {
    await assert.rejects(
      (entry as (input: Readonly<Record<string, unknown>>) => Promise<unknown>)({
        mode: 'test-owned-offline-full-path',
        authority_manifest_path: path.join(privateRoot('p3b-forged-real-entry-'), 'sealed-manifest.json'),
        evidence_root: privateRoot('p3b-forged-real-root-'),
        ...forged,
      }),
      (error: Error & { code?: string }) => error.code === 'campaign_controller_input_invalid',
    )
  }
})
