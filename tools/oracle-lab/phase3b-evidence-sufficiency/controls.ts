import { createServer } from 'node:net'

import { sha256Bytes, sha256File } from '../phase3a/core.js'
import { type LaunchManifest, validateLaunchManifest } from '../phase3a/launch-manifest.js'
import { buildCellSandboxProfile, runCellGuardSelfTest } from '../phase3a/run-cell.js'
import { RESOURCE_BUDGET, writeExclusiveEvidence } from './core.js'

const PLAN_SHA256 = '1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57'
const ENTRYPOINT_SHA256 = '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58'
const ARCHIVE_SHA256 = 'b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2'
const TREE_SHA256 = '864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6'

export function buildSupplementGuardManifest(input: {
  campaign_id: string
  cell_id: string
  receiver_port: number
  cc_commit: string
  cc_tree: string
  sub_commit: string
  sub_tree: string
}): LaunchManifest {
  const cellRoot = `capsules/P3B-ES1/control/guard-scratch/${input.cell_id}`
  const emptySha = sha256Bytes(new Uint8Array())
  const manifest: LaunchManifest = {
    schema_version: 'oracle-lab-phase3a-launch-manifest.v1',
    run_id: `${input.campaign_id}-${input.cell_id}`,
    parent_run_id: null,
    pair_id: 'p3b-es1-guard-capability',
    sequence_index: 0,
    randomization_seed: 215001,
    phase: '3A',
    requirement_ids: ['HA-P1-001'],
    hypothesis_id: 'normalized-safe-zero-egress-guard-capability',
    evidence_level_ceiling: 'Observed',
    repositories: {
      cc_gateway: { commit: input.cc_commit, tree: input.cc_tree, dirty_digest: PLAN_SHA256 },
      sub2api: { commit: input.sub_commit, tree: input.sub_tree, dirty_digest: PLAN_SHA256 },
    },
    contract: { bundle_id: 'oracle.compatibility.v1', bundle_sha256: PLAN_SHA256, schema_range: '1:0-0', predecessor_sha256: PLAN_SHA256 },
    artifact: {
      package: '@anthropic-ai/claude-code-darwin-arm64', version: '2.1.215', registry_url: 'https://registry.npmjs.org/',
      archive_sha256: ARCHIVE_SHA256, tree_sha256: TREE_SHA256, entrypoint_sha256: ENTRYPOINT_SHA256,
    },
    toolchain_digest: sha256File(process.execPath),
    platform: { os: 'darwin', release: 'synthetic-control', arch: 'arm64', runtime: 'native', virtualization: 'none' },
    command: {
      executable_sha256: sha256File(process.execPath),
      argv: ['-e', 'process.exit(0)'],
      cwd: `${cellRoot}/cwd`,
      stdin_sha256: emptySha,
      timeout_ms: RESOURCE_BUDGET.cell_wall_ms_max,
    },
    environment: {
      allowlist: { PATH: '/usr/bin:/bin' },
      explicit_empty: [],
      unset: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'],
      home: `${cellRoot}/home`,
      xdg: `${cellRoot}/xdg`,
      tmp: `${cellRoot}/tmp`,
      tz: 'UTC', lang: 'C', lc_all: 'C',
      base_urls: [`http://127.0.0.1:${input.receiver_port}/`],
    },
    network: {
      policy: 'declared_loopback_only', loopback_ports: [input.receiver_port], proxy_mode: 'none', ca_sha256: null,
      external_socket_budget: 0,
    },
    matrix: { changed_variable: 'guard-capability', control_value: 'exact-profile', treatment_value: 'not-applicable', fixed_variables: { synthetic: true } },
    limits: {
      wall_ms: RESOURCE_BUDGET.cell_wall_ms_max,
      cpu_ms: RESOURCE_BUDGET.cell_cpu_ms_max,
      rss_bytes: RESOURCE_BUDGET.cell_rss_bytes_max,
      output_bytes: RESOURCE_BUDGET.cell_output_bytes_max,
      processes: RESOURCE_BUDGET.cell_processes_max,
      retries: RESOURCE_BUDGET.cell_retries_max,
      sockets: RESOURCE_BUDGET.cell_sockets_max,
      files: RESOURCE_BUDGET.cell_files_max,
    },
    capture: { hook: false, inspector: false, process: true, fs: true, network: true, tls: false, http: true, pcap: false, stdout: true, stderr: true },
    redaction_policy: 'oracle-lab-phase3a-redaction.v1',
    retention_class: 'synthetic-raw-14d',
    expiry: '2026-08-08T00:00:00.000Z',
    previous_manifest_sha256: null,
    preflight: {
      status: 'PASS', codegraph_current: true, plan_sha256: PLAN_SHA256, p2_bundle_sha256: PLAN_SHA256, predecessor_sha256: PLAN_SHA256,
      cc_head: input.cc_commit, cc_tree: input.cc_tree, sub2api_head: input.sub_commit, sub2api_tree: input.sub_tree,
    },
  }
  return validateLaunchManifest(manifest)
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') { reject(new Error('control listener did not bind TCP')); return }
      resolve(address.port)
    })
  })
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

export async function runGuardCapabilityControl(input: {
  evidence_root: string
  campaign_id: string
  cc_commit: string
  cc_tree: string
  sub_commit: string
  sub_tree: string
}): Promise<Record<string, unknown>> {
  const listener = createServer((socket) => socket.end())
  const port = await listen(listener)
  try {
    const manifest = buildSupplementGuardManifest({ ...input, cell_id: 'prelaunch-guard', receiver_port: port })
    const profile = buildCellSandboxProfile(manifest, input.evidence_root)
    const guard = await runCellGuardSelfTest(manifest, input.evidence_root)
    const receiverNamespaceExcluded = !profile.includes('observations/receiver')
    const probeNamespaceExcluded = !profile.includes('control/probe')
    const record = {
      schema_id: 'oracle-lab-p3b-es-guard-control.v1',
      schema_major: 1,
      schema_revision: 0,
      campaign_id: input.campaign_id,
      status: guard.status === 'PASS' && receiverNamespaceExcluded && probeNamespaceExcluded ? 'PASS' : 'FAIL',
      target_launches: 0,
      external_socket_budget: guard.external_socket_budget,
      same_scope_probe: guard.same_scope_probe,
      profile_sha256: guard.profile_sha256,
      manifest_sha256: guard.manifest_sha256,
      receiver_namespace_write_blocked: receiverNamespaceExcluded,
      probe_namespace_write_blocked: probeNamespaceExcluded,
      probe: guard.probe,
      raw_material_persisted: false,
    }
    writeExclusiveEvidence(input.evidence_root, 'capsules/P3B-ES1/control/guard/guard-self-test.json', record, 'controller')
    return record
  } finally { await close(listener) }
}
