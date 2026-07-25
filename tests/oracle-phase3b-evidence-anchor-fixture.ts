import { chmodSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { canonicalEvidenceBytes, sha256Bytes } from '../tools/oracle-lab/phase3b-evidence-sufficiency/core.js'
import {
  computeSchemaBundleDigest,
  receiverExecutableIdentity,
  STATIC_ANCHOR_SELECTION_RELATIVE,
} from '../tools/oracle-lab/phase3b-evidence-sufficiency/static-anchor.js'

type Json = Record<string, any>
type Mutators = Partial<Record<'authority' | 'freeze' | 'campaign' | 'anchor' | 'selection', (value: Json) => void>>

const PLAN_SHA256 = '1583dad45085e3dc18941349f323e2342eedd0ff273eb12a7a1a43f5dc736a57'
const ARTIFACT = {
  architecture: 'arm64',
  archive_sha256: 'b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2',
  artifact_record_sha256: '1'.repeat(64),
  entrypoint_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
  package: '@anthropic-ai/claude-code-darwin-arm64',
  platform: 'darwin',
  tree_sha256: '864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6',
  version: '2.1.215',
}
const RESOURCE_BUDGET = {
  target_launches_max: 340, target_launches_parallel: 1, campaign_wall_ms_max: 36_000_000, cell_wall_ms_max: 90_000,
  cell_cpu_ms_max: 60_000, cell_rss_bytes_max: 1_073_741_824, cell_output_bytes_max: 8_388_608, cell_processes_max: 16,
  cell_sockets_max: 8, cell_retries_max: 8, cell_files_max: 512, receiver_body_bytes_max: 8_388_608,
  receiver_headers_max: 256, receiver_events_max: 1024, receiver_attempts_max: 8, external_socket_budget: 0,
}

function digestRecord(value: Json): { bytes: Buffer; sha256: string } {
  const bytes = canonicalEvidenceBytes(value)
  return { bytes, sha256: sha256Bytes(bytes) }
}

function writeCanonical(root: string, relative: string, value: Json): { path: string; sha256: string; size: number } {
  const absolute = path.join(root, ...relative.split('/'))
  mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 })
  chmodSync(path.dirname(absolute), 0o700)
  const { bytes, sha256 } = digestRecord(value)
  writeFileSync(absolute, bytes, { mode: 0o600, flag: 'wx' })
  return { path: absolute, sha256, size: bytes.length }
}

export function buildActiveAnchorFixture(rootInput: string, options: {
  campaign_id?: string
  anchor_relative_path?: string
  mutators?: Mutators
  materialize_anchor?: 'canonical' | 'missing' | 'noncanonical' | 'symlink'
  materialize_selection?: 'canonical' | 'missing' | 'noncanonical' | 'symlink'
} = {}) {
  chmodSync(rootInput, 0o700)
  const root = realpathSync(rootInput)
  const campaignId = options.campaign_id ?? 'p3b-es1-test'
  const anchorRelative = options.anchor_relative_path ?? 'capsules/P3B-ES1/control/static-anchor.json'
  const identity = receiverExecutableIdentity()
  const rootIdentity = { leaf_name: path.basename(root), realpath_sha256: sha256Bytes(root), required_initial_state: 'new_empty_before_authority' }
  const activeStaticAnchor = { selection_relative_path: STATIC_ANCHOR_SELECTION_RELATIVE, receiver_identity: identity }
  const repositories = {
    cc_gateway: { branch: 'codex/claude-code-2.1.215-phase3b-evidence-sufficiency', commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    sub2api: { branch: 'codex/claude-code-2.1.215-phase3b-evidence-sufficiency', commit: 'c'.repeat(40), tree: 'd'.repeat(40) },
  }
  const plan = {
    head: '067130bbb2729bebcc7f287b7bb99f7daa5775e6', merge_commit: 'a275594864d1f53a663ba96cbe599f9781f0c113',
    relative_path: 'docs/superpowers/plans/2026-07-24-claude-code-2.1.215-phase-3b-normalized-safe-evidence-sufficiency-supplement.md',
    sha256: PLAN_SHA256,
  }
  const authority: Json = {
    active_static_anchor: activeStaticAnchor, allowed_scope: Array.from({ length: 18 }, (_, index) => `ES${index}`),
    authority_id: `${campaignId}-authority`, capability_mode: 'new_non_resume', campaign_id: campaignId, decision: 'authorized',
    delegated_source_task_id: '019f518f-1a68-71d2-a959-b495302afe80', evidence_root_identity: rootIdentity, no_reused_dynamic_authority: true,
    plan, prohibited_scope: ['phase3b_compiler', 'phase4', 'production', 'real_upstream'], repositories, resource_budget: RESOURCE_BUDGET,
    schema_id: 'oracle-lab-p3b-es-operator-authority.v1', schema_major: 1, schema_revision: 0, synthetic_loopback_only: true,
  }
  options.mutators?.authority?.(authority)
  const authorityFile = writeCanonical(root, 'capsules/P3B-ES1/control/operator-authority.json', authority)

  const frozenRepositories = Object.fromEntries(Object.entries(repositories).map(([name, repository]) => [name, {
    ...repository, fork_main: repository.commit, fork_tree: repository.tree, tracked_clean: true, upstream_main: repository.commit,
    upstream_tree: repository.tree, worktree_realpath_sha256: name === 'cc_gateway' ? '2'.repeat(64) : '3'.repeat(64),
  }]))
  const toolchains = {
    cc_gateway: { node: 'v24.7.0', npm: '11.5.1', package_json_sha256: '4'.repeat(64), package_lock_sha256: '5'.repeat(64), tsconfig_sha256: '6'.repeat(64) },
    sub2api: { go: 'go version go1.26.5 darwin/arm64', go_mod_sha256: '7'.repeat(64), go_sum_sha256: '8'.repeat(64), gotoolchain: 'auto' },
  }
  const freeze: Json = {
    active_static_anchor: activeStaticAnchor, artifact: ARTIFACT, authority: { relative_path: 'capsules/P3B-ES1/control/operator-authority.json', sha256: authorityFile.sha256, size_bytes: authorityFile.size },
    campaign_id: campaignId, codegraph: {
      cc_gateway: { database_sha256: '9'.repeat(64), edges: 1, files: 1, nodes: 1, pending: 0, protected_count: 0 },
      config_sha256: 'f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98',
      exclusion: ['backend/internal/service/openai_compact_sse_keepalive_test.go'],
      sub2api: { database_sha256: 'a'.repeat(64), edges: 1, files: 1, nodes: 1, pending: 0, protected_count: 0 }, version: '1.1.6',
    }, dangerous_git_environment: [], evidence_root_identity: rootIdentity, plan, repositories: frozenRepositories,
    schema_id: 'oracle-lab-p3b-es-freeze.v1', schema_major: 1, schema_revision: 0, toolchains,
  }
  options.mutators?.freeze?.(freeze)
  const freezeFile = writeCanonical(root, 'capsules/P3B-ES1/control/freeze.json', freeze)

  const campaign: Json = {
    active_static_anchor: activeStaticAnchor, authority: { relative_path: 'capsules/P3B-ES1/control/operator-authority.json', sha256: authorityFile.sha256 },
    campaign_id: campaignId, capability_mode: 'new_non_resume', evidence_root_identity: rootIdentity, fixed_seeds: [215001, 215002, 215003, 215004, 215005],
    freeze: { relative_path: 'capsules/P3B-ES1/control/freeze.json', sha256: freezeFile.sha256 }, instrumentation_arms: ['instrumented', 'uninstrumented'],
    paired_arms: ['control/instrumented', 'control/uninstrumented', 'treatment/instrumented', 'treatment/uninstrumented'],
    plan_sha256: PLAN_SHA256, raw_material_persisted: false, resource_budget: RESOURCE_BUDGET,
    schedule_algorithm_id: 'fixed-base-plus-cyclic-rotation-v2', schedule_encoding_id: 'lp-u32be-v1',
    schema_id: 'oracle-lab-p3b-es-campaign-input.v1', schema_major: 1, schema_revision: 0, synthetic_credential_class: 'campaign_placeholder_only', target: ARTIFACT,
  }
  options.mutators?.campaign?.(campaign)
  const campaignFile = writeCanonical(root, 'capsules/P3B-ES1/control/campaign-input.json', campaign)

  const schemaBundle = computeSchemaBundleDigest(path.resolve('contracts/oracle-lab/evidence-sufficiency/v1'))
  const anchor: Json = {
    schema_id: 'oracle-lab-p3b-es-static-anchor.v1', schema_major: 1, schema_revision: 0, campaign_id: campaignId, plan_sha256: PLAN_SHA256,
    artifact: {
      package: ARTIFACT.package, version: ARTIFACT.version, platform: ARTIFACT.platform, architecture: ARTIFACT.architecture,
      platform_archive_sha256: ARTIFACT.archive_sha256, platform_tree_sha256: ARTIFACT.tree_sha256, entrypoint_sha256: ARTIFACT.entrypoint_sha256,
      entrypoint_size: 247_124_336, entrypoint_mode: 493, entry_module_offset: 217_140_984, entry_module_length: 20_163_513,
      entry_module_sha256: '67472f5f9cd28b3b83003eb29ee0747bdcebc6969cc14f726bfdae2e4d998d0f',
    },
    repositories: { cc_gateway: { commit: repositories.cc_gateway.commit, tree: repositories.cc_gateway.tree }, sub2api: { commit: repositories.sub2api.commit, tree: repositories.sub2api.tree } },
    toolchains: {
      node_version: toolchains.cc_gateway.node, npm_version: toolchains.cc_gateway.npm, go_version: toolchains.sub2api.go, gotooolchain: toolchains.sub2api.gotoolchain,
      files: [
        { repository: 'cc_gateway', path: 'package.json', sha256: toolchains.cc_gateway.package_json_sha256 },
        { repository: 'cc_gateway', path: 'package-lock.json', sha256: toolchains.cc_gateway.package_lock_sha256 },
        { repository: 'cc_gateway', path: 'tsconfig.json', sha256: toolchains.cc_gateway.tsconfig_sha256 },
        { repository: 'sub2api', path: 'backend/go.mod', sha256: toolchains.sub2api.go_mod_sha256 },
        { repository: 'sub2api', path: 'backend/go.sum', sha256: toolchains.sub2api.go_sum_sha256 },
      ],
    },
    schema_bundle: schemaBundle, schema_bundle_sha256: schemaBundle.sha256, invocation_descriptor_sha256: campaignFile.sha256,
    receiver_executable_sha256: identity.digest, probe_copy: {
      status: 'PASS', destination_relative: 'capsules/P3B-ES1/control/probe/claude-probe-copy', parent_sha256: ARTIFACT.entrypoint_sha256,
      patch_recipe_sha256: 'b'.repeat(64), pre_sign_sha256: 'c'.repeat(64), post_sign_sha256: 'd'.repeat(64), post_sign_size: 247_124_336,
      module_offset: 217_140_984, module_length: 20_163_513, module_before_sha256: 'e'.repeat(64), module_after_sign_sha256: 'f'.repeat(64),
      patch_offset: 217_140_984, patch_length: 1024, patch_before_sha256: '1'.repeat(64), patch_after_sha256: '2'.repeat(64), signing_record_sha256: '3'.repeat(64),
    }, static_evidence_level: 'Observed-local', raw_material_persisted: false,
  }
  options.mutators?.anchor?.(anchor)
  const materialize = (relative: string, value: Json, kind: 'canonical' | 'missing' | 'noncanonical' | 'symlink') => {
    const absolute = path.join(root, ...relative.split('/'))
    mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 })
    chmodSync(path.dirname(absolute), 0o700)
    const bytes = kind === 'noncanonical' ? Buffer.from(`${JSON.stringify(value, null, 2)}\n`) : canonicalEvidenceBytes(value)
    const result = { path: absolute, sha256: sha256Bytes(bytes), size: bytes.length }
    if (kind === 'missing') return result
    if (kind === 'symlink') {
      const target = `${absolute}.target`
      writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' })
      symlinkSync(target, absolute)
      return result
    }
    writeFileSync(absolute, bytes, { mode: 0o600, flag: 'wx' })
    return result
  }
  const anchorFile = materialize(anchorRelative, anchor, options.materialize_anchor ?? 'canonical')

  const selection: Json = {
    schema_id: 'oracle-lab-p3b-es-static-anchor-selection.v1', schema_major: 1, schema_revision: 0, campaign_id: campaignId, evidence_root_identity: rootIdentity,
    authority: { relative_path: 'capsules/P3B-ES1/control/operator-authority.json', sha256: authorityFile.sha256 },
    freeze: { relative_path: 'capsules/P3B-ES1/control/freeze.json', sha256: freezeFile.sha256 },
    campaign_input: { relative_path: 'capsules/P3B-ES1/control/campaign-input.json', sha256: campaignFile.sha256 },
    active_anchor: { relative_path: anchorRelative, sha256: anchorFile.sha256 }, superseded_anchors: [], receiver_identity: identity, raw_material_persisted: false,
  }
  options.mutators?.selection?.(selection)
  const selectionFile = materialize(STATIC_ANCHOR_SELECTION_RELATIVE, selection, options.materialize_selection ?? 'canonical')
  mkdirSync(path.join(root, 'capsules/P3B-ES1/observations/receiver'), { recursive: true, mode: 0o700 })
  return { root, campaign_id: campaignId, identity, authority, freeze, campaign, anchor, selection, authorityFile, freezeFile, campaignFile, anchorFile, selectionFile }
}
