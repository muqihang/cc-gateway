import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { userInfo } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import Ajv2020 from 'ajv/dist/2020.js'

import {
  canonicalJson,
  COMMIT_RE,
  DIGEST_RE,
  exactKeys,
  isObject,
  parseArgs,
  result,
  sha256,
  type HarnessErrorRecord,
  type HarnessResult,
} from './harness-core.js'
import {
  DISABLED_CAPABILITIES,
  HERMETIC_NETWORK_ENV,
  runBoundedProcess,
  writeExclusiveArtifact,
  type BoundedProcessResult,
} from './governance-amendment-evidence.js'
import { computeIgnoredPathInventory, type IgnoredPathInventory } from './ignored-path-inventory.js'
import {
  resolvePhase1LoopbackSandbox,
  runPhase1SandboxCanaries,
  sandboxBinding,
  wrapPhase1Command,
  type Phase1LoopbackSandbox,
} from './phase-1-loopback-sandbox.js'
import { assertNoGitReplacementRefs, runReviewedGit } from './secure-runtime.js'

export type Phase1Group = 'phase1-green' | 'phase1-red'
export type Phase1ImplementedRequirement = 'AV-B1-001' | 'AV-B2-001' | 'AV-B3-001' | 'RA-P0-008'
export type Phase1PreservedRedRequirement = 'AV-B4-001' | 'AV-B5-001' | 'AV-B6-001'
export type Phase1RedFailureFamily = 'B4' | 'B5' | 'B6' | 'TestPhase0B5' | 'TestPhase0B6'
export type Phase1FailureParser = 'node_test_tap_v1' | 'go_test_json_leaf_v1'
export type Phase1IgnoredOutputPolicy = 'none' | 'cc_build_dist_v1' | 'sub_frontend_build_v1' | 'sub2api_joint_safe_deliverable_v1'

export type Phase1NodeTapLifecycle = {
  parser: 'node_test_tap_v1'
  tap_version_count: 1
  terminal_plan_count: 1
  declared_test_count: 68
  observed_test_count: 68
  pass_count: 7
  fail_count: 61
  cancelled_count: 0
  skipped_count: 0
  todo_count: 0
  unexplained_stderr_line_count: 0
}

export type Phase1GoTestLifecycle = {
  parser: 'go_test_json_leaf_v1'
  packages: Array<{
    package_suffix: 'internal/control' | 'internal/server'
    start_count: number
    run_test_count: number
    terminal_test_count: number
    pass_test_count: number
    fail_test_count: number
    skip_test_count: number
    package_fail_terminal_count: number
    post_terminal_event_count: number
  }>
  unexplained_stderr_line_count: number
  malformed_or_unparsed_event_count: number
}

export type Phase1ParserLifecycle = Phase1NodeTapLifecycle | Phase1GoTestLifecycle

export type Phase1Command = {
  schema_version: 1
  id: string
  group: Phase1Group
  owner: 'oracle-lab-phase-1'
  requirement_ids: Array<Phase1ImplementedRequirement | Phase1PreservedRedRequirement>
  repository: 'cc-gateway' | 'sub2api' | 'egress-tls-sidecar'
  cwd: string
  argv: string[]
  env: Record<string, string>
  inherit_env: []
  shell: false
  expected_exit: 0 | 'nonzero'
  failure_parser: null | Phase1FailureParser
  expected_parser_lifecycle: null | Phase1ParserLifecycle
  expected_failure_count: number
  expected_failure_names: string[]
  expected_failure_families: Phase1RedFailureFamily[]
  allowed_failure_prefixes: string[]
  ignored_output_policies: { cc_gateway: Phase1IgnoredOutputPolicy; sub2api: Phase1IgnoredOutputPolicy }
  timeout_ms: number
  max_output_bytes: number
}

export type Phase1TrackedTreeEntry = {
  mode: '100644' | '100755' | '120000' | '160000'
  object_type: 'blob' | 'commit'
  object_oid: string
  path: string
}

export type Phase1ImplementationTreeBinding = {
  algorithm: 'git_ls_tree_v1_sha256_canonical_json'
  repository: 'cc_gateway' | 'sub2api'
  source_commit: string
  exclusion_policy: 'phase1_evidence_governance_only_v1'
  excluded_prefixes: string[]
  excluded_paths: string[]
  entry_count: number
  entries_digest: string
}

export type Phase1CanonicalFailures = {
  failure_event_count: number
  failure_event_names: string[]
  failure_count: number
  failure_names: string[]
  observed_failure_families: Phase1RedFailureFamily[]
  unclassified_failure_names: string[]
}

export type Phase1Classification = Phase1CanonicalFailures & {
  status: 'pass' | 'expected_fail' | 'unexpected_fail' | 'unexpected_pass'
  failure_parser: null | Phase1FailureParser
  parser_lifecycle: null | Phase1ParserLifecycle
}

export type Phase1RedParseResult = {
  failure_events: string[]
  lifecycle: Phase1ParserLifecycle
}

export type Phase1IgnoredRecord = {
  path: string
  type: 'regular' | 'directory' | 'symlink'
  mode: number
  size?: number
  content_digest?: string
  symlink_target?: string
  symlink_target_digest?: string
}

export type Phase1IgnoredStateBinding = {
  algorithm: 'git_exclude_standard_recursive_v1'
  repository: 'cc_gateway' | 'sub2api'
  endpoint_count: number
  entry_count: number
  regular_file_count: number
  directory_count: number
  symlink_count: number
  regular_file_bytes: number
  digest: string
}

export type Phase1IgnoredStateTransition = {
  policy: Phase1IgnoredOutputPolicy
  policy_digest: string
  before: Phase1IgnoredStateBinding
  after: Phase1IgnoredStateBinding
}

export type Phase1ExternalDependencyBinding = {
  algorithm: 'phase1_external_dependency_content_v1'
  repository: 'cc_gateway' | 'sub2api'
  preparation: 'npm_ci_offline_ignore_scripts_and_go_mod_verify_v1'
  node_binary_digest: string
  npm_binary_digest: string
  go_binary_digest: string
  node_dependency_manifests: Array<{
    repository_relative_root: string
    package_json_digest: string
    package_lock_digest: string
    entry_count: number
    content_digest: string
  }>
  go_module_manifests: Array<{
    repository_relative_root: string
    go_mod_digest: string
    go_sum_digest: string
    module_count: number
    module_manifest_digest: string
    module_content_digest: string
    go_mod_verify_digest: string
  }>
  binding_digest: string
}

export type Phase1ExternalDependencySet = {
  cc_gateway: Phase1ExternalDependencyBinding
  sub2api: Phase1ExternalDependencyBinding
}

export type Phase1ExternalDependencyTransition = {
  before: Phase1ExternalDependencySet
  after: Phase1ExternalDependencySet
  ephemeral_build_cache_token: 'command_scoped_empty_mkdtemp_v1'
}

export type Phase1ExternalDependencyReference = {
  results_path: string
  results_digest: string
  chain_digest: string
  final: Phase1ExternalDependencySet
}

const CATALOG_DIGEST = 'sha256:0f4528cc2ca311a587a6dbe2eb5a17d5eb82679adf489e80a7b93285576a4777'
const CATALOG_FIELDS = [
  'schema_version', 'id', 'group', 'owner', 'requirement_ids', 'repository', 'cwd', 'argv', 'env',
  'inherit_env', 'shell', 'expected_exit', 'failure_parser', 'expected_parser_lifecycle',
  'expected_failure_count', 'expected_failure_names', 'expected_failure_families',
  'allowed_failure_prefixes', 'ignored_output_policies', 'timeout_ms', 'max_output_bytes',
] as const

const COMMAND_IDS = [
  'sub-b1-b3', 'sub-formal-pool', 'sub-full-go', 'sub-frontend-h1',
  'sub-frontend-typecheck', 'sub-frontend-build', 'sub-frontend-build-repeat',
  'cc-listener-h1', 'cc-upstream-tls-h1', 'cc-build', 'cc-build-repeat',
  'cc-tests', 'cc-tests-repeat', 'sidecar-tests', 'joint-local-chain',
  'cc-b4-b6-red', 'sidecar-b5-b6-red',
] as const

const IMPLEMENTED_REQUIREMENTS = ['AV-B1-001', 'AV-B2-001', 'AV-B3-001', 'RA-P0-008'] as const
const PRESERVED_REQUIREMENTS = ['AV-B4-001', 'AV-B5-001', 'AV-B6-001'] as const
const HERMETIC_KEYS = {
  CI: '1',
  ...HERMETIC_NETWORK_ENV,
} as const
const CONTRACT_ENV_VALUE = '${SUB2API_CONTRACT_ROOT}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'

const CC_EXCLUDED_PREFIXES = ['docs/superpowers/evidence/phase-1/'] as const
const CC_EXCLUDED_PATHS = [
  'docs/superpowers/registry/oracle-lab-requirements.json',
  'docs/superpowers/registry/oracle-lab-claims.json',
  'docs/superpowers/registry/oracle-lab-current-observations.json',
] as const

const IGNORED_RECORDS = Symbol('phase1IgnoredRecords')
type InternalIgnoredState = Phase1IgnoredStateBinding & { [IGNORED_RECORDS]: readonly Phase1IgnoredRecord[] }

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code })
}

function add(errors: HarnessErrorRecord[], code: string, pathName: string, message: string): void {
  errors.push({ code, path: pathName, message })
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function exact(value: unknown, fields: readonly string[], where: string, errors: HarnessErrorRecord[]): value is Record<string, unknown> {
  const shape = exactKeys(value, fields, where, errors)
  if (!isObject(value)) return false
  for (const field of fields) {
    if (!hasOwn(value, field)) add(errors, 'missing_field', `${where}.${field}`, `${field} must be an own property`)
  }
  return shape
}

function utf8Sort(values: readonly string[]): string[] {
  return [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
}

const EXTERNAL_BINDING_FIELDS = [
  'algorithm', 'repository', 'preparation', 'node_binary_digest', 'npm_binary_digest', 'go_binary_digest',
  'node_dependency_manifests', 'go_module_manifests', 'binding_digest',
] as const
const NODE_DEPENDENCY_FIELDS = [
  'repository_relative_root', 'package_json_digest', 'package_lock_digest', 'entry_count', 'content_digest',
] as const
const GO_DEPENDENCY_FIELDS = [
  'repository_relative_root', 'go_mod_digest', 'go_sum_digest', 'module_count', 'module_manifest_digest',
  'module_content_digest', 'go_mod_verify_digest',
] as const

function externalDependencyBindingErrors(value: unknown, repository: 'cc_gateway' | 'sub2api', where: string, errors: HarnessErrorRecord[]): void {
  if (!exact(value, EXTERNAL_BINDING_FIELDS, where, errors)) return
  if (value.algorithm !== 'phase1_external_dependency_content_v1' || value.repository !== repository
    || value.preparation !== 'npm_ci_offline_ignore_scripts_and_go_mod_verify_v1') {
    add(errors, 'external_dependency_drift', where, 'external dependency authority header drifted')
  }
  for (const field of ['node_binary_digest', 'npm_binary_digest', 'go_binary_digest']) {
    if (!validDigest(value[field])) add(errors, 'external_dependency_drift', `${where}.${field}`, `${field} is not a digest`)
  }
  const expectedNodeRoot = repository === 'cc_gateway' ? '.' : 'frontend'
  const expectedGoRoot = repository === 'cc_gateway' ? 'sidecar/egress-tls-sidecar' : 'backend'
  if (!Array.isArray(value.node_dependency_manifests) || value.node_dependency_manifests.length !== 1) {
    add(errors, 'external_dependency_drift', `${where}.node_dependency_manifests`, 'exactly one reviewed Node dependency root is required')
  } else {
    const manifest = value.node_dependency_manifests[0]
    if (exact(manifest, NODE_DEPENDENCY_FIELDS, `${where}.node_dependency_manifests[0]`, errors)) {
      if (manifest.repository_relative_root !== expectedNodeRoot || !Number.isSafeInteger(manifest.entry_count) || manifest.entry_count < 0
        || !['package_json_digest', 'package_lock_digest', 'content_digest'].every((field) => validDigest(manifest[field]))) {
        add(errors, 'external_dependency_drift', `${where}.node_dependency_manifests[0]`, 'Node dependency manifest drifted')
      }
    }
  }
  if (!Array.isArray(value.go_module_manifests) || value.go_module_manifests.length !== 1) {
    add(errors, 'external_dependency_drift', `${where}.go_module_manifests`, 'exactly one reviewed Go module root is required')
  } else {
    const manifest = value.go_module_manifests[0]
    if (exact(manifest, GO_DEPENDENCY_FIELDS, `${where}.go_module_manifests[0]`, errors)) {
      const digests = ['go_mod_digest', 'go_sum_digest', 'module_manifest_digest', 'module_content_digest', 'go_mod_verify_digest']
      if (manifest.repository_relative_root !== expectedGoRoot || !Number.isSafeInteger(manifest.module_count) || manifest.module_count < 0
        || !digests.every((field) => validDigest(manifest[field]))) {
        add(errors, 'external_dependency_drift', `${where}.go_module_manifests[0]`, 'Go dependency manifest drifted')
      }
    }
  }
  if (!validDigest(value.binding_digest)
    || value.binding_digest !== sha256(canonicalJson(withoutField(value, 'binding_digest')))) {
    add(errors, 'external_dependency_drift', `${where}.binding_digest`, 'external dependency binding digest drifted')
  }
}

export function derivePhase1ExternalDependencyBinding(
  value: Omit<Phase1ExternalDependencyBinding, 'binding_digest'>,
): Phase1ExternalDependencyBinding {
  const unsigned = structuredClone(value) as Record<string, unknown>
  const binding = { ...unsigned, binding_digest: sha256(canonicalJson(unsigned)) }
  const errors: HarnessErrorRecord[] = []
  externalDependencyBindingErrors(binding, value.repository, '$', errors)
  if (errors.length !== 0) fail('external_dependency_drift', JSON.stringify(errors))
  return Object.freeze(binding) as unknown as Phase1ExternalDependencyBinding
}

export function validatePhase1ExternalDependencySet(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exact(value, ['cc_gateway', 'sub2api'], '$', errors)) return result(errors)
  externalDependencyBindingErrors(value.cc_gateway, 'cc_gateway', '$.cc_gateway', errors)
  externalDependencyBindingErrors(value.sub2api, 'sub2api', '$.sub2api', errors)
  return result(errors)
}

function externalDependencyTransitionErrors(value: unknown, where: string, errors: HarnessErrorRecord[]): void {
  if (!exact(value, ['before', 'after', 'ephemeral_build_cache_token'], where, errors)) return
  for (const field of ['before', 'after']) {
    const validation = validatePhase1ExternalDependencySet(value[field])
    for (const error of validation.errors) add(errors, 'external_dependency_drift', `${where}.${field}${error.path.slice(1)}`, error.message)
  }
  if (value.ephemeral_build_cache_token !== 'command_scoped_empty_mkdtemp_v1') {
    add(errors, 'external_dependency_drift', `${where}.ephemeral_build_cache_token`, 'build cache authority token drifted')
  }
}

export function validatePhase1ExternalDependencyChain(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!isObject(value) || !Array.isArray(value.command_results) || !isObject(value.external_dependency_chain)) {
    return result([{ code: 'external_dependency_drift', path: '$', message: 'external dependency transition chain is absent' }])
  }
  const chain = value.external_dependency_chain
  if (!exact(chain, ['initial', 'final', 'transition_count', 'transitions_digest'], '$.external_dependency_chain', errors)) return result(errors)
  const transitions = value.command_results.map((record, index) => {
    const transition = isObject(record) ? record.external_dependency_transition : undefined
    externalDependencyTransitionErrors(transition, `$.command_results[${index}].external_dependency_transition`, errors)
    return transition
  })
  const initialValidation = validatePhase1ExternalDependencySet(chain.initial)
  const finalValidation = validatePhase1ExternalDependencySet(chain.final)
  for (const error of [...initialValidation.errors, ...finalValidation.errors]) add(errors, 'external_dependency_drift', '$.external_dependency_chain', error.message)
  if (chain.transition_count !== 17 || transitions.length !== 17
    || chain.transitions_digest !== sha256(canonicalJson(transitions))) {
    add(errors, 'external_dependency_drift', '$.external_dependency_chain', 'external dependency transition count or digest drifted')
  }
  for (const [index, transition] of transitions.entries()) {
    if (!isObject(transition)) continue
    if (index === 0 && !same(transition.before, chain.initial)) add(errors, 'external_dependency_drift', `$.command_results[${index}]`, 'initial dependency set drifted')
    if (index > 0) {
      const prior = transitions[index - 1]
      if (!isObject(prior) || !same(prior.after, transition.before)) add(errors, 'external_dependency_drift', `$.command_results[${index}]`, 'dependency transitions are not contiguous')
    }
    if (!same(transition.before, transition.after)) add(errors, 'external_dependency_drift', `$.command_results[${index}]`, 'catalog command changed external dependencies')
    if (index === transitions.length - 1 && !same(transition.after, chain.final)) add(errors, 'external_dependency_drift', `$.command_results[${index}]`, 'final dependency set drifted')
  }
  return result(errors)
}

export function derivePhase1ExternalDependencyReference(resultsPath: string, results: unknown): Phase1ExternalDependencyReference {
  const validation = validatePhase1ExternalDependencyChain(results)
  if (!validation.ok || !isObject(results) || !isObject(results.external_dependency_chain) || !validDigest(results.results_digest)) {
    fail('external_dependency_drift', JSON.stringify(validation.errors))
  }
  if (!/^docs\/superpowers\/evidence\/phase-1\/(?:feature|attempt)-[0-9]{4}\/phase-1-(?:feature-)?command-results\.json$/.test(resultsPath)) {
    fail('external_dependency_drift', 'external dependency reference path is invalid')
  }
  return {
    results_path: resultsPath,
    results_digest: results.results_digest,
    chain_digest: String(results.external_dependency_chain.transitions_digest),
    final: structuredClone(results.external_dependency_chain.final) as Phase1ExternalDependencySet,
  }
}

export function validatePhase1ExternalDependencyReference(reference: unknown, results: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const chain = validatePhase1ExternalDependencyChain(results)
  if (!chain.ok || !isObject(results)) add(errors, 'external_dependency_drift', '$.results', 'referenced dependency chain is invalid')
  if (!exact(reference, ['results_path', 'results_digest', 'chain_digest', 'final'], '$.reference', errors)) return result(errors)
  if (typeof reference.results_path !== 'string'
    || !/^docs\/superpowers\/evidence\/phase-1\/(?:feature|attempt)-[0-9]{4}\/phase-1-(?:feature-)?command-results\.json$/.test(reference.results_path)
    || reference.results_digest !== results.results_digest || !isObject(results.external_dependency_chain)
    || reference.chain_digest !== results.external_dependency_chain.transitions_digest
    || !same(reference.final, results.external_dependency_chain.final)) {
    add(errors, 'external_dependency_drift', '$.reference', 'external dependency evidence reference drifted')
  }
  return result(errors)
}

function familyFor(name: string): Phase1RedFailureFamily | undefined {
  if (/^B4(?:\s|$)/.test(name)) return 'B4'
  if (/^B5(?:\s|$)/.test(name)) return 'B5'
  if (/^B6(?:\s|$)/.test(name)) return 'B6'
  if (/^TestPhase0B5[A-Za-z0-9_/]*$/.test(name)) return 'TestPhase0B5'
  if (/^TestPhase0B6[A-Za-z0-9_/]*$/.test(name)) return 'TestPhase0B6'
  return undefined
}

export function canonicalizePhase1FailureEvents(events: readonly string[]): Phase1CanonicalFailures {
  if (!Array.isArray(events) || events.some((name) => typeof name !== 'string' || name.length === 0 || name.length > 512 || /[\r\n\0]/.test(name))) {
    fail('red_runner_output_incomplete', 'failure event names must be bounded safe single-line strings')
  }
  const failureEventNames = utf8Sort(events)
  const uniqueNames = utf8Sort([...new Set(failureEventNames)])
  const families = new Set<Phase1RedFailureFamily>()
  const unclassified: string[] = []
  for (const name of uniqueNames) {
    const family = familyFor(name)
    if (family) families.add(family)
    else unclassified.push(name)
  }
  const familyOrder: Phase1RedFailureFamily[] = ['B4', 'B5', 'B6', 'TestPhase0B5', 'TestPhase0B6']
  return {
    failure_event_count: failureEventNames.length,
    failure_event_names: failureEventNames,
    failure_count: uniqueNames.length,
    failure_names: uniqueNames,
    observed_failure_families: familyOrder.filter((family) => families.has(family)),
    unclassified_failure_names: unclassified,
  }
}

function catalogHeaderValid(candidate: unknown, index: number, errors: HarnessErrorRecord[]): candidate is Phase1Command {
  const where = `$[${index}]`
  if (!exact(candidate, CATALOG_FIELDS, where, errors)) return false
  if (candidate.schema_version !== 1 || candidate.id !== COMMAND_IDS[index]) add(errors, 'catalog_command_drift', where, 'command ID, order, or schema version drifted')
  if (candidate.owner !== 'oracle-lab-phase-1') add(errors, 'catalog_command_drift', `${where}.owner`, 'owner drifted')
  if (candidate.shell !== false || !same(candidate.inherit_env, [])) add(errors, 'unsafe_shell', where, 'shell and inherited environment must be disabled')
  if (candidate.timeout_ms !== 900_000 || candidate.max_output_bytes !== 8 * 1024 * 1024) add(errors, 'invalid_execution_bound', where, 'execution bounds drifted')
  if (!isObject(candidate.env)) add(errors, 'non_hermetic_environment', `${where}.env`, 'environment must be an object')
  else {
    for (const [name, expected] of Object.entries(HERMETIC_KEYS)) {
      if (candidate.env[name] !== expected) add(errors, 'non_hermetic_environment', `${where}.env.${name}`, `${name} drifted`)
    }
  }
  if (!isObject(candidate.ignored_output_policies)
    || !exact(candidate.ignored_output_policies, ['cc_gateway', 'sub2api'], `${where}.ignored_output_policies`, errors)) {
    add(errors, 'invalid_ignored_output_policy', `${where}.ignored_output_policies`, 'both tested repositories require closed policies')
  }
  return true
}

export function validatePhase1CatalogValue(value: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!Array.isArray(value)) return result([{ code: 'invalid_catalog', path: '$', message: 'catalog must be an array' }])
  if (value.length !== 17) add(errors, 'invalid_command_inventory', '$', 'catalog must contain exactly seventeen rows')
  const seen = new Set<string>()
  const greenCoverage = new Set<string>()
  for (const [index, candidate] of value.entries()) {
    if (!catalogHeaderValid(candidate, index, errors)) continue
    if (seen.has(candidate.id)) add(errors, 'duplicate_command_id', `$[${index}].id`, 'command ID is duplicated')
    seen.add(candidate.id)
    if (isObject(candidate.env)) {
      const contractRow = candidate.id === 'cc-tests' || candidate.id === 'cc-tests-repeat'
      if (contractRow) {
        if (candidate.env.SUB2API_FORMAL_POOL_CONTRACT_PATH !== CONTRACT_ENV_VALUE || hasOwn(candidate.env, 'SUB2API_ROOT')) {
          add(errors, 'contract_root_not_authorized', `$[${index}].env`, 'CC full-suite row must bind only the dedicated contract file')
        }
      } else if (hasOwn(candidate.env, 'SUB2API_FORMAL_POOL_CONTRACT_PATH')) {
        add(errors, 'contract_root_not_authorized', `$[${index}].env`, 'dedicated contract variable is forbidden for this row')
      }
      if (candidate.id === 'cc-b4-b6-red') {
        if (candidate.env.SUB2API_ROOT !== '${SUB2API_CONTRACT_ROOT}') add(errors, 'contract_root_not_authorized', `$[${index}].env.SUB2API_ROOT`, 'RED contract root override drifted')
      } else if (hasOwn(candidate.env, 'SUB2API_ROOT')) {
        add(errors, 'contract_root_not_authorized', `$[${index}].env.SUB2API_ROOT`, 'catalog SUB2API_ROOT override is forbidden')
      }
    }
    const green = index < 15
    if (candidate.group !== (green ? 'phase1-green' : 'phase1-red')) add(errors, 'invalid_command_group', `$[${index}].group`, 'command group drifted')
    if (candidate.expected_exit !== (green ? 0 : 'nonzero')) add(errors, 'invalid_expected_exit', `$[${index}].expected_exit`, 'expected exit drifted')
    if (!Array.isArray(candidate.requirement_ids) || candidate.requirement_ids.length === 0 || new Set(candidate.requirement_ids).size !== candidate.requirement_ids.length) {
      add(errors, 'invalid_requirement_binding', `$[${index}].requirement_ids`, 'requirement bindings are invalid')
    } else if (green) {
      for (const requirement of candidate.requirement_ids) {
        if (!IMPLEMENTED_REQUIREMENTS.includes(requirement as never)) add(errors, 'invalid_requirement_binding', `$[${index}].requirement_ids`, 'GREEN row binds a non-Phase-1 requirement')
        greenCoverage.add(requirement)
      }
    } else {
      for (const requirement of candidate.requirement_ids) if (!PRESERVED_REQUIREMENTS.includes(requirement as never)) add(errors, 'invalid_requirement_binding', `$[${index}].requirement_ids`, 'RED row binds a Phase-1 completion claim')
    }
    if (green) {
      if (candidate.failure_parser !== null || candidate.expected_parser_lifecycle !== null || candidate.expected_failure_count !== 0
        || !same(candidate.expected_failure_names, []) || !same(candidate.expected_failure_families, []) || !same(candidate.allowed_failure_prefixes, [])) {
        add(errors, 'invalid_green_red_fields', `$[${index}]`, 'GREEN row contains RED semantics')
      }
    } else {
      if (!['node_test_tap_v1', 'go_test_json_leaf_v1'].includes(String(candidate.failure_parser))) add(errors, 'invalid_failure_parser', `$[${index}].failure_parser`, 'RED parser drifted')
      if (!Array.isArray(candidate.expected_failure_names) || candidate.expected_failure_names.length !== candidate.expected_failure_count
        || new Set(candidate.expected_failure_names).size !== candidate.expected_failure_names.length
        || !same(candidate.expected_failure_names, utf8Sort(candidate.expected_failure_names))) {
        add(errors, 'invalid_failure_inventory', `$[${index}]`, 'failure names/count must be canonical and unique')
      }
      const derived = canonicalizePhase1FailureEvents(candidate.expected_failure_names)
      if (!same(derived.observed_failure_families, candidate.expected_failure_families)) add(errors, 'invalid_failure_family', `$[${index}].expected_failure_families`, 'failure families do not derive from names')
    }
  }
  for (const requirement of IMPLEMENTED_REQUIREMENTS) if (!greenCoverage.has(requirement)) add(errors, 'missing_requirement_evidence', '$', `${requirement} has no GREEN row`)
  if (value.length === 17 && sha256(canonicalJson(value)) !== CATALOG_DIGEST) add(errors, 'catalog_command_drift', '$', 'catalog differs from the reviewed exact inventory')
  return result(errors)
}

export function classifyPhase1Result(input: {
  command: unknown
  exitCode: number
  stdout: string | Buffer
  stderr: string | Buffer
  failureEvents?: readonly string[]
  parserLifecycle?: Phase1ParserLifecycle | null
  timedOut?: boolean
  outputOverflow?: boolean
  unsafeOutputDetected?: boolean
  networkPolicyViolations?: number
}): Phase1Classification {
  const command = input.command as Phase1Command
  const empty = canonicalizePhase1FailureEvents([])
  const infrastructureFailure = input.timedOut === true || input.outputOverflow === true || input.unsafeOutputDetected === true || (input.networkPolicyViolations ?? 0) !== 0
  if (command.group === 'phase1-green') {
    return {
      ...empty,
      status: !infrastructureFailure && input.exitCode === 0 ? 'pass' : 'unexpected_fail',
      failure_parser: null,
      parser_lifecycle: null,
    }
  }
  const canonical = canonicalizePhase1FailureEvents(input.failureEvents ?? [])
  if (input.exitCode === 0) return { ...canonical, status: 'unexpected_pass', failure_parser: command.failure_parser, parser_lifecycle: input.parserLifecycle ?? null }
  const exactInventory = !infrastructureFailure
    && same(canonical.failure_event_names, command.expected_failure_names)
    && canonical.failure_event_count === command.expected_failure_count
    && canonical.failure_count === command.expected_failure_count
    && canonical.failure_event_count === canonical.failure_count
    && same(canonical.failure_names, command.expected_failure_names)
    && same(canonical.observed_failure_families, command.expected_failure_families)
    && canonical.unclassified_failure_names.length === 0
    && same(input.parserLifecycle, command.expected_parser_lifecycle)
    && Buffer.byteLength(input.stderr) === 0
  return {
    ...canonical,
    status: exactInventory ? 'expected_fail' : 'unexpected_fail',
    failure_parser: command.failure_parser,
    parser_lifecycle: input.parserLifecycle ?? null,
  }
}

function text(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString('utf8') : value
}

function requireEmptyStderr(stderr: string | Buffer): void {
  if (Buffer.byteLength(stderr) !== 0) fail('red_runner_output_incomplete', 'RED machine parser requires empty stderr')
}

function parseNodeTap(stdoutInput: string | Buffer, stderr: string | Buffer): Phase1RedParseResult {
  requireEmptyStderr(stderr)
  const lines = text(stdoutInput).split(/\r?\n/)
  while (lines.at(-1) === '') lines.pop()
  if (lines.filter((line) => line === 'TAP version 13').length !== 1 || lines[0] !== 'TAP version 13') {
    fail('red_runner_output_incomplete', 'TAP version marker is missing or duplicated')
  }
  const plans = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^1\.\.\d+$/.test(line))
  if (plans.length !== 1 || plans[0].line !== '1..68') fail('red_runner_output_incomplete', 'TAP terminal plan is missing, duplicated, or wrong')
  const planIndex = plans[0].index
  const points: Array<{ ok: boolean; ordinal: number; name: string }> = []
  for (const [index, line] of lines.entries()) {
    const match = /^(ok|not ok) (\d+) - (.+)$/.exec(line)
    if (!match) continue
    if (index > planIndex) fail('red_runner_output_incomplete', 'TAP point appeared after the terminal plan')
    const name = match[3]
    if (name.length === 0 || name.length > 512 || /[\r\n\0]/.test(name)) fail('red_runner_output_incomplete', 'TAP point name is unsafe')
    points.push({ ok: match[1] === 'ok', ordinal: Number(match[2]), name })
  }
  if (points.length !== 68 || points.some((point, index) => point.ordinal !== index + 1)) fail('red_runner_output_incomplete', 'TAP ordinals are incomplete or noncontiguous')
  const summary = new Map<string, number>()
  for (const line of lines.slice(planIndex + 1)) {
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line)
    if (match) {
      if (summary.has(match[1])) fail('red_runner_output_incomplete', 'TAP summary is duplicated')
      summary.set(match[1], Number(match[2]))
    }
  }
  const expected = { tests: 68, suites: 0, pass: 7, fail: 61, cancelled: 0, skipped: 0, todo: 0 }
  if (Object.entries(expected).some(([name, count]) => summary.get(name) !== count)) fail('red_runner_output_incomplete', 'TAP terminal summary is incomplete or inconsistent')
  const passCount = points.filter((point) => point.ok).length
  const failures = points.filter((point) => !point.ok)
  if (passCount !== 7 || failures.length !== 61 || failures.some((point) => !/^B[456](?:\s|$)/.test(point.name))) {
    fail('red_runner_output_incomplete', 'TAP failed leaf inventory is incomplete or contains an unrelated point')
  }
  const lifecycle: Phase1NodeTapLifecycle = {
    parser: 'node_test_tap_v1', tap_version_count: 1, terminal_plan_count: 1,
    declared_test_count: 68, observed_test_count: 68, pass_count: 7, fail_count: 61,
    cancelled_count: 0, skipped_count: 0, todo_count: 0, unexplained_stderr_line_count: 0,
  }
  return { failure_events: failures.map((point) => point.name), lifecycle }
}

type GoEvent = { Action: string; Package?: string; Test?: string; Output?: string }

function parseGoJson(stdoutInput: string | Buffer, stderr: string | Buffer): Phase1RedParseResult {
  requireEmptyStderr(stderr)
  const lines = text(stdoutInput).split(/\r?\n/).filter((line) => line.length > 0)
  const events: GoEvent[] = []
  for (const line of lines) {
    let event: unknown
    try { event = JSON.parse(line) } catch { return fail('red_runner_output_incomplete', 'Go runner emitted malformed JSON') }
    if (!isObject(event) || typeof event.Action !== 'string' || typeof event.Package !== 'string'
      || !['start', 'run', 'pass', 'fail', 'skip', 'output'].includes(event.Action)) {
      fail('red_runner_output_incomplete', 'Go runner event is malformed or has an unknown action')
    }
    if (event.Action === 'output' && (typeof event.Test !== 'string' || typeof event.Output !== 'string')) {
      fail('red_runner_output_incomplete', 'Go runner package output or unbound diagnostic is forbidden')
    }
    events.push(event as GoEvent)
  }
  const expectedPackages = [
    { suffix: 'internal/control' as const, runs: 4, passes: 2, failures: 2 },
    { suffix: 'internal/server' as const, runs: 64, passes: 11, failures: 53 },
  ]
  const failureEvents: string[] = []
  const packages: Phase1GoTestLifecycle['packages'] = []
  for (const expected of expectedPackages) {
    const names = [...new Set(events.map((event) => event.Package).filter((pkg): pkg is string => typeof pkg === 'string' && pkg.endsWith(expected.suffix)))]
    if (names.length !== 1) fail('red_runner_output_incomplete', 'Go runner package is missing or duplicated')
    const packageName = names[0]
    const packageEvents = events.filter((event) => event.Package === packageName)
    const other = events.filter((event) => event.Package !== packageName && !expectedPackages.some((entry) => event.Package?.endsWith(entry.suffix)))
    if (other.length > 0) fail('red_runner_output_incomplete', 'Go runner emitted an unexpected package')
    if (packageEvents[0]?.Action !== 'start' || packageEvents.filter((event) => event.Action === 'start' && !event.Test).length !== 1) fail('red_runner_output_incomplete', 'Go package start lifecycle is invalid')
    const packageTerminals = packageEvents.map((event, index) => ({ event, index })).filter(({ event }) => event.Action === 'fail' && !event.Test)
    if (packageTerminals.length !== 1 || packageTerminals[0].index !== packageEvents.length - 1) fail('red_runner_output_incomplete', 'Go package terminal lifecycle is invalid')
    const states = new Map<string, { run: number; terminal?: 'pass' | 'fail' | 'skip'; terminalIndex?: number; diagnostics: string[] }>()
    for (const [index, event] of packageEvents.entries()) {
      if (!event.Test) {
        if (!((event.Action === 'start' && index === 0) || (event.Action === 'fail' && index === packageEvents.length - 1))) {
          fail('red_runner_output_incomplete', 'Go package event is not part of the closed lifecycle')
        }
        continue
      }
      const state = states.get(event.Test) ?? { run: 0, diagnostics: [] }
      if (event.Action === 'run') {
        if (state.run !== 0 || state.terminal) fail('red_runner_output_incomplete', 'Go test run lifecycle is duplicated or late')
        state.run = 1
      } else if (['pass', 'fail', 'skip'].includes(event.Action)) {
        if (state.run !== 1 || state.terminal) fail('red_runner_output_incomplete', 'Go test terminal lifecycle is missing, duplicated, or early')
        state.terminal = event.Action as 'pass' | 'fail' | 'skip'
        state.terminalIndex = index
      } else if (event.Action === 'output') {
        if (state.terminal) fail('red_runner_output_incomplete', 'Go test output appeared after terminal')
        state.diagnostics.push(event.Output ?? '')
      }
      states.set(event.Test, state)
    }
    if (states.size !== expected.runs || [...states.values()].some((state) => state.run !== 1 || !state.terminal)) fail('red_runner_output_incomplete', 'Go test lifecycle is incomplete')
    const passCount = [...states.values()].filter((state) => state.terminal === 'pass').length
    const failCount = [...states.values()].filter((state) => state.terminal === 'fail').length
    const skipCount = [...states.values()].filter((state) => state.terminal === 'skip').length
    if (passCount !== expected.passes || failCount !== expected.failures || skipCount !== 0) fail('red_runner_output_incomplete', 'Go test terminal counts drifted')
    const failedNames = [...states.entries()].filter(([, state]) => state.terminal === 'fail').map(([name]) => name)
    for (const name of failedNames) {
      const descendants = failedNames.filter((candidate) => candidate.startsWith(`${name}/`))
      if (descendants.length > 0) {
        const diagnostics = states.get(name)?.diagnostics.join('') ?? ''
        if (/(?:^|\s)[A-Za-z0-9_.-]+\.go:\d+/.test(diagnostics)) fail('red_runner_output_incomplete', 'failed Go parent has an independent diagnostic')
        continue
      }
      if (!/^TestPhase0B[56][A-Za-z0-9_/]*$/.test(name)) fail('red_runner_output_incomplete', 'Go runner failed leaf is unrelated')
      failureEvents.push(name)
    }
    packages.push({
      package_suffix: expected.suffix,
      start_count: 1,
      run_test_count: expected.runs,
      terminal_test_count: expected.runs,
      pass_test_count: expected.passes,
      fail_test_count: expected.failures,
      skip_test_count: 0,
      package_fail_terminal_count: 1,
      post_terminal_event_count: 0,
    })
  }
  if (events.some((event) => !expectedPackages.some((expected) => event.Package?.endsWith(expected.suffix)))) fail('red_runner_output_incomplete', 'Go runner emitted an unexpected package')
  const lifecycle: Phase1GoTestLifecycle = {
    parser: 'go_test_json_leaf_v1', packages,
    unexplained_stderr_line_count: 0, malformed_or_unparsed_event_count: 0,
  }
  return { failure_events: failureEvents, lifecycle }
}

export function parsePhase1RedFailureLeaves(input: {
  parser: Phase1FailureParser
  stdout: string | Buffer
  stderr: string | Buffer
}): Phase1RedParseResult {
  return input.parser === 'node_test_tap_v1'
    ? parseNodeTap(input.stdout, input.stderr)
    : parseGoJson(input.stdout, input.stderr)
}

function validIgnoredPath(value: string): boolean {
  return value.length > 0 && !path.posix.isAbsolute(value) && !value.includes('\\')
    && path.posix.normalize(value) === value && value.split('/').every((component) => component !== '' && component !== '.' && component !== '..')
}

function normalizedIgnoredRecords(recordsInput: readonly Phase1IgnoredRecord[]): Phase1IgnoredRecord[] {
  const records = structuredClone([...recordsInput]).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
  const paths = new Set<string>()
  for (const record of records) {
    if (!validIgnoredPath(record.path) || paths.has(record.path) || !['regular', 'directory', 'symlink'].includes(record.type)
      || !Number.isInteger(record.mode) || record.mode < 0 || record.mode > 0o7777) fail('ignored_state_inventory_invalid', 'ignored state record is invalid')
    paths.add(record.path)
    if (record.type === 'regular' && (!Number.isSafeInteger(record.size) || Number(record.size) < 0 || !DIGEST_RE.test(record.content_digest ?? ''))) fail('ignored_state_inventory_invalid', 'ignored regular file binding is invalid')
    if (record.type === 'symlink' && (!record.symlink_target || record.symlink_target.length === 0)) fail('ignored_state_inventory_invalid', 'ignored symlink target is absent')
  }
  return records
}

export function validatePhase1IgnoredSymlinkClosure(recordsInput: readonly Pick<Phase1IgnoredRecord, 'path' | 'type' | 'symlink_target'>[]): void {
  const records = new Map(recordsInput.map((record) => [record.path, record]))
  for (const record of recordsInput) {
    if (record.type !== 'symlink') continue
    const endpoint = record.path.split('/')[0]
    const visited = new Set<string>([record.path])
    let current = record
    while (current.type === 'symlink') {
      const target = current.symlink_target
      if (!target || path.posix.isAbsolute(target) || target.includes('\\')) fail('ignored_state_symlink_escape', 'ignored symlink target is unsafe')
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(current.path), target))
      if (!validIgnoredPath(resolved) || resolved.split('/')[0] !== endpoint) fail('ignored_state_symlink_escape', 'ignored symlink escaped its endpoint root')
      const next = records.get(resolved)
      if (!next) fail('ignored_state_symlink_escape', 'ignored symlink target is dangling or absent from inventory')
      if (visited.has(resolved)) fail('ignored_state_symlink_escape', 'ignored symlink cycle detected')
      visited.add(resolved)
      current = next
    }
  }
}

export function derivePhase1IgnoredStateBinding(input: {
  repository: 'cc_gateway' | 'sub2api'
  records: readonly Phase1IgnoredRecord[]
}): Phase1IgnoredStateBinding {
  const records = normalizedIgnoredRecords(input.records)
  validatePhase1IgnoredSymlinkClosure(records)
  const regular = records.filter((record) => record.type === 'regular')
  const endpoints = new Set(records.map((record) => record.path.split('/')[0]))
  const binding = {
    algorithm: 'git_exclude_standard_recursive_v1' as const,
    repository: input.repository,
    endpoint_count: endpoints.size,
    entry_count: records.length,
    regular_file_count: regular.length,
    directory_count: records.filter((record) => record.type === 'directory').length,
    symlink_count: records.filter((record) => record.type === 'symlink').length,
    regular_file_bytes: regular.reduce((total, record) => total + (record.size ?? 0), 0),
    digest: sha256(canonicalJson(records.map(({ symlink_target, ...record }) => ({
      ...record,
      symlink_target_digest: record.type === 'symlink' ? sha256(symlink_target ?? '') : record.symlink_target_digest,
    })))),
  } as InternalIgnoredState
  Object.defineProperty(binding, IGNORED_RECORDS, { enumerable: false, value: Object.freeze(records) })
  return Object.freeze(binding)
}

function internalIgnored(value: Phase1IgnoredStateBinding): InternalIgnoredState {
  const internal = value as InternalIgnoredState
  if (!internal[IGNORED_RECORDS]) fail('ignored_state_inventory_invalid', 'ignored-state comparison requires the complete in-memory inventory')
  return internal
}

function recordMap(records: readonly Phase1IgnoredRecord[]): Map<string, Phase1IgnoredRecord> {
  return new Map(records.map((record) => [record.path, record]))
}

function allowedIgnoredPath(policy: Phase1IgnoredOutputPolicy, relative: string): boolean {
  if (policy === 'cc_build_dist_v1') return relative === 'dist' || relative.startsWith('dist/')
  if (policy === 'sub_frontend_build_v1') return relative === 'backend/internal/web/dist' || relative.startsWith('backend/internal/web/dist/')
    || relative === 'frontend/tsconfig.tsbuildinfo' || relative === 'frontend/tsconfig.node.tsbuildinfo'
  if (policy === 'sub2api_joint_safe_deliverable_v1') return /^docs\/anti-ban\/captures\/real-baseline\/\d{4}-\d{2}-\d{2}-sub2api-cc-gateway-joint-local-capture\/(?:safe-deliverable(?:\/(?:README\.md|joint_local_capture_summary\.redacted\.json))?)?$/.test(relative)
  return false
}

function recordsEqual(left: Phase1IgnoredRecord | undefined, right: Phase1IgnoredRecord | undefined): boolean {
  return same(left, right)
}

export function comparePhase1IgnoredState(input: {
  repository: 'cc_gateway' | 'sub2api'
  before: Phase1IgnoredStateBinding
  after: Phase1IgnoredStateBinding
  policy: Phase1IgnoredOutputPolicy
}): Phase1IgnoredStateTransition {
  if (input.before.repository !== input.repository || input.after.repository !== input.repository) fail('ignored_state_drift', 'ignored-state repository binding drifted')
  const before = internalIgnored(input.before)
  const after = internalIgnored(input.after)
  const beforeRecords = recordMap(before[IGNORED_RECORDS])
  const afterRecords = recordMap(after[IGNORED_RECORDS])
  const changed = new Set([...beforeRecords.keys(), ...afterRecords.keys()].filter((name) => !recordsEqual(beforeRecords.get(name), afterRecords.get(name))))
  if (input.policy === 'none' && changed.size !== 0) fail('ignored_state_drift', 'ignored state changed under policy none')
  for (const relative of changed) {
    if (!allowedIgnoredPath(input.policy, relative)) fail('ignored_state_drift', 'ignored state changed outside the closed output surface')
    const record = afterRecords.get(relative)
    if (record && (record.type === 'symlink' || (record.type === 'regular' && record.mode !== 0o644) || (record.type === 'directory' && record.mode !== 0o755))) {
      fail('ignored_state_drift', 'ignored output has an unsafe type or mode')
    }
  }
  if (input.policy === 'cc_build_dist_v1' && input.repository !== 'cc_gateway') fail('ignored_state_drift', 'CC build policy is assigned to the wrong repository')
  if (['sub_frontend_build_v1', 'sub2api_joint_safe_deliverable_v1'].includes(input.policy) && input.repository !== 'sub2api') fail('ignored_state_drift', 'Sub2API output policy is assigned to the wrong repository')
  return {
    policy: input.policy,
    policy_digest: sha256(canonicalJson({ policy: input.policy })),
    before: input.before,
    after: input.after,
  }
}

function decodeUtf8Path(bytes: Buffer): string {
  let value: string
  try { value = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return fail('implementation_tree_stream_invalid', 'tree path is not valid UTF-8') }
  if (!Buffer.from(value).equals(bytes) || value.length === 0 || value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)
    || path.posix.normalize(value) !== value || value.split('/').some((component) => component === '' || component === '.' || component === '..')) {
    fail('implementation_tree_stream_invalid', 'tree path is not a normalized repository-relative UTF-8 path')
  }
  return value
}

export function parsePhase1TrackedTree(raw: Buffer): Phase1TrackedTreeEntry[] {
  if (!Buffer.isBuffer(raw)) fail('implementation_tree_stream_invalid', 'tree stream must be bytes')
  if (raw.length === 0) return []
  if (raw.at(-1) !== 0) fail('implementation_tree_stream_invalid', 'tree stream lacks terminal NUL')
  const output: Phase1TrackedTreeEntry[] = []
  const paths = new Set<string>()
  let start = 0
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] !== 0) continue
    if (index === start) fail('implementation_tree_stream_invalid', 'tree stream has an empty record')
    const record = raw.subarray(start, index)
    start = index + 1
    const tab = record.indexOf(0x09)
    if (tab < 0 || record.indexOf(0x09, tab + 1) >= 0) fail('implementation_tree_stream_invalid', 'tree record has invalid field separators')
    const header = record.subarray(0, tab).toString('ascii').split(' ')
    if (header.length !== 3) fail('implementation_tree_stream_invalid', 'tree record header is malformed')
    const [mode, objectType, objectOid] = header
    if (!['100644', '100755', '120000', '160000'].includes(mode)
      || !['blob', 'commit'].includes(objectType)
      || !/^[0-9a-f]{40,64}$/.test(objectOid)
      || (mode === '160000') !== (objectType === 'commit')) {
      fail('implementation_tree_stream_invalid', 'tree record mode, type, or object ID is invalid')
    }
    const relative = decodeUtf8Path(record.subarray(tab + 1))
    if (paths.has(relative)) fail('implementation_tree_stream_invalid', 'tree stream contains a duplicate path')
    paths.add(relative)
    output.push({ mode: mode as Phase1TrackedTreeEntry['mode'], object_type: objectType as Phase1TrackedTreeEntry['object_type'], object_oid: objectOid, path: relative })
  }
  return output.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
}

export function derivePhase1ImplementationTreeBinding(input: {
  repository: 'cc_gateway' | 'sub2api'
  sourceCommit: string
  rawTree: Buffer
  excludedPrefixes?: readonly string[]
  excludedPaths?: readonly string[]
}): Phase1ImplementationTreeBinding {
  if (!COMMIT_RE.test(input.sourceCommit)) fail('context_git_object_invalid', 'source commit is invalid')
  const expectedPrefixes = input.repository === 'cc_gateway' ? [...CC_EXCLUDED_PREFIXES] : []
  const expectedPaths = input.repository === 'cc_gateway' ? [...CC_EXCLUDED_PATHS] : []
  if (input.excludedPrefixes !== undefined && !same(input.excludedPrefixes, expectedPrefixes)) fail('implementation_tree_policy_invalid', 'excluded prefixes differ from the closed policy')
  if (input.excludedPaths !== undefined && !same(input.excludedPaths, expectedPaths)) fail('implementation_tree_policy_invalid', 'excluded paths differ from the closed policy')
  const included = parsePhase1TrackedTree(input.rawTree).filter((entry) =>
    !expectedPrefixes.some((prefix) => entry.path.startsWith(prefix)) && !expectedPaths.includes(entry.path),
  )
  return {
    algorithm: 'git_ls_tree_v1_sha256_canonical_json',
    repository: input.repository,
    source_commit: input.sourceCommit,
    exclusion_policy: 'phase1_evidence_governance_only_v1',
    excluded_prefixes: expectedPrefixes,
    excluded_paths: expectedPaths,
    entry_count: included.length,
    entries_digest: sha256(canonicalJson(included)),
  }
}

const RESULT_FIELDS = [
  'command_id', 'repository', 'repository_commit', 'exit_code', 'status', 'stdout_digest', 'stderr_digest',
  'failure_parser', 'parser_lifecycle', 'failure_event_count', 'failure_event_names', 'failure_count',
  'failure_names', 'observed_failure_families', 'unclassified_failure_names', 'sandbox_policy_digest',
  'network_policy_violations', 'unsafe_output_detected', 'ignored_state_transitions',
  'external_dependency_transition', 'result_digest',
] as const

const RESULTS_FIELDS = [
  'schema_version', 'artifact_kind', 'stage', 'generated_at', 'captured_at', 'catalog', 'baseline',
  'authority', 'roots', 'sub2api_contract_root', 'implementation_trees', 'ignored_state', 'sandbox',
  'external_dependencies', 'disabled_capabilities', 'command_results', 'ignored_state_chain',
  'external_dependency_chain', 'results_digest',
] as const

function withoutField(value: Record<string, unknown>, field: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
}

function validDigest(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_RE.test(value)
}

function recordValidation(candidate: unknown, command: Phase1Command, index: number, errors: HarnessErrorRecord[]): void {
  const where = `$.command_results[${index}]`
  if (!exact(candidate, RESULT_FIELDS, where, errors)) return
  if (candidate.command_id !== command.id || candidate.repository !== command.repository || !COMMIT_RE.test(String(candidate.repository_commit))) add(errors, 'cross_head_result', where, 'result command or repository binding drifted')
  if (!validDigest(candidate.stdout_digest) || !validDigest(candidate.stderr_digest) || !validDigest(candidate.sandbox_policy_digest)) add(errors, 'invalid_digest', where, 'result digest binding is invalid')
  if (!Array.isArray(candidate.failure_event_names) || !Array.isArray(candidate.failure_names) || !Array.isArray(candidate.observed_failure_families) || !Array.isArray(candidate.unclassified_failure_names)) {
    add(errors, 'red_evidence_mismatch', where, 'RED arrays are missing')
    return
  }
  let canonical: Phase1CanonicalFailures
  try { canonical = canonicalizePhase1FailureEvents(candidate.failure_event_names as string[]) }
  catch { add(errors, 'red_evidence_mismatch', where, 'RED event multiset is invalid'); return }
  if (!same(canonical.failure_event_names, candidate.failure_event_names)
    || canonical.failure_event_count !== candidate.failure_event_count
    || canonical.failure_count !== candidate.failure_count
    || !same(canonical.failure_names, candidate.failure_names)
    || !same(canonical.observed_failure_families, candidate.observed_failure_families)
    || !same(canonical.unclassified_failure_names, candidate.unclassified_failure_names)) {
    add(errors, 'red_evidence_mismatch', where, 'persisted RED semantics do not derive from the event multiset')
  }
  const classified = classifyPhase1Result({
    command,
    exitCode: Number(candidate.exit_code),
    stdout: '',
    stderr: '',
    failureEvents: candidate.failure_event_names as string[],
    parserLifecycle: candidate.parser_lifecycle as Phase1ParserLifecycle | null,
    unsafeOutputDetected: candidate.unsafe_output_detected === true,
    networkPolicyViolations: Number(candidate.network_policy_violations),
  })
  if (candidate.status !== classified.status || candidate.failure_parser !== command.failure_parser
    || !same(candidate.parser_lifecycle, command.expected_parser_lifecycle)) add(errors, 'red_evidence_mismatch', where, 'result classification or parser lifecycle drifted')
  if (candidate.status !== (index < 15 ? 'pass' : 'expected_fail')) add(errors, 'unexpected_result_status', `${where}.status`, 'result is not an accepted Phase 1 outcome')
  if (candidate.network_policy_violations !== 0 || candidate.unsafe_output_detected !== false) add(errors, 'sandbox_violation', where, 'result contains a sandbox or leakage violation')
  if (!isObject(candidate.ignored_state_transitions)
    || !exact(candidate.ignored_state_transitions, ['controller', 'cc_gateway', 'sub2api'], `${where}.ignored_state_transitions`, errors)) {
    add(errors, 'ignored_state_drift', `${where}.ignored_state_transitions`, 'ignored-state transition set is incomplete')
  } else {
    for (const repository of ['cc_gateway', 'sub2api'] as const) {
      const transition = candidate.ignored_state_transitions[repository]
      if (!isObject(transition) || transition.policy !== command.ignored_output_policies[repository]) add(errors, 'ignored_state_drift', `${where}.ignored_state_transitions.${repository}`, 'ignored-state command policy drifted')
    }
  }
  externalDependencyTransitionErrors(candidate.external_dependency_transition, `${where}.external_dependency_transition`, errors)
  if (!validDigest(candidate.result_digest) || candidate.result_digest !== sha256(canonicalJson(withoutField(candidate, 'result_digest')))) add(errors, 'result_digest_mismatch', `${where}.result_digest`, 'result digest does not bind canonical record fields')
}

export function validatePhase1ResultsValue(value: unknown, options: { catalog?: unknown } = {}): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exact(value, RESULTS_FIELDS, '$', errors)) return result(errors)
  const catalog = options.catalog
  const catalogValidation = validatePhase1CatalogValue(catalog)
  if (!catalogValidation.ok) {
    add(errors, 'red_evidence_mismatch', '$.catalog', 'catalog is not the reviewed exact inventory')
    return result(errors)
  }
  if (value.schema_version !== 1 || value.artifact_kind !== 'phase_1_command_results' || !['feature-candidate', 'post-integration'].includes(String(value.stage))) add(errors, 'invalid_results', '$', 'results header is invalid')
  if (!isObject(value.catalog) || value.catalog.path !== 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json' || value.catalog.digest !== CATALOG_DIGEST) add(errors, 'red_evidence_mismatch', '$.catalog', 'results catalog binding drifted')
  if (!Array.isArray(value.command_results) || value.command_results.length !== 17) add(errors, 'invalid_command_inventory', '$.command_results', 'results must contain exactly seventeen records')
  else for (const [index, candidate] of value.command_results.entries()) recordValidation(candidate, (catalog as Phase1Command[])[index], index, errors)
  if (Array.isArray(value.command_results) && isObject(value.ignored_state_chain)) {
    const transitions = value.command_results.map((candidate) => isObject(candidate) ? candidate.ignored_state_transitions : null)
    if (value.ignored_state_chain.transition_count !== 17 || value.ignored_state_chain.transitions_digest !== sha256(canonicalJson(transitions))) add(errors, 'ignored_state_drift', '$.ignored_state_chain', 'ignored-state transition chain digest or count drifted')
    for (let index = 0; index + 1 < value.command_results.length; index += 1) {
      const current = value.command_results[index]
      const next = value.command_results[index + 1]
      if (!isObject(current) || !isObject(next) || !isObject(current.ignored_state_transitions) || !isObject(next.ignored_state_transitions)) continue
      for (const repository of ['controller', 'cc_gateway', 'sub2api']) {
        const left = current.ignored_state_transitions[repository]
        const right = next.ignored_state_transitions[repository]
        if (!isObject(left) || !isObject(right) || !same(left.after, right.before)) add(errors, 'ignored_state_drift', `$.command_results[${index}]`, 'ignored-state transitions are not contiguous')
      }
    }
  } else add(errors, 'ignored_state_drift', '$.ignored_state_chain', 'ignored-state chain is absent')
  const dependencySet = validatePhase1ExternalDependencySet(value.external_dependencies)
  for (const error of dependencySet.errors) add(errors, 'external_dependency_drift', '$.external_dependencies', error.message)
  const dependencyChain = validatePhase1ExternalDependencyChain(value)
  for (const error of dependencyChain.errors) add(errors, 'external_dependency_drift', error.path, error.message)
  if (isObject(value.external_dependency_chain) && !same(value.external_dependencies, value.external_dependency_chain.initial)) {
    add(errors, 'external_dependency_drift', '$.external_dependencies', 'baseline dependency set differs from chain initial state')
  }
  if (!validDigest(value.results_digest) || value.results_digest !== sha256(canonicalJson(withoutField(value, 'results_digest')))) add(errors, 'results_digest_mismatch', '$.results_digest', 'results digest does not bind canonical artifact fields')
  return result(errors)
}

export function validatePhase1LoadedResultsAuthority(input: {
  stage: 'feature-candidate' | 'post-integration'
  catalog: unknown
  baseline: unknown
  results: unknown
  authority: unknown
  roots: unknown
  contract: unknown
  implementationTrees: unknown
  ignoredFinal: unknown
  externalDependencies: unknown
  controllerEqualsCC: boolean
  outputPaths: { baseline: string; results: string; integrationEntry?: string }
  liveStatuses: { controller: string[]; cc_gateway: string[]; sub2api: string[] }
}): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const resultsValidation = validatePhase1ResultsValue(input.results, { catalog: input.catalog })
  for (const error of resultsValidation.errors) add(errors, error.code, error.path, error.message)
  if (!isObject(input.results) || !isObject(input.baseline)) return result(errors)
  const featureOutputs = utf8Sort([`?? ${input.outputPaths.baseline}`, `?? ${input.outputPaths.results}`])
  const postOutputs = input.outputPaths.integrationEntry
    ? utf8Sort([`?? ${input.outputPaths.integrationEntry}`, `?? ${input.outputPaths.baseline}`, `?? ${input.outputPaths.results}`])
    : []
  const controllerStatus = utf8Sort(input.liveStatuses?.controller ?? [])
  const ccStatus = utf8Sort(input.liveStatuses?.cc_gateway ?? [])
  const subStatus = utf8Sort(input.liveStatuses?.sub2api ?? [])
  const statusValid = input.stage === 'feature-candidate'
    ? input.controllerEqualsCC === true && same(controllerStatus, featureOutputs) && same(ccStatus, featureOutputs) && same(subStatus, [])
    : input.controllerEqualsCC === false && same(controllerStatus, postOutputs) && same(ccStatus, []) && same(subStatus, [])
  if (!statusValid) {
    add(errors, 'dirty_repository', '$.live_statuses', 'loaded results live statuses differ from the exact stage output envelope')
  }
  if (input.results.stage !== input.stage || input.baseline.stage !== input.stage
    || input.baseline.artifact_kind !== 'phase_1_exit_baseline'
    || input.baseline.baseline_digest !== sha256(canonicalJson(withoutField(input.baseline, 'baseline_digest')))
    || !isObject(input.results.baseline)
    || input.results.baseline.digest !== sha256(artifactBytes(input.baseline))) {
    add(errors, 'baseline_binding_mismatch', '$.baseline', 'loaded baseline/results relation drifted')
  }
  for (const [field, observed] of [
    ['authority', input.authority], ['roots', input.roots], ['sub2api_contract_root', input.contract],
    ['implementation_trees', input.implementationTrees], ['external_dependencies', input.externalDependencies],
  ] as const) {
    if (!same(input.results[field], observed) || !same(input.baseline[field], observed)) {
      add(errors, field === 'external_dependencies' ? 'external_dependency_drift' : field === 'implementation_trees' ? 'phase1_implementation_drift' : 'context_binding_drift', `$.${field}`, `${field} does not match live authority`)
    }
  }
  if (!isObject(input.results.ignored_state_chain) || !same(input.results.ignored_state_chain.final, input.ignoredFinal)) {
    add(errors, 'ignored_state_drift', '$.ignored_state_chain.final', 'final ignored state does not match live repositories')
  }
  if (!isObject(input.results.external_dependency_chain) || !same(input.results.external_dependency_chain.final, input.externalDependencies)) {
    add(errors, 'external_dependency_drift', '$.external_dependency_chain.final', 'final dependency state does not match live repositories')
  }
  return result(errors)
}

export function validatePhase1CaptureInputs(input: unknown): void {
  if (!isObject(input) || !['feature-candidate', 'post-integration'].includes(String(input.stage))) fail('capture_root_not_authorized', 'capture stage is invalid')
  const controllerStatus = Array.isArray(input.controllerStatus) ? input.controllerStatus : []
  const ccStatus = Array.isArray(input.ccGatewayStatus) ? input.ccGatewayStatus : []
  const subStatus = Array.isArray(input.sub2apiStatus) ? input.sub2apiStatus : []
  if (input.stage === 'feature-candidate') {
    if (input.controllerEqualsCCTestedRoot !== true || controllerStatus.length !== 0 || ccStatus.length !== 0 || subStatus.length !== 0) fail('dirty_repository', 'feature capture requires one clean controller/tested CC root and clean Sub2API')
  } else {
    if (input.controllerEqualsCCTestedRoot !== false || ccStatus.length !== 0 || subStatus.length !== 0
      || typeof input.entryPath !== 'string' || controllerStatus.length !== 1 || controllerStatus[0] !== `?? ${input.entryPath}`
      || !/^docs\/superpowers\/evidence\/phase-1\/attempt-[0-9]{4}\/phase-1-integration-entry\.json$/.test(input.entryPath)) {
      fail('capture_root_not_authorized', 'post-integration controller/tested-root boundary is invalid')
    }
  }
}

type Phase1ContextNode = {
  path: string
  digest: string
  artifact_commit: string
  introduced_once: boolean
  unchanged_after: boolean
  commit_parent_valid: boolean
  commit_delta_valid: boolean
  repository_heads_descend: boolean
  value: Record<string, unknown>
}

const CONTEXT_STAGES = ['implementation_entry', 'implementation', 'feature_capture', 'post_integration'] as const
const IMMUTABLE_CONTEXT_FIELDS = ['plan', 'planning_provenance', 'approval_receipt', 'gate_schemas', 'shared_contract', 'authority_order', 'selected_requirements', 'implementation_entry', 'disabled_capabilities'] as const

export function selectLatestPhase1ExecutionContext(input: {
  contexts: readonly Phase1ContextNode[]
  selectedPath: string
  expectedStage: typeof CONTEXT_STAGES[number]
  now?: string
}): Phase1ContextNode {
  if (!Array.isArray(input.contexts) || input.contexts.length === 0) fail('context_chain_gap', 'execution-context chain is empty')
  const nodes = [...input.contexts].sort((left, right) => Number(left.value.sequence) - Number(right.value.sequence))
  const initial = nodes[0].value
  let previousGenerated = Number.NEGATIVE_INFINITY
  let previousStage = -1
  for (const [index, node] of nodes.entries()) {
    const value = node.value
    const expectedPath = index === 0
      ? 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
      : `docs/superpowers/evidence/phase-1/phase-1-execution-context-${String(index).padStart(4, '0')}.json`
    if (value.schema_version !== 2 || value.sequence !== index || value.artifact_path !== expectedPath || node.path !== expectedPath
      || !DIGEST_RE.test(node.digest) || !COMMIT_RE.test(node.artifact_commit)
      || node.introduced_once !== true || node.unchanged_after !== true || node.commit_parent_valid !== true || node.commit_delta_valid !== true) {
      fail(index === 0 ? 'context_schema_invalid' : 'context_sequence_mismatch', 'execution-context node topology, bytes, or sequence drifted')
    }
    if (index === 0) {
      if (value.context_mode !== 'initial' || value.predecessor !== null) fail('context_schema_invalid', 'initial execution context is invalid')
    } else {
      const predecessor = value.predecessor
      const prior = nodes[index - 1]
      if (value.context_mode !== 'successor' || !isObject(predecessor) || predecessor.path !== prior.path
        || predecessor.digest !== prior.digest || predecessor.artifact_commit !== prior.artifact_commit) fail('predecessor_context_mutated', 'context predecessor tuple drifted')
      for (const field of IMMUTABLE_CONTEXT_FIELDS) if (!same(value[field], initial[field])) fail('context_binding_drift', `${field} drifted across execution-context chain`)
      if (!isObject(value.repositories) || !isObject(initial.repositories)) fail('context_binding_drift', 'repository context binding is absent')
      for (const repository of ['cc_gateway', 'sub2api']) {
        const current = value.repositories[repository]; const baseline = initial.repositories[repository]
        if (!isObject(current) || !isObject(baseline)) fail('context_binding_drift', 'repository context binding is absent')
        for (const field of ['baseline_main_head', 'remote_name', 'remote_url_digest', 'tracking_ref', 'implementation_branch']) if (current[field] !== baseline[field]) fail('context_binding_drift', `${repository}.${field} drifted`)
      }
      if (node.repository_heads_descend !== true) fail('context_head_not_descendant', 'successor authorized heads are not proven descendants')
    }
    const generated = Date.parse(String(value.generated_at)); const expires = Date.parse(String(value.expires_at))
    if (!Number.isFinite(generated) || !Number.isFinite(expires) || !(generated < expires) || expires - generated > 24 * 60 * 60 * 1000) fail('context_window_invalid', 'execution-context window is invalid')
    if (generated < previousGenerated) fail('context_timestamp_regression', 'context generation time regressed')
    previousGenerated = generated
    const stageIndex = CONTEXT_STAGES.indexOf(value.stage as never)
    if (stageIndex < 0 || stageIndex < previousStage) fail('context_stage_regression', 'execution-context stage regressed')
    previousStage = stageIndex
  }
  const latest = nodes.at(-1)!
  if (latest.path !== input.selectedPath) fail('stale_execution_context', 'selected context is not the unique latest chain head')
  if (latest.value.stage !== input.expectedStage) fail('context_stage_regression', 'latest context has the wrong stage')
  const now = Date.parse(input.now ?? new Date().toISOString())
  if (Date.parse(String(latest.value.generated_at)) > now) fail('context_not_yet_valid', 'latest context is not yet valid')
  if (Date.parse(String(latest.value.expires_at)) <= now) fail('stale_execution_context', 'latest context is expired')
  return latest
}

export function validatePhase1FeatureEvidenceCommit(value: unknown): void {
  if (!isObject(value) || !COMMIT_RE.test(String(value.tested_head)) || !COMMIT_RE.test(String(value.candidate_head))
    || !same(value.parents, [value.tested_head]) || value.bytes_match !== true
    || value.sub2api_candidate_head !== value.sub2api_tested_head || !Array.isArray(value.added_paths)
    || value.added_paths.length !== 2 || !value.added_paths.every((entry) => typeof entry === 'string' && /^docs\/superpowers\/evidence\/phase-1\/feature-[0-9]{4}\/phase-1-feature-(?:baseline|command-results)\.json$/.test(entry))) {
    fail('feature_evidence_commit_mismatch', 'feature evidence commit topology or bytes drifted')
  }
}

const FEATURE_REVIEW_FIELDS = [
  'schema_version', 'review_kind', 'generated_at', 'reviewer_identity', 'decision', 'finding_counts',
  'tested_heads', 'candidate_heads', 'implementation_trees', 'feature_baseline', 'feature_results',
  'context', 'plan_review', 'external_dependency_reference', 'review_scope', 'review_digest',
] as const

export function validatePhase1FeatureReviewValue(value: unknown, options: { featureResults?: unknown } = {}): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  if (!exact(value, FEATURE_REVIEW_FIELDS, '$', errors)) return result(errors)
  if (value.schema_version !== 1 || value.review_kind !== 'phase_1_feature_review' || value.decision !== 'approved') add(errors, 'feature_review_mismatch', '$', 'feature review is not an approved closed artifact')
  if (!isObject(value.finding_counts) || value.finding_counts.critical !== 0 || value.finding_counts.important !== 0 || !Number.isInteger(value.finding_counts.minor)) add(errors, 'feature_review_mismatch', '$.finding_counts', 'feature review has blocking findings')
  if (!isObject(value.implementation_trees)) add(errors, 'phase1_implementation_drift', '$.implementation_trees', 'feature review tree bindings are absent')
  else {
    const testedCC = value.implementation_trees.tested_cc_gateway
    const candidateCC = value.implementation_trees.candidate_cc_gateway
    const testedSub = value.implementation_trees.tested_sub2api
    const candidateSub = value.implementation_trees.candidate_sub2api
    if (!isObject(testedCC) || !isObject(candidateCC) || testedCC.entries_digest !== candidateCC.entries_digest
      || !isObject(testedSub) || !isObject(candidateSub) || testedSub.entries_digest !== candidateSub.entries_digest) add(errors, 'phase1_implementation_drift', '$.implementation_trees', 'candidate implementation tree differs from tested tree')
  }
  const requiredScope = ['goal', 'authority', 'ordering', 'sandbox', 'leakage']
  if (!Array.isArray(value.review_scope) || !requiredScope.every((entry) => value.review_scope.includes(entry)) || new Set(value.review_scope).size !== value.review_scope.length) add(errors, 'feature_review_mismatch', '$.review_scope', 'feature review scope is incomplete')
  if (options.featureResults !== undefined) {
    const dependencyReference = validatePhase1ExternalDependencyReference(value.external_dependency_reference, options.featureResults)
    for (const error of dependencyReference.errors) add(errors, 'external_dependency_drift', '$.external_dependency_reference', error.message)
  } else if (!isObject(value.external_dependency_reference)
    || !exact(value.external_dependency_reference, ['results_path', 'results_digest', 'chain_digest', 'final'], '$.external_dependency_reference', errors)
    || !validDigest(value.external_dependency_reference.results_digest)
    || !validDigest(value.external_dependency_reference.chain_digest)
    || !validatePhase1ExternalDependencySet(value.external_dependency_reference.final).ok) {
    add(errors, 'external_dependency_drift', '$.external_dependency_reference', 'feature review dependency reference is invalid')
  }
  if (!validDigest(value.review_digest) || value.review_digest !== sha256(canonicalJson(withoutField(value, 'review_digest')))) add(errors, 'feature_review_mismatch', '$.review_digest', 'feature review digest drifted')
  return result(errors)
}

export function validatePhase1FeatureReviewAttestation(value: unknown): void {
  if (!isObject(value) || !COMMIT_RE.test(String(value.candidate_head)) || !COMMIT_RE.test(String(value.attestation_head))
    || !same(value.parents, [value.candidate_head]) || !Array.isArray(value.added_paths) || value.added_paths.length !== 1
    || !/^docs\/superpowers\/evidence\/phase-1\/feature-[0-9]{4}\/phase-1-feature-review\.json$/.test(String(value.added_paths[0]))
    || value.bytes_match !== true || value.path_unchanged_after !== true) fail('feature_review_attestation_mismatch', 'feature review attestation topology or bytes drifted')
}

export function validatePhase1LoadedFeatureReview(input: {
  catalog: unknown
  featureBaseline: unknown
  featureResults: unknown
  context: unknown
  planReview: unknown
  planReviewSchema: unknown
  executionContextSchema: unknown
  featureReview: unknown
  featureReviewPath: string
  reviewMode: 'uncommitted' | 'committed'
  liveStatuses: { cc_gateway: string[]; sub2api: string[] }
  bindings: {
    featureBaseline: { path: string; digest: string }
    featureResults: { path: string; digest: string }
    context: { path: string; digest: string }
    planReview: { path: string; digest: string }
    planReviewSchema: { path: string; digest: string }
    executionContextSchema: { path: string; digest: string }
    planningEntry: { path: string; digest: string }
    planningContext: { path: string; digest: string }
  }
  evidenceCommit: unknown
}): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const resultsValidation = validatePhase1ResultsValue(input.featureResults, { catalog: input.catalog })
  for (const error of resultsValidation.errors) add(errors, error.code, `$.feature_results${error.path.slice(1)}`, error.message)
  const reviewValidation = validatePhase1FeatureReviewValue(input.featureReview, { featureResults: input.featureResults })
  for (const error of reviewValidation.errors) add(errors, error.code, `$.feature_review${error.path.slice(1)}`, error.message)
  if (!isObject(input.featureResults) || !isObject(input.featureReview) || !isObject(input.featureBaseline)) return result(errors)
  if (!isObject(input.featureResults.baseline) || !same(input.featureResults.baseline, input.bindings.featureBaseline)
    || input.featureBaseline.baseline_digest !== sha256(canonicalJson(withoutField(input.featureBaseline, 'baseline_digest')))) {
    add(errors, 'baseline_binding_mismatch', '$.feature_baseline', 'loaded feature baseline binding drifted')
  }
  for (const [field, binding] of [
    ['feature_baseline', input.bindings.featureBaseline], ['feature_results', input.bindings.featureResults],
    ['context', input.bindings.context], ['plan_review', input.bindings.planReview],
  ] as const) {
    const persisted = input.featureReview[field]
    if (field === 'context') {
      if (!isObject(persisted) || persisted.path !== binding.path || persisted.digest !== binding.digest || !same(persisted, input.featureResults.authority)) {
        add(errors, 'feature_review_mismatch', `$.feature_review.${field}`, `${field} binding drifted`)
      }
    } else if (!same(persisted, binding)) add(errors, 'feature_review_mismatch', `$.feature_review.${field}`, `${field} binding drifted`)
  }
  let planReviewSchemaValid = false
  let executionContextSchemaValid = false
  try {
    planReviewSchemaValid = Boolean(new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(input.planReviewSchema)(input.planReview))
  } catch { /* invalid or uncompilable schemas are not authority */ }
  try {
    executionContextSchemaValid = Boolean(new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(input.executionContextSchema)(input.context))
  } catch { /* invalid or uncompilable schemas are not authority */ }
  if (!planReviewSchemaValid || !isObject(input.planReview) || input.planReview.decision !== 'approved' || !isObject(input.planReview.finding_counts)
    || input.planReview.finding_counts.critical !== 0 || input.planReview.finding_counts.important !== 0) {
    add(errors, 'context_approval_invalid', '$.plan_review', 'loaded plan review is not approved')
  }
  if (!executionContextSchemaValid || !isObject(input.context) || input.context.artifact_path !== input.bindings.context.path) {
    add(errors, 'context_schema_invalid', '$.context', 'loaded execution context does not satisfy its closed schema and binding')
  } else if (!isObject(input.featureResults.authority)
    || input.context.sequence !== input.featureResults.authority.sequence
    || input.context.stage !== input.featureResults.authority.stage
    || input.context.artifact_path !== input.featureResults.authority.path) {
    add(errors, 'context_binding_drift', '$.context', 'loaded execution context path drifted')
  } else {
    const approval = input.context.approval_receipt
    const provenance = input.context.planning_provenance
    if (!isObject(input.planReview) || !same(input.context.plan, input.planReview.plan)
      || !isObject(approval) || !same(approval.artifact, input.bindings.planReview)
      || !isObject(input.context.gate_schemas) || !same(input.context.gate_schemas.plan_review, input.bindings.planReviewSchema)
      || !same(input.context.gate_schemas.execution_context, input.bindings.executionContextSchema)
      || approval.decision !== input.planReview.decision || approval.reviewer_id !== input.planReview.reviewer_id
      || approval.review_round !== input.planReview.review_round
      || approval.reviewed_plan_commit !== (isObject(input.planReview.plan) ? input.planReview.plan.reviewed_commit : undefined)
      || approval.reviewed_plan_digest !== (isObject(input.planReview.plan) ? input.planReview.plan.digest : undefined)
      || approval.critical_findings !== input.planReview.finding_counts?.critical
      || approval.important_findings !== input.planReview.finding_counts?.important
      || !isObject(provenance) || !same(provenance.entry, input.bindings.planningEntry)
      || !same(provenance.context, input.bindings.planningContext)) {
      add(errors, 'context_approval_invalid', '$.context.approval_receipt', 'context approval, plan, or planning provenance differs from the loaded review')
    }
  }
  const expectedCCStatus = input.reviewMode === 'uncommitted' ? [`?? ${input.featureReviewPath}`] : []
  if (!isObject(input.liveStatuses)
    || !same(input.liveStatuses.cc_gateway, expectedCCStatus)
    || !same(input.liveStatuses.sub2api, [])) {
    add(errors, 'dirty_repository', '$.live_statuses', 'feature review requires only the exact uncommitted review artifact and a clean Sub2API root')
  }
  if (!isObject(input.featureReview.tested_heads) || !isObject(input.featureResults.roots)
    || !isObject(input.featureResults.roots.cc_gateway) || !isObject(input.featureResults.roots.sub2api)
    || input.featureReview.tested_heads.cc_gateway !== input.featureResults.roots.cc_gateway.head
    || input.featureReview.tested_heads.sub2api !== input.featureResults.roots.sub2api.head) {
    add(errors, 'feature_review_mismatch', '$.feature_review.tested_heads', 'reviewed tested heads differ from loaded results')
  }
  try { validatePhase1FeatureEvidenceCommit(input.evidenceCommit) }
  catch (error) { add(errors, String((error as Error & { code?: string }).code ?? 'feature_evidence_commit_mismatch'), '$.evidence_commit', (error as Error).message) }
  if (!isObject(input.evidenceCommit) || !Array.isArray(input.evidenceCommit.added_paths)
    || !same(utf8Sort(input.evidenceCommit.added_paths as string[]), utf8Sort([input.bindings.featureBaseline.path, input.bindings.featureResults.path]))) {
    add(errors, 'feature_evidence_commit_mismatch', '$.evidence_commit.added_paths', 'evidence commit paths differ from the loaded baseline/results')
  }
  return result(errors)
}

export function validatePhase1MergeTopology(value: unknown): void {
  if (!isObject(value)) fail('merge_commit_parent_mismatch', 'merge topology is absent')
  for (const repository of ['cc', 'sub2api']) {
    const item = value[repository]
    if (!isObject(item) || !COMMIT_RE.test(String(item.merge)) || !COMMIT_RE.test(String(item.pre_merge_main)) || !COMMIT_RE.test(String(item.candidate))
      || !same(item.parents, [item.pre_merge_main, item.candidate]) || item.ancestor_of_remote !== true) fail('merge_commit_parent_mismatch', `${repository} merge topology drifted`)
  }
}

function attemptNumber(value: string): number {
  const match = /^attempt-([0-9]{4})$/.exec(value)
  if (!match || match[1] === '0000') fail('attempt_chain_invalid', 'attempt ID is invalid')
  return Number(match[1])
}

export function validatePhase1AttemptChain(value: unknown): void {
  if (!isObject(value) || !Array.isArray(value.committed) || typeof value.requested !== 'string') fail('attempt_chain_invalid', 'attempt chain is malformed')
  const requested = attemptNumber(value.requested)
  if (requested !== value.committed.length + 1) fail('attempt_chain_invalid', 'requested attempt is not the next contiguous node')
  for (const [index, receipt] of value.committed.entries()) {
    if (!isObject(receipt) || receipt.attempt_id !== `attempt-${String(index + 1).padStart(4, '0')}`
      || receipt.introduced_once !== true || receipt.present_unchanged !== true || receipt.ancestor !== true || receipt.child_topology_valid !== true
      || !DIGEST_RE.test(String(receipt.digest)) || !COMMIT_RE.test(String(receipt.receipt_commit))) fail('attempt_chain_invalid', 'committed receipt history is not immutable and contiguous')
  }
  if (requested === 1) {
    if (value.predecessor !== null) fail('attempt_chain_invalid', 'initial attempt must not have a predecessor')
    return
  }
  const prior = value.committed.at(-1)
  const predecessor = value.predecessor
  if (!isObject(prior) || !isObject(predecessor) || predecessor.attempt_id !== prior.attempt_id || predecessor.receipt_commit !== prior.receipt_commit
    || !isObject(predecessor.receipt) || predecessor.receipt.path !== prior.path || predecessor.receipt.digest !== prior.digest) fail('attempt_chain_invalid', 'attempt predecessor tuple drifted')
}

type ReceiptHistoryNode = {
  attempt_id: string
  path: string
  digest: string
  receipt_commit: string
  artifact_commit: string
  bytes: Buffer
  value: Record<string, unknown>
}

function treeBlob(root: string, commitValue: string, relative: string, cache: Map<string, string | null>): string | null {
  const key = `${commitValue}\0${relative}`
  if (cache.has(key)) return cache.get(key)!
  const output = runReviewedGit(root, ['ls-tree', '-z', commitValue, '--', relative]).stdout
  if (output.length === 0) { cache.set(key, null); return null }
  if (output.at(-1) !== 0) fail('attempt_chain_invalid', 'receipt tree record is malformed')
  const record = output.subarray(0, -1)
  const tab = record.indexOf(0x09); const header = tab >= 0 ? record.subarray(0, tab).toString('ascii').split(' ') : []
  if (header.length !== 3 || header[0] !== '100644' || header[1] !== 'blob' || !/^[0-9a-f]{40,64}$/.test(header[2])
    || record.subarray(tab + 1).toString('utf8') !== relative) fail('attempt_chain_invalid', 'receipt tree entry is invalid')
  cache.set(key, header[2])
  return header[2]
}

export function inspectPhase1ReceiptHistory(rootInput: string, headInput = 'HEAD'): ReceiptHistoryNode[] {
  const root = realpathSync(rootInput)
  const head = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', `${headInput}^{commit}`])
  const historyNames = runReviewedGit(root, ['log', '--format=', '--name-only', head, '--', 'docs/superpowers/evidence/phase-1']).stdout.toString('utf8').split(/\r?\n/)
  const receiptPattern = /^docs\/superpowers\/evidence\/phase-1\/(attempt-([0-9]{4}))\/phase-1-integration-receipt\.json$/
  const paths = [...new Set(historyNames.filter((name) => receiptPattern.test(name)))].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
  const graph = reviewedGitText(root, ['rev-list', '--parents', head]).split(/\r?\n/).filter(Boolean).map((line) => line.split(' '))
  const blobCache = new Map<string, string | null>()
  const nodes: ReceiptHistoryNode[] = []
  for (const relative of paths) {
    const match = receiptPattern.exec(relative)!
    const introductions: Array<{ commit: string; blob: string }> = []
    let invalidHistory = false
    for (const [commitValue, ...parents] of graph) {
      const current = treeBlob(root, commitValue, relative, blobCache)
      const prior = parents.map((parent) => treeBlob(root, parent, relative, blobCache))
      if (current === null && prior.some((blob) => blob !== null)) invalidHistory = true
      if (current !== null) {
        const existingParents = prior.filter((blob): blob is string => blob !== null)
        if (existingParents.some((blob) => blob !== current)) invalidHistory = true
        if (!prior.some((blob) => blob === current)) introductions.push({ commit: commitValue, blob: current })
      }
    }
    const tipBlob = treeBlob(root, head, relative, blobCache)
    if (invalidHistory || introductions.length !== 1 || tipBlob === null || tipBlob !== introductions[0].blob) fail('attempt_chain_invalid', 'receipt history contains deletion, replacement, re-addition, or duplicate introduction')
    const receiptCommit = introductions[0].commit
    const bytes = runReviewedGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${receiptCommit}:${relative}`]).stdout
    let value: Record<string, unknown>
    try { value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown> } catch { return fail('attempt_chain_invalid', 'receipt bytes are malformed') }
    if (!isObject(value.attempt) || value.attempt.attempt_id !== match[1] || !COMMIT_RE.test(String(value.artifact_commit))) fail('attempt_chain_invalid', 'receipt attempt/artifact binding drifted')
    const parents = reviewedGitText(root, ['show', '-s', '--format=%P', receiptCommit]).split(' ').filter(Boolean)
    const delta = runReviewedGit(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', receiptCommit]).stdout.toString('utf8').split('\0').filter(Boolean)
    if (!same(parents, [value.artifact_commit]) || !same(delta, ['A', relative])) fail('attempt_chain_invalid', 'receipt introduction is not the exact one-path child of its artifact commit')
    nodes.push({ attempt_id: match[1], path: relative, digest: sha256(bytes), receipt_commit: receiptCommit, artifact_commit: String(value.artifact_commit), bytes, value })
  }
  nodes.sort((left, right) => attemptNumber(left.attempt_id) - attemptNumber(right.attempt_id))
  for (const [index, node] of nodes.entries()) if (node.attempt_id !== `attempt-${String(index + 1).padStart(4, '0')}`) fail('attempt_chain_invalid', 'receipt attempt IDs are not contiguous from 0001')
  return nodes
}

export function authorizePhase1Retry(value: unknown): Record<string, unknown> {
  if (!isObject(value) || !['evidence_only_pre_merge', 'evidence_only_post_merge'].includes(String(value.kind))) {
    const code = isObject(value) && typeof value.error_code === 'string' ? value.error_code : isObject(value) && value.kind === 'implementation_tree_drift' ? 'phase1_implementation_drift' : 'attempt_chain_invalid'
    fail(code, 'retry class does not authorize a successor attempt')
  }
  const current = attemptNumber(String(value.latest_attempt_id))
  const runMatch = /^run-([0-9]{4})$/.exec(String(value.latest_draft_run_id))
  if (!runMatch) fail('attempt_chain_invalid', 'draft run ID is invalid')
  const preMerge = value.kind === 'evidence_only_pre_merge'
  const nextAttempt = `attempt-${String(current + 1).padStart(4, '0')}`
  const nextRun = preMerge ? `run-${String(Number(runMatch[1]) + 1).padStart(4, '0')}` : 'run-0001'
  const rootDigest = String(value.next_root_identity_digest)
  if (!DIGEST_RE.test(rootDigest) || rootDigest === value.root_identity_digest) fail('attempt_chain_invalid', 'retry requires a fresh root identity')
  return {
    attempt_id: nextAttempt,
    predecessor: value.predecessor ?? null,
    draft_run_id: nextRun,
    preserve_paths: value.immutable_paths ?? [],
    require_new_roots: true,
    root_identity_digest: rootDigest,
  }
}

export function verifyPhase1FinalRemote(value: unknown): { decision: 'ready' | 'superseded' } {
  if (!isObject(value) || !['ready', 'superseded'].includes(String(value.decision))) fail('attempt_chain_invalid', 'final remote decision is invalid')
  if (value.safe !== true || value.ignored_state_stable !== true) fail(String(value.error_code ?? 'phase1_implementation_drift'), 'final remote verification failed closed')
  return { decision: value.decision as 'ready' | 'superseded' }
}

type DownstreamSource = { catalog: unknown; results: unknown }

function validatedDownstreamSource(source: unknown): asserts source is DownstreamSource {
  if (!isObject(source)) fail('red_evidence_mismatch', 'downstream source is absent')
  const validation = validatePhase1ResultsValue(source.results, { catalog: source.catalog })
  if (!validation.ok) fail('red_evidence_mismatch', JSON.stringify(validation.errors))
}

function buildDownstream(kind: 'integration_entry' | 'handoff' | 'integration_receipt', options: unknown): Record<string, unknown> {
  if (!isObject(options)) fail('red_evidence_mismatch', 'downstream builder inputs are absent')
  validatedDownstreamSource(options.source)
  const source = options.source as DownstreamSource
  const payload = isObject(options.payload) ? options.payload : {}
  const sourceResults = source.results as Record<string, unknown>
  const baselinePath = isObject(sourceResults.baseline) ? String(sourceResults.baseline.path) : ''
  const resultsPath = baselinePath.includes('feature-baseline')
    ? baselinePath.replace('feature-baseline', 'feature-command-results')
    : baselinePath.replace('exit-baseline', 'command-results')
  const base = {
    schema_version: 1,
    artifact_kind: `phase_1_${kind}`,
    source_results_digest: (source.results as Record<string, unknown>).results_digest,
    catalog_digest: CATALOG_DIGEST,
    external_dependency_reference: derivePhase1ExternalDependencyReference(resultsPath, source.results),
    payload,
  }
  return { ...base, artifact_digest: sha256(canonicalJson(base)) }
}

function validateDownstream(value: unknown, kind: string, source: unknown): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  try { validatedDownstreamSource(source) } catch (error) { add(errors, 'red_evidence_mismatch', '$.source', (error as Error).message); return result(errors) }
  if (!isObject(value) || value.artifact_kind !== `phase_1_${kind}` || value.source_results_digest !== (source as DownstreamSource).results || !validDigest(value.artifact_digest)) {
    if (!isObject(value) || value.source_results_digest !== ((source as DownstreamSource).results as Record<string, unknown>).results_digest) add(errors, 'red_evidence_mismatch', '$', 'downstream source binding drifted')
  }
  if (isObject(value) && value.artifact_digest !== sha256(canonicalJson(withoutField(value, 'artifact_digest')))) add(errors, 'artifact_digest_mismatch', '$.artifact_digest', 'downstream digest drifted')
  if (isObject(value)) {
    const dependencyReference = validatePhase1ExternalDependencyReference(value.external_dependency_reference, (source as DownstreamSource).results)
    for (const error of dependencyReference.errors) add(errors, 'external_dependency_drift', '$.external_dependency_reference', error.message)
  }
  return result(errors)
}

export const PHASE2_ENTRY_CONDITIONS = [
  'phase_1_integration_receipt_valid',
  'current_remote_mains_match_or_descend_from_receipted_integration_chain',
  'b1_b3_listener_and_upstream_tls_green_on_integrated_heads',
  'b4_b6_expected_red_preserved_for_phase_4',
  'shared_contract_unchanged_or_reviewed_version_bump',
  'production_and_real_canary_disabled',
  'fresh_phase_2_baseline_context_and_detailed_plan',
  'independent_phase_2_plan_approval',
] as const

type ActualIntegrationEntryInput = {
  actual: true
  controllerRoot: string
  attemptId: string
  previousAttempt: { id: string; receipt: string; digest: string; commit: string }
  catalogPath: string
  ccGatewayRoot: string
  sub2apiRoot: string
  sub2apiContractRoot: string
  executionContextPath: string
  planReviewPath: string
  featureResultsPath: string
  featureReviewPath: string
  reviewedCCCandidateHead: string
  reviewedSub2APICandidateHead: string
  ccReviewAttestationHead: string
  ccPreMergeMainHead: string
  sub2apiPreMergeMainHead: string
  ccMergeCommit: string
  sub2apiMergeCommit: string
  ccRemote: string
  ccRemoteRef: string
  ccOriginDigest: string
  sub2apiRemote: string
  sub2apiRemoteRef: string
  sub2apiOriginDigest: string
  now?: string
}

function treeAt(root: string, repository: 'cc_gateway' | 'sub2api', commitValue: string): Phase1ImplementationTreeBinding {
  const raw = runReviewedGit(root, ['ls-tree', '-r', '-z', '--full-tree', commitValue]).stdout
  return derivePhase1ImplementationTreeBinding({ repository, sourceCommit: commitValue, rawTree: raw })
}

function mergeParents(root: string, commitValue: string): string[] {
  const fields = reviewedGitText(root, ['show', '-s', '--format=%P', commitValue]).split(' ').filter(Boolean)
  if (fields.length !== 2) fail('merge_commit_parent_mismatch', 'merge commit does not have exactly two parents')
  return fields
}

function commitDelta(root: string, commitValue: string): Array<{ status: string; path: string }> {
  const fields = runReviewedGit(root, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', commitValue]).stdout
    .toString('utf8').split('\0').filter(Boolean)
  if (fields.length % 2 !== 0) fail('feature_evidence_commit_mismatch', 'commit delta is malformed')
  const entries: Array<{ status: string; path: string }> = []
  for (let index = 0; index < fields.length; index += 2) entries.push({ status: fields[index], path: fields[index + 1] })
  return entries.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)))
}

function committedArtifactBytes(root: string, commitValue: string, artifactPath: string): Buffer {
  return runReviewedGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${commitValue}:${artifactPath}`]).stdout
}

function sameImplementationTreeContent(left: unknown, right: unknown): boolean {
  if (!isObject(left) || !isObject(right)) return false
  return same(withoutField(left, 'source_commit'), withoutField(right, 'source_commit'))
}

function remoteObservation(root: string, remote: string, ref: string, expectedDigest: string): { name: string; ref: string; integrated_head: string; origin_url_digest: string } {
  if (remote !== 'muqihang' || ref !== 'refs/remotes/muqihang/main' || !DIGEST_RE.test(expectedDigest)) fail('context_remote_origin_drift', 'remote identity flags drifted')
  const url = reviewedGitText(root, ['remote', 'get-url', remote])
  if (sha256(url) !== expectedDigest) fail('context_remote_origin_drift', 'remote URL digest drifted')
  const head = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
  const workingHead = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  if (head !== workingHead) fail('context_head_mismatch', 'tested root does not equal freshly observed remote main')
  return { name: remote, ref, integrated_head: head, origin_url_digest: expectedDigest }
}

function attemptAuthorityFromInput(input: ActualIntegrationEntryInput): Record<string, unknown> {
  const sequence = attemptNumber(input.attemptId)
  if (sequence === 1) {
    if (!same(input.previousAttempt, { id: 'none', receipt: 'none', digest: 'none', commit: 'none' })) fail('attempt_chain_invalid', 'initial attempt requires the all-none predecessor tuple')
    return { attempt_id: input.attemptId, sequence, predecessor: null }
  }
  const previousID = `attempt-${String(sequence - 1).padStart(4, '0')}`
  if (input.previousAttempt.id !== previousID || !DIGEST_RE.test(input.previousAttempt.digest) || !COMMIT_RE.test(input.previousAttempt.commit)
    || input.previousAttempt.receipt !== `docs/superpowers/evidence/phase-1/${previousID}/phase-1-integration-receipt.json`) fail('attempt_chain_invalid', 'successor predecessor tuple drifted')
  return { attempt_id: input.attemptId, sequence, predecessor: { attempt_id: previousID, receipt: { path: input.previousAttempt.receipt, digest: input.previousAttempt.digest }, receipt_commit: input.previousAttempt.commit } }
}

function actualIntegrationEntry(input: ActualIntegrationEntryInput): Record<string, unknown> {
  const controller = realpathSync(input.controllerRoot)
  const ccRoot = realpathSync(input.ccGatewayRoot)
  const subRoot = realpathSync(input.sub2apiRoot)
  if (repositoryStatus(controller).length !== 0 || repositoryStatus(ccRoot).length !== 0 || repositoryStatus(subRoot).length !== 0) fail('dirty_repository', 'integration entry requires three clean roots')
  const catalog = readPhase1Catalog(path.resolve(controller, input.catalogPath))
  const featureResultsBytes = readFileSync(path.resolve(controller, input.featureResultsPath))
  const featureResults = JSON.parse(featureResultsBytes.toString('utf8')) as Record<string, unknown>
  const featureResultsValidation = validatePhase1ResultsValue(featureResults, { catalog })
  if (!featureResultsValidation.ok || featureResults.stage !== 'feature-candidate') fail('red_evidence_mismatch', 'feature results are invalid')
  const featureReviewBytes = readFileSync(path.resolve(controller, input.featureReviewPath))
  const featureReview = JSON.parse(featureReviewBytes.toString('utf8')) as Record<string, unknown>
  const featureReviewValidation = validatePhase1FeatureReviewValue(featureReview, { featureResults })
  if (!featureReviewValidation.ok) fail('feature_review_mismatch', JSON.stringify(featureReviewValidation.errors))
  if (!isObject(featureReview.candidate_heads) || featureReview.candidate_heads.cc_gateway !== input.reviewedCCCandidateHead || featureReview.candidate_heads.sub2api !== input.reviewedSub2APICandidateHead) fail('feature_review_mismatch', 'reviewed candidate flags differ from feature review')
  const contextValue = JSON.parse(readFileSync(path.resolve(controller, input.executionContextPath), 'utf8')) as Record<string, unknown>
  const contextChain = liveExecutionContextChain(controller, ccRoot, subRoot)
  const latestContext = contextChain.at(-1)
  if (!latestContext) fail('context_chain_gap', 'execution-context chain is empty')
  const latestGenerated = Date.parse(String(latestContext.value.generated_at))
  const latestExpires = Date.parse(String(latestContext.value.expires_at))
  if (!Number.isFinite(latestGenerated) || !Number.isFinite(latestExpires) || latestGenerated >= latestExpires) fail('context_window_invalid', 'latest context window is invalid')
  selectLatestPhase1ExecutionContext({
    contexts: contextChain,
    selectedPath: latestContext.path,
    expectedStage: 'feature_capture',
    now: new Date(latestExpires - 1).toISOString(),
  })
  const historicalContext = contextChain.find((node) => node.path === input.executionContextPath)
  if (!historicalContext || historicalContext.digest !== sha256(readFileSync(path.resolve(controller, input.executionContextPath)))
    || !same(historicalContext.value, contextValue)) fail('predecessor_context_mutated', 'feature-results context is absent or mutated')
  if (!isObject(featureResults.authority) || !same(featureResults.authority, {
    path: historicalContext.path,
    digest: historicalContext.digest,
    sequence: Number(historicalContext.value.sequence),
    stage: String(historicalContext.value.stage),
    artifact_commit: historicalContext.artifact_commit,
  })) fail('context_binding_drift', 'feature results do not bind their historical context exactly')
  const capturedAt = Date.parse(String(featureResults.captured_at))
  const historicalGenerated = Date.parse(String(historicalContext.value.generated_at))
  const historicalExpires = Date.parse(String(historicalContext.value.expires_at))
  if (!(historicalGenerated <= capturedAt && capturedAt < historicalExpires)) fail('historical_validity_invalid', 'feature capture did not occur inside its context window')
  if (!isObject(historicalContext.value.repositories) || !isObject(historicalContext.value.repositories.cc_gateway) || !isObject(historicalContext.value.repositories.sub2api)) fail('context_binding_drift', 'historical feature heads are absent')
  const historicalIndex = contextChain.indexOf(historicalContext)
  for (const node of contextChain.slice(historicalIndex)) {
    if (node.value.stage !== 'feature_capture' || !isObject(node.value.repositories)
      || !isObject(node.value.repositories.cc_gateway) || !isObject(node.value.repositories.sub2api)
      || node.value.repositories.cc_gateway.authorized_parent_head !== historicalContext.value.repositories.cc_gateway.authorized_parent_head
      || node.value.repositories.sub2api.authorized_parent_head !== historicalContext.value.repositories.sub2api.authorized_parent_head) {
      fail('context_head_mismatch', 'later context is not an identical-head feature-capture renewal')
    }
  }
  validateContextAuthorityFiles(controller, latestContext.value)
  if (!isObject(latestContext.value.approval_receipt) || !isObject(latestContext.value.approval_receipt.artifact)
    || latestContext.value.approval_receipt.artifact.path !== input.planReviewPath
    || latestContext.value.approval_receipt.artifact.digest !== sha256(readFileSync(path.resolve(controller, input.planReviewPath)))) {
    fail('context_approval_invalid', 'explicit plan review differs from context authority')
  }
  const planReview = JSON.parse(readFileSync(path.resolve(controller, input.planReviewPath), 'utf8')) as Record<string, unknown>
  if (planReview.decision !== 'approved' || !isObject(planReview.finding_counts)
    || planReview.finding_counts.critical !== 0 || planReview.finding_counts.important !== 0) fail('context_approval_invalid', 'explicit plan review is not approved')
  if (!isObject(featureReview.feature_results) || featureReview.feature_results.path !== input.featureResultsPath
    || featureReview.feature_results.digest !== sha256(featureResultsBytes)
    || !same(featureReview.context, featureResults.authority)
    || !isObject(featureReview.plan_review) || featureReview.plan_review.path !== input.planReviewPath
    || featureReview.plan_review.digest !== sha256(readFileSync(path.resolve(controller, input.planReviewPath)))) {
    fail('feature_review_mismatch', 'feature review source bindings drifted')
  }
  if (!isObject(featureReview.tested_heads) || !isObject(featureResults.roots)
    || !isObject(featureResults.roots.cc_gateway) || !isObject(featureResults.roots.sub2api)
    || featureReview.tested_heads.cc_gateway !== featureResults.roots.cc_gateway.head
    || featureReview.tested_heads.sub2api !== featureResults.roots.sub2api.head) fail('feature_review_mismatch', 'feature review tested heads differ from results')
  if (!isObject(featureReview.feature_baseline) || typeof featureReview.feature_baseline.path !== 'string') fail('feature_review_mismatch', 'feature baseline binding is absent')
  const featureBaselinePath = featureReview.feature_baseline.path
  const featureBaselineBytes = readFileSync(path.resolve(controller, featureBaselinePath))
  if (featureReview.feature_baseline.digest !== sha256(featureBaselineBytes)) fail('feature_review_mismatch', 'feature baseline bytes drifted')
  const evidenceDelta = commitDelta(controller, input.reviewedCCCandidateHead)
  const evidencePaths = utf8Sort([featureBaselinePath, input.featureResultsPath])
  validatePhase1FeatureEvidenceCommit({
    tested_head: featureReview.tested_heads.cc_gateway,
    candidate_head: input.reviewedCCCandidateHead,
    parents: reviewedGitText(controller, ['show', '-s', '--format=%P', input.reviewedCCCandidateHead]).split(' ').filter(Boolean),
    added_paths: evidenceDelta.filter((entry) => entry.status === 'A').map((entry) => entry.path),
    bytes_match: evidenceDelta.length === 2 && evidenceDelta.every((entry) => entry.status === 'A')
      && committedArtifactBytes(controller, input.reviewedCCCandidateHead, featureBaselinePath).equals(featureBaselineBytes)
      && committedArtifactBytes(controller, input.reviewedCCCandidateHead, input.featureResultsPath).equals(featureResultsBytes),
    sub2api_tested_head: featureReview.tested_heads.sub2api,
    sub2api_candidate_head: input.reviewedSub2APICandidateHead,
  })
  if (!same(evidenceDelta.map((entry) => entry.path), evidencePaths)) fail('feature_evidence_commit_mismatch', 'feature evidence commit contains the wrong paths')
  const reviewDelta = commitDelta(controller, input.ccReviewAttestationHead)
  validatePhase1FeatureReviewAttestation({
    candidate_head: input.reviewedCCCandidateHead,
    attestation_head: input.ccReviewAttestationHead,
    parents: reviewedGitText(controller, ['show', '-s', '--format=%P', input.ccReviewAttestationHead]).split(' ').filter(Boolean),
    added_paths: reviewDelta.filter((entry) => entry.status === 'A').map((entry) => entry.path),
    bytes_match: reviewDelta.length === 1 && reviewDelta[0].status === 'A'
      && reviewDelta[0].path === input.featureReviewPath
      && committedArtifactBytes(controller, input.ccReviewAttestationHead, input.featureReviewPath).equals(featureReviewBytes),
    path_unchanged_after: reviewedGitText(controller, ['log', '-1', '--format=%H', input.ccReviewAttestationHead, '--', input.featureReviewPath]) === input.ccReviewAttestationHead,
  })
  const ccRemote = remoteObservation(ccRoot, input.ccRemote, input.ccRemoteRef, input.ccOriginDigest)
  const subRemote = remoteObservation(subRoot, input.sub2apiRemote, input.sub2apiRemoteRef, input.sub2apiOriginDigest)
  const topology = {
    cc: { pre_merge_main: input.ccPreMergeMainHead, candidate: input.ccReviewAttestationHead, merge: input.ccMergeCommit, parents: mergeParents(ccRoot, input.ccMergeCommit), ancestor_of_remote: reviewedGitAncestor(ccRoot, input.ccMergeCommit, ccRemote.integrated_head) },
    sub2api: { pre_merge_main: input.sub2apiPreMergeMainHead, candidate: input.reviewedSub2APICandidateHead, merge: input.sub2apiMergeCommit, parents: mergeParents(subRoot, input.sub2apiMergeCommit), ancestor_of_remote: reviewedGitAncestor(subRoot, input.sub2apiMergeCommit, subRemote.integrated_head) },
  }
  validatePhase1MergeTopology(topology)
  const ccTree = treeAt(ccRoot, 'cc_gateway', ccRemote.integrated_head)
  const subTree = treeAt(subRoot, 'sub2api', subRemote.integrated_head)
  if (!isObject(featureReview.implementation_trees)) fail('phase1_implementation_drift', 'feature review lacks implementation trees')
  const reviewedCC = featureReview.implementation_trees.candidate_cc_gateway
  const reviewedSub = featureReview.implementation_trees.candidate_sub2api
  if (!isObject(reviewedCC) || !isObject(reviewedSub) || reviewedCC.entries_digest !== ccTree.entries_digest || reviewedSub.entries_digest !== subTree.entries_digest) fail('phase1_implementation_drift', 'integrated implementation tree differs from feature review')
  const receiptHistory = inspectPhase1ReceiptHistory(controller)
  const predecessor = input.previousAttempt.id === 'none' ? null : {
    attempt_id: input.previousAttempt.id,
    receipt: { path: input.previousAttempt.receipt, digest: input.previousAttempt.digest },
    receipt_commit: input.previousAttempt.commit,
  }
  validatePhase1AttemptChain({
    committed: receiptHistory.map((node) => ({
      attempt_id: node.attempt_id, path: node.path, digest: node.digest, receipt_commit: node.receipt_commit,
      introduced_once: true, present_unchanged: true, ancestor: true, child_topology_valid: true,
    })),
    requested: input.attemptId,
    predecessor,
  })
  const attempt = attemptAuthorityFromInput(input)
  const contract = contractRootBinding(input.sub2apiContractRoot, [controller, ccRoot, subRoot], subRemote.integrated_head, input.sub2apiOriginDigest)
  const generated = new Date(input.now ?? new Date().toISOString())
  if (!Number.isFinite(generated.getTime())) fail('invalid_timestamp', 'integration entry time is invalid')
  const controllerSnapshot = repositorySnapshot(controller, 'cc_gateway')
  const ccSnapshot = repositorySnapshot(ccRoot, 'cc_gateway')
  const subSnapshot = repositorySnapshot(subRoot, 'sub2api')
  const base = {
    schema_version: 1, entry_kind: 'phase_1_integration_entry', generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 24 * 60 * 60 * 1000).toISOString(), attempt,
    catalog: { path: input.catalogPath, digest: CATALOG_DIGEST },
    context: { path: input.executionContextPath, digest: sha256(readFileSync(path.resolve(controller, input.executionContextPath))), sequence: Number(contextValue.sequence), stage: String(contextValue.stage), artifact_commit: String((featureResults.authority as Record<string, unknown>)?.artifact_commit ?? input.reviewedCCCandidateHead) },
    plan_review: { path: input.planReviewPath, digest: sha256(readFileSync(path.resolve(controller, input.planReviewPath))) },
    feature_results: { path: input.featureResultsPath, digest: sha256(readFileSync(path.resolve(controller, input.featureResultsPath))) },
    feature_review: { path: input.featureReviewPath, digest: sha256(readFileSync(path.resolve(controller, input.featureReviewPath))) },
    review_attestation_head: input.ccReviewAttestationHead,
    candidate_heads: { cc_gateway: input.reviewedCCCandidateHead, sub2api: input.reviewedSub2APICandidateHead },
    merge_topology: topology, remote_mains: { cc_gateway: ccRemote, sub2api: subRemote },
    roots: {
      controller: { stage: 'post-integration', head: controllerSnapshot.head, root_identity_digest: controllerSnapshot.root_identity_digest, same_as_tested_cc_root: false, preexisting_delta_paths: [], declared_output_paths: [] },
      cc_gateway: { head: ccSnapshot.head, root_identity_digest: ccSnapshot.root_identity_digest, clean_status_digest: sha256('') },
      sub2api: { head: subSnapshot.head, root_identity_digest: subSnapshot.root_identity_digest, clean_status_digest: sha256('') },
    },
    sub2api_contract_root: contract, implementation_trees: { cc_gateway: ccTree, sub2api: subTree },
    ignored_state_reference: { results_path: input.featureResultsPath, results_digest: featureResults.results_digest, chain_digest: (featureResults.ignored_state_chain as Record<string, unknown>)?.transitions_digest, final: (featureResults.ignored_state_chain as Record<string, unknown>)?.final },
    external_dependency_reference: derivePhase1ExternalDependencyReference(input.featureResultsPath, featureResults),
    sandbox_policy_digest: (featureResults.sandbox as Record<string, unknown>)?.policy_digest,
    shared_contract: { repository: 'sub2api', path: 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json', digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1' },
    disabled_capabilities: [...DISABLED_CAPABILITIES],
  }
  return { ...base, entry_digest: sha256(canonicalJson(base)) }
}

function reviewedGitAncestor(root: string, ancestor: string, descendant: string): boolean {
  return runReviewedGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], { allowedExitCodes: [0, 1] }).status === 0
}

type ActualHandoffInput = {
  actual: true
  controllerRoot: string
  ccGatewayRoot?: string
  sub2apiRoot?: string
  sub2apiContractRoot?: string
  catalog: unknown
  entry: Record<string, unknown>
  baseline: Record<string, unknown>
  results: Record<string, unknown>
  registries: { requirements: { path: string; digest: string }; claims: { path: string; digest: string }; observations: { path: string; digest: string } }
  generatedAt?: string
}

function expectedAttemptPath(attempt: unknown, name: string): string {
  if (!isObject(attempt) || typeof attempt.attempt_id !== 'string' || !/^attempt-[0-9]{4}$/.test(attempt.attempt_id)) {
    fail('attempt_chain_invalid', 'post-integration artifact has no valid attempt authority')
  }
  return `docs/superpowers/evidence/phase-1/${attempt.attempt_id}/${name}`
}

function validateActualPostArtifactChain(input: {
  catalog: unknown
  entry: Record<string, unknown>
  baseline: Record<string, unknown>
  results: Record<string, unknown>
}): void {
  const resultsValidation = validatePhase1ResultsValue(input.results, { catalog: input.catalog })
  if (!resultsValidation.ok || input.results.stage !== 'post-integration') fail('red_evidence_mismatch', 'post-integration results are invalid')
  if (input.entry.entry_kind !== 'phase_1_integration_entry'
    || input.entry.entry_digest !== sha256(canonicalJson(withoutField(input.entry, 'entry_digest')))) fail('integration_entry_mismatch', 'integration entry is invalid')
  if (input.baseline.artifact_kind !== 'phase_1_exit_baseline' || input.baseline.stage !== 'post-integration'
    || input.baseline.baseline_digest !== sha256(canonicalJson(withoutField(input.baseline, 'baseline_digest')))) fail('baseline_binding_mismatch', 'post-integration baseline is invalid')
  const attemptID = isObject(input.entry.attempt) ? String(input.entry.attempt.attempt_id) : ''
  const entryPath = expectedAttemptPath(input.entry.attempt, 'phase-1-integration-entry.json')
  const baselinePath = expectedAttemptPath(input.entry.attempt, 'phase-1-exit-baseline.json')
  if (!isObject(input.results.baseline) || input.results.baseline.path !== baselinePath
    || input.results.baseline.digest !== sha256(artifactBytes(input.baseline))) fail('baseline_binding_mismatch', 'results do not bind the exact baseline bytes')
  if (!isObject(input.results.authority) || input.results.authority.path !== entryPath
    || input.results.authority.digest !== sha256(artifactBytes(input.entry))
    || input.results.authority.sequence !== (input.entry.attempt as Record<string, unknown>).sequence
    || input.results.authority.stage !== 'post_integration') fail('integration_entry_mismatch', 'results do not bind the exact integration entry')
  if (!isObject(input.entry.catalog) || !same(input.entry.catalog, input.results.catalog)
    || input.entry.catalog.digest !== CATALOG_DIGEST) fail('red_evidence_mismatch', 'post-integration catalog binding drifted')
  for (const field of ['catalog', 'authority', 'roots', 'sub2api_contract_root', 'implementation_trees', 'ignored_state', 'external_dependencies', 'sandbox', 'disabled_capabilities']) {
    if (!same(input.baseline[field], input.results[field])) fail('baseline_binding_mismatch', `${field} differs between baseline and results`)
  }
  if (!isObject(input.entry.remote_mains) || !isObject(input.entry.remote_mains.cc_gateway) || !isObject(input.entry.remote_mains.sub2api)
    || !isObject(input.results.roots) || !isObject(input.results.roots.cc_gateway) || !isObject(input.results.roots.sub2api)
    || input.results.roots.cc_gateway.head !== input.entry.remote_mains.cc_gateway.integrated_head
    || input.results.roots.sub2api.head !== input.entry.remote_mains.sub2api.integrated_head) fail('cross_head_result', 'results heads differ from integrated remote authority')
  if (!same(input.entry.implementation_trees, input.results.implementation_trees)
    || !same(input.entry.sub2api_contract_root, input.results.sub2api_contract_root)
    || !isObject(input.results.sandbox) || input.entry.sandbox_policy_digest !== input.results.sandbox.policy_digest
    || !same(input.entry.disabled_capabilities, input.results.disabled_capabilities)
    || !isObject(input.entry.shared_contract) || input.entry.shared_contract.digest !== 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1') {
    fail('integration_entry_mismatch', `post-integration authority bindings drifted for ${attemptID}`)
  }
}

function validateActualPostRoots(input: ActualHandoffInput): void {
  if (!input.ccGatewayRoot || !input.sub2apiRoot || !input.sub2apiContractRoot) return
  const controller = realpathSync(input.controllerRoot)
  const ccRoot = realpathSync(input.ccGatewayRoot)
  const subRoot = realpathSync(input.sub2apiRoot)
  if (controller === ccRoot || repositoryStatus(ccRoot).length !== 0 || repositoryStatus(subRoot).length !== 0) fail('dirty_repository', 'handoff requires distinct controller and clean tested roots')
  if (!isObject(input.entry.remote_mains) || !isObject(input.entry.remote_mains.cc_gateway) || !isObject(input.entry.remote_mains.sub2api)) fail('integration_entry_mismatch', 'integrated remote bindings are absent')
  const ccHead = reviewedGitText(ccRoot, ['rev-parse', 'HEAD'])
  const subHead = reviewedGitText(subRoot, ['rev-parse', 'HEAD'])
  if (ccHead !== input.entry.remote_mains.cc_gateway.integrated_head || subHead !== input.entry.remote_mains.sub2api.integrated_head) fail('context_head_mismatch', 'handoff tested roots differ from integrated heads')
  if (!isObject(input.entry.implementation_trees)
    || !same(treeAt(ccRoot, 'cc_gateway', ccHead), input.entry.implementation_trees.cc_gateway)
    || !same(treeAt(subRoot, 'sub2api', subHead), input.entry.implementation_trees.sub2api)) fail('phase1_implementation_drift', 'handoff implementation trees drifted')
  const contract = contractRootBinding(input.sub2apiContractRoot, [controller, ccRoot, subRoot], subHead, String(input.entry.remote_mains.sub2api.origin_url_digest))
  if (!same(contract, input.entry.sub2api_contract_root)) fail('contract_root_not_authorized', 'handoff contract root differs from integration entry')
}

function actualHandoff(input: ActualHandoffInput): Record<string, unknown> {
  validateActualPostArtifactChain(input)
  validateActualPostRoots(input)
  const generated = new Date(input.generatedAt ?? new Date().toISOString())
  const base = {
    schema_version: 1, handoff_kind: 'phase_1_handoff', generated_at: generated.toISOString(),
    expires_at: new Date(generated.getTime() + 24 * 60 * 60 * 1000).toISOString(), attempt: input.entry.attempt,
    integration_entry: { path: 'docs/superpowers/evidence/phase-1/' + (input.entry.attempt as Record<string, unknown>).attempt_id + '/phase-1-integration-entry.json', digest: sha256(artifactBytes(input.entry)) },
    baseline: { path: String((input.results.baseline as Record<string, unknown>).path), digest: sha256(artifactBytes(input.baseline)) },
    results: { path: String((input.results.baseline as Record<string, unknown>).path).replace('exit-baseline', 'command-results'), digest: sha256(artifactBytes(input.results)) },
    registries: input.registries, implementation_trees: input.results.implementation_trees,
    ignored_state_reference: { results_digest: input.results.results_digest, chain_digest: (input.results.ignored_state_chain as Record<string, unknown>).transitions_digest, final: (input.results.ignored_state_chain as Record<string, unknown>).final },
    external_dependency_reference: derivePhase1ExternalDependencyReference(
      String((input.results.baseline as Record<string, unknown>).path).replace('exit-baseline', 'command-results'),
      input.results,
    ),
    shared_contract: input.entry.shared_contract, disabled_capabilities: [...DISABLED_CAPABILITIES],
    next_phase_gates: [...PHASE2_ENTRY_CONDITIONS],
  }
  return { ...base, handoff_digest: sha256(canonicalJson(base)) }
}

export function renderPhase1HandoffMarkdown(handoff: Record<string, unknown>): string {
  const attempt = isObject(handoff.attempt) ? String(handoff.attempt.attempt_id) : 'invalid'
  const generated = String(handoff.generated_at)
  const expires = String(handoff.expires_at)
  return [
    '# Phase 1 Exit Report', '', `- Attempt: \`${attempt}\``, `- Generated: \`${generated}\``,
    `- Expires: \`${expires}\``, `- Handoff digest: \`${String(handoff.handoff_digest)}\``, '',
    '## Phase 2 Entry Conditions', '',
    ...PHASE2_ENTRY_CONDITIONS.map((condition) => `- ${condition}`), '',
    'Production deployment and real canary remain disabled.', '',
  ].join('\n')
}

type ActualReceiptInput = {
  actual: true
  catalog: unknown
  controllerRoot?: string
  sub2apiRoot?: string
  artifactCommit: string
  entry: Record<string, unknown>
  baseline: Record<string, unknown>
  results: Record<string, unknown>
  handoff: Record<string, unknown>
  report: { path: string; digest: string }
  registries: Record<string, { path: string; digest: string }>
  generatedAt?: string
}

function actualReceipt(input: ActualReceiptInput): Record<string, unknown> {
  validateActualPostArtifactChain(input)
  if (!COMMIT_RE.test(input.artifactCommit) || input.handoff.handoff_digest !== sha256(canonicalJson(withoutField(input.handoff, 'handoff_digest')))) fail('handoff_mismatch', 'receipt inputs are invalid')
  if (input.controllerRoot && input.sub2apiRoot) {
    const controller = realpathSync(input.controllerRoot)
    const subRoot = realpathSync(input.sub2apiRoot)
    if (repositoryStatus(controller).length !== 0 || repositoryStatus(subRoot).length !== 0
      || reviewedGitText(controller, ['rev-parse', 'HEAD']) !== input.artifactCommit) fail('dirty_repository', 'receipt requires the clean exact artifact commit and clean Sub2API root')
    if (!isObject(input.entry.remote_mains) || !isObject(input.entry.remote_mains.cc_gateway) || !isObject(input.entry.remote_mains.sub2api)
      || !isObject(input.entry.implementation_trees)
      || reviewedGitText(subRoot, ['rev-parse', 'HEAD']) !== input.entry.remote_mains.sub2api.integrated_head
      || !sameImplementationTreeContent(treeAt(controller, 'cc_gateway', input.artifactCommit), input.entry.implementation_trees.cc_gateway)
      || !same(treeAt(subRoot, 'sub2api', String(input.entry.remote_mains.sub2api.integrated_head)), input.entry.implementation_trees.sub2api)) {
      fail('phase1_implementation_drift', 'receipt roots differ from integrated implementation authority')
    }
  }
  const expectedHandoff = actualHandoff({
    actual: true,
    controllerRoot: input.controllerRoot ?? '.',
    catalog: input.catalog,
    entry: input.entry,
    baseline: input.baseline,
    results: input.results,
    registries: input.registries as ActualHandoffInput['registries'],
    generatedAt: String(input.handoff.generated_at),
  })
  if (!same(expectedHandoff, input.handoff)) fail('handoff_mismatch', 'receipt inputs do not deterministically regenerate the handoff')
  const generated = new Date(input.generatedAt ?? new Date().toISOString())
  const sourceGenerated = Date.parse(String(input.handoff.generated_at)); const sourceExpires = Date.parse(String(input.handoff.expires_at))
  if (!(sourceGenerated <= generated.getTime() && generated.getTime() < sourceExpires)) fail('historical_validity_invalid', 'handoff is not live at receipt construction')
  const attemptID = String((input.entry.attempt as Record<string, unknown>).attempt_id)
  const artifacts = {
    integration_entry: { path: `docs/superpowers/evidence/phase-1/${attemptID}/phase-1-integration-entry.json`, digest: sha256(artifactBytes(input.entry)) },
    baseline: { path: `docs/superpowers/evidence/phase-1/${attemptID}/phase-1-exit-baseline.json`, digest: sha256(artifactBytes(input.baseline)) },
    results: { path: `docs/superpowers/evidence/phase-1/${attemptID}/phase-1-command-results.json`, digest: sha256(artifactBytes(input.results)) },
    handoff: { path: `docs/superpowers/evidence/phase-1/${attemptID}/phase-1-handoff.json`, digest: sha256(artifactBytes(input.handoff)) },
    report: input.report,
    ...input.registries,
  }
  const base = {
    schema_version: 1, receipt_kind: 'phase_1_integration_receipt', generated_at: generated.toISOString(),
    historical_valid_at: { validated_at: generated.toISOString(), source_generated_at: new Date(sourceGenerated).toISOString(), source_expires_at: new Date(sourceExpires).toISOString() },
    attempt: input.entry.attempt, artifact_commit: input.artifactCommit,
    integrated_heads: { cc_gateway: ((input.entry.remote_mains as Record<string, Record<string, unknown>>).cc_gateway).integrated_head, sub2api: ((input.entry.remote_mains as Record<string, Record<string, unknown>>).sub2api).integrated_head },
    artifacts, implementation_trees: input.results.implementation_trees,
    ignored_state_reference: { results_digest: input.results.results_digest, chain_digest: (input.results.ignored_state_chain as Record<string, unknown>).transitions_digest, final: (input.results.ignored_state_chain as Record<string, unknown>).final },
    external_dependency_reference: derivePhase1ExternalDependencyReference(
      `docs/superpowers/evidence/phase-1/${attemptID}/phase-1-command-results.json`,
      input.results,
    ),
    shared_contract: input.entry.shared_contract, disabled_capabilities: [...DISABLED_CAPABILITIES],
    next_phase_gates: [...PHASE2_ENTRY_CONDITIONS],
  }
  return { ...base, receipt_digest: sha256(canonicalJson(base)) }
}

export function buildPhase1IntegrationEntry(options: unknown): Record<string, unknown> {
  return isObject(options) && options.actual === true ? actualIntegrationEntry(options as unknown as ActualIntegrationEntryInput) : buildDownstream('integration_entry', options)
}
export function validatePhase1IntegrationEntryValue(value: unknown, options: { source?: unknown } = {}): HarnessResult {
  if (isObject(value) && value.entry_kind === 'phase_1_integration_entry') {
    const errors: HarnessErrorRecord[] = []
    if (value.entry_digest !== sha256(canonicalJson(withoutField(value, 'entry_digest')))) add(errors, 'integration_entry_mismatch', '$.entry_digest', 'entry digest drifted')
    return result(errors)
  }
  return validateDownstream(value, 'integration_entry', options.source)
}
export function buildPhase1Handoff(options: unknown): Record<string, unknown> {
  return isObject(options) && options.actual === true ? actualHandoff(options as unknown as ActualHandoffInput) : buildDownstream('handoff', options)
}
export function validatePhase1HandoffValue(value: unknown, options: { source?: unknown } = {}): HarnessResult {
  if (isObject(value) && value.handoff_kind === 'phase_1_handoff') {
    const errors: HarnessErrorRecord[] = []
    if (value.handoff_digest !== sha256(canonicalJson(withoutField(value, 'handoff_digest'))) || !same(value.next_phase_gates, PHASE2_ENTRY_CONDITIONS)) add(errors, 'handoff_mismatch', '$', 'handoff digest or gates drifted')
    return result(errors)
  }
  return validateDownstream(value, 'handoff', options.source)
}
export function buildPhase1IntegrationReceipt(options: unknown): Record<string, unknown> {
  return isObject(options) && options.actual === true ? actualReceipt(options as unknown as ActualReceiptInput) : buildDownstream('integration_receipt', options)
}
export function validatePhase1IntegrationReceiptValue(value: unknown, options: { source?: unknown } = {}): HarnessResult {
  if (isObject(value) && value.receipt_kind === 'phase_1_integration_receipt') {
    const errors: HarnessErrorRecord[] = []
    if (value.receipt_digest !== sha256(canonicalJson(withoutField(value, 'receipt_digest'))) || !same(value.next_phase_gates, PHASE2_ENTRY_CONDITIONS)) add(errors, 'receipt_mismatch', '$', 'receipt digest or gates drifted')
    if (!isObject(value.historical_valid_at) || !(Date.parse(String(value.historical_valid_at.source_generated_at)) <= Date.parse(String(value.historical_valid_at.validated_at)) && Date.parse(String(value.historical_valid_at.validated_at)) < Date.parse(String(value.historical_valid_at.source_expires_at)))) add(errors, 'historical_validity_invalid', '$.historical_valid_at', 'historical validity relation is false')
    return result(errors)
  }
  return validateDownstream(value, 'integration_receipt', options.source)
}

export function validatePhase1CommittedArtifactChain(input: {
  catalog: unknown
  featureResults: unknown
  featureReview: unknown
  entry: unknown
  baseline: unknown
  results: unknown
  handoff: unknown
  receipt: unknown
  bindings: Record<string, { path: string; digest: string }>
}): HarnessResult {
  const errors: HarnessErrorRecord[] = []
  const catalogValidation = validatePhase1CatalogValue(input.catalog)
  for (const error of catalogValidation.errors) add(errors, error.code, '$.catalog', error.message)
  const featureResultsValidation = validatePhase1ResultsValue(input.featureResults, { catalog: input.catalog })
  for (const error of featureResultsValidation.errors) add(errors, error.code, '$.feature_results', error.message)
  const featureReviewValidation = validatePhase1FeatureReviewValue(input.featureReview, { featureResults: input.featureResults })
  for (const error of featureReviewValidation.errors) add(errors, error.code, '$.feature_review', error.message)
  const resultsValidation = validatePhase1ResultsValue(input.results, { catalog: input.catalog })
  for (const error of resultsValidation.errors) add(errors, error.code, '$.results', error.message)
  if (isObject(input.entry) && input.entry.schema_version === 1) {
    for (const [validation, prefix] of [
      [validatePhase1IntegrationEntryValue(input.entry), '$.entry'],
      [validatePhase1HandoffValue(input.handoff), '$.handoff'],
      [validatePhase1IntegrationReceiptValue(input.receipt), '$.receipt'],
    ] as const) {
      for (const error of validation.errors) add(errors, error.code, prefix, error.message)
    }
  }
  for (const [kind, value, digestField] of [
    ['entry', input.entry, 'entry_digest'], ['baseline', input.baseline, 'baseline_digest'],
    ['handoff', input.handoff, 'handoff_digest'], ['receipt', input.receipt, 'receipt_digest'],
  ] as const) {
    if (!isObject(value) || value[digestField] !== sha256(canonicalJson(withoutField(value, digestField)))) {
      add(errors, `${kind}_mismatch`, `$.${kind}`, `${kind} canonical digest drifted`)
    }
  }
  if (!isObject(input.entry) || !isObject(input.results) || !isObject(input.handoff) || !isObject(input.receipt)) return result(errors)
  if (input.entry.schema_version === 1) {
    try {
      validateActualPostArtifactChain({ catalog: input.catalog, entry: input.entry, baseline: input.baseline as Record<string, unknown>, results: input.results })
    } catch (error) {
      add(errors, String((error as Error & { code?: string }).code ?? 'artifact_source_chain_mismatch'), '$', (error as Error).message)
    }
  }
  for (const [name, value] of [
    ['featureResults', input.featureResults], ['featureReview', input.featureReview], ['entry', input.entry],
    ['baseline', input.baseline], ['results', input.results], ['handoff', input.handoff],
  ] as const) {
    const binding = input.bindings[name]
    if (!isObject(binding) || typeof binding.path !== 'string' || binding.digest !== sha256(artifactBytes(value))) {
      add(errors, 'artifact_source_chain_mismatch', `$.bindings.${name}`, `${name} committed bytes do not match its binding`)
    }
  }
  for (const [owner, reference, source] of [
    ['feature_review', input.featureReview.external_dependency_reference, input.featureResults],
    ['entry', input.entry.external_dependency_reference, input.featureResults],
    ['handoff', input.handoff.external_dependency_reference, input.results],
    ['receipt', input.receipt.external_dependency_reference, input.results],
  ] as const) {
    const validation = validatePhase1ExternalDependencyReference(reference, source)
    for (const error of validation.errors) add(errors, 'external_dependency_drift', `$.${owner}.external_dependency_reference`, error.message)
  }
  if (!isObject(input.receipt.artifacts)) add(errors, 'receipt_mismatch', '$.receipt.artifacts', 'receipt artifact bindings are absent')
  else {
    for (const [name, key] of [['integration_entry', 'entry'], ['baseline', 'baseline'], ['results', 'results'], ['handoff', 'handoff']] as const) {
      if (!same(input.receipt.artifacts[name], input.bindings[key])) add(errors, 'receipt_mismatch', `$.receipt.artifacts.${name}`, 'receipt artifact binding drifted')
    }
  }
  if (!same(input.entry.feature_results, input.bindings.featureResults)
    || !same(input.entry.feature_review, input.bindings.featureReview)
    || !same(input.handoff.integration_entry, input.bindings.entry)
    || !same(input.handoff.baseline, input.bindings.baseline)
    || !same(input.handoff.results, input.bindings.results)) {
    add(errors, 'artifact_source_chain_mismatch', '$', 'downstream source references drifted')
  }
  const resultsRoots = input.results.roots
  const remoteMains = input.entry.remote_mains
  const integratedHeads = input.receipt.integrated_heads
  if (!isObject(resultsRoots) || !isObject(resultsRoots.cc_gateway) || !isObject(resultsRoots.sub2api)
    || !isObject(remoteMains) || !isObject(remoteMains.cc_gateway) || !isObject(remoteMains.sub2api)
    || !isObject(integratedHeads)
    || integratedHeads.cc_gateway !== remoteMains.cc_gateway.integrated_head
    || integratedHeads.sub2api !== remoteMains.sub2api.integrated_head
    || integratedHeads.cc_gateway !== resultsRoots.cc_gateway.head
    || integratedHeads.sub2api !== resultsRoots.sub2api.head) {
    add(errors, 'cross_head_result', '$.receipt.integrated_heads', 'receipt, integration entry, and results heads are not the same authority')
  }
  if (!same(input.entry.implementation_trees, input.results.implementation_trees)
    || !isObject(input.baseline) || !same(input.baseline.implementation_trees, input.results.implementation_trees)
    || !same(input.handoff.implementation_trees, input.results.implementation_trees)
    || !same(input.receipt.implementation_trees, input.results.implementation_trees)) {
    add(errors, 'phase1_implementation_drift', '$.receipt.implementation_trees', 'downstream implementation-tree authority drifted')
  }
  const featureIgnored = isObject(input.featureResults.ignored_state_chain)
    ? { results_path: input.bindings.featureResults?.path, results_digest: input.featureResults.results_digest, chain_digest: input.featureResults.ignored_state_chain.transitions_digest, final: input.featureResults.ignored_state_chain.final }
    : null
  const postIgnored = isObject(input.results.ignored_state_chain)
    ? { results_digest: input.results.results_digest, chain_digest: input.results.ignored_state_chain.transitions_digest, final: input.results.ignored_state_chain.final }
    : null
  if (!same(input.entry.ignored_state_reference, featureIgnored)
    || !same(input.handoff.ignored_state_reference, postIgnored)
    || !same(input.receipt.ignored_state_reference, postIgnored)) {
    add(errors, 'ignored_state_drift', '$.receipt.ignored_state_reference', 'downstream ignored-state authority drifted')
  }
  const contractRoot = input.results.sub2api_contract_root
  const expectedContract = isObject(contractRoot)
    ? { repository: 'sub2api', path: contractRoot.contract_relative_path, digest: contractRoot.contract_digest }
    : null
  if (!same(input.entry.shared_contract, expectedContract)
    || !same(input.handoff.shared_contract, expectedContract)
    || !same(input.receipt.shared_contract, expectedContract)) {
    add(errors, 'contract_root_not_authorized', '$.receipt.shared_contract', 'downstream shared-contract authority drifted')
  }
  if (!same(input.entry.disabled_capabilities, input.results.disabled_capabilities)
    || !isObject(input.baseline) || !same(input.baseline.disabled_capabilities, input.results.disabled_capabilities)
    || !same(input.handoff.disabled_capabilities, input.results.disabled_capabilities)
    || !same(input.receipt.disabled_capabilities, input.results.disabled_capabilities)) {
    add(errors, 'context_binding_drift', '$.receipt.disabled_capabilities', 'downstream disabled capabilities drifted')
  }
  return result(errors)
}

type RepositorySnapshot = {
  root_identity_digest: string
  head: string
  status: string[]
  clean_status_digest: string
  implementation_tree: Phase1ImplementationTreeBinding
  ignored: Phase1IgnoredStateBinding
}

export type Phase1ExitBaseline = Record<string, unknown>
export type Phase1Results = Record<string, unknown>

function reviewedGitText(root: string, args: readonly string[]): string {
  return runReviewedGit(root, args).stdout.toString('utf8').replace(/\r?\n$/, '')
}

function repositoryStatus(root: string): string[] {
  const bytes = runReviewedGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none']).stdout
  return bytes.length === 0 ? [] : bytes.toString('utf8').split('\0').filter(Boolean)
}

function ignoredInventory(root: string, repository: 'cc_gateway' | 'sub2api'): Phase1IgnoredStateBinding {
  let inventory: IgnoredPathInventory
  try { inventory = computeIgnoredPathInventory(root) }
  catch (error) {
    const code = (error as Error & { code?: string }).code
    if (code === 'ignored_inventory_limit_exceeded') fail('ignored_state_inventory_limit', 'ignored-state inventory exceeded the reviewed bound')
    throw error
  }
  const records: Phase1IgnoredRecord[] = inventory.records.map((record) => {
    const relative = decodeUtf8Path(record.path)
    const base: Phase1IgnoredRecord = {
      path: relative,
      type: record.type,
      mode: record.mode,
      size: record.size,
      content_digest: record.content_digest,
      symlink_target_digest: record.symlink_target_digest,
    }
    if (record.type === 'symlink') {
      let rawTarget: Buffer
      try { rawTarget = readlinkSync(path.join(root, relative), { encoding: 'buffer' }) }
      catch { return fail('ignored_state_drift', 'ignored symlink changed during closure validation') }
      let target: string
      try { target = new TextDecoder('utf-8', { fatal: true }).decode(rawTarget) }
      catch { return fail('ignored_state_symlink_escape', 'ignored symlink target is not valid UTF-8') }
      if (!Buffer.from(target).equals(rawTarget)) fail('ignored_state_symlink_escape', 'ignored symlink target does not round-trip')
      base.symlink_target = target
    }
    return base
  })
  return derivePhase1IgnoredStateBinding({ repository, records })
}

function repositorySnapshot(rootInput: string, repository: 'cc_gateway' | 'sub2api'): RepositorySnapshot {
  const root = realpathSync(rootInput)
  assertNoGitReplacementRefs(root)
  const top = realpathSync(reviewedGitText(root, ['rev-parse', '--show-toplevel']))
  if (top !== root) fail('capture_root_not_authorized', 'capture root must be a repository top level')
  const head = reviewedGitText(root, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
  const status = repositoryStatus(root)
  const rawTree = runReviewedGit(root, ['ls-tree', '-r', '-z', '--full-tree', head]).stdout
  return {
    root_identity_digest: sha256(root),
    head,
    status,
    clean_status_digest: sha256(Buffer.from(status.join('\0'))),
    implementation_tree: derivePhase1ImplementationTreeBinding({ repository, sourceCommit: head, rawTree }),
    ignored: ignoredInventory(root, repository),
  }
}

function immutableSnapshot(before: RepositorySnapshot, after: RepositorySnapshot, allowStatus: readonly string[] = []): void {
  if (after.head !== before.head || after.root_identity_digest !== before.root_identity_digest
    || !same(after.implementation_tree, before.implementation_tree) || !same(after.status, allowStatus)) {
    fail('repository_mutation', 'repository tracked state or identity changed during capture')
  }
}

function relativeToRoot(root: string, file: string): string {
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative) || relative.includes('\\')
    || path.posix.normalize(relative) !== relative) fail('artifact_path_escape', 'artifact path escapes controller root')
  return relative
}

function rawArtifactBinding(root: string, file: string): { path: string; digest: string } {
  return { path: relativeToRoot(root, file), digest: sha256(readFileSync(path.resolve(root, file))) }
}

function artifactBytes(value: unknown): Buffer {
  return Buffer.from(`${canonicalJson(value)}\n`)
}

function writeExclusivePair(root: string, artifacts: readonly [{ file: string; value?: unknown; raw?: Buffer }, { file: string; value?: unknown; raw?: Buffer }]): void {
  const prepared = artifacts.map(({ file, value, raw }, index) => {
    const absolute = path.resolve(root, file)
    relativeToRoot(root, absolute)
    mkdirSync(path.dirname(absolute), { recursive: true })
    if (existsSync(absolute)) fail('artifact_exists', 'capture output already exists')
    const temp = `${absolute}.tmp-${process.pid}-${Date.now()}-${index}`
    const fd = openSync(temp, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0), 0o600)
    try { writeFileSync(fd, raw ?? artifactBytes(value)) } finally { closeSync(fd) }
    return { absolute, temp }
  })
  const published: string[] = []
  try {
    for (const item of prepared) {
      linkSync(item.temp, item.absolute)
      published.push(item.absolute)
    }
  } catch (error) {
    for (const file of published) { try { unlinkSync(file) } catch { /* rollback this transaction's link */ } }
    throw error
  } finally {
    for (const item of prepared) { try { unlinkSync(item.temp) } catch { /* remove this transaction's temp */ } }
  }
}

function expandToken(value: string, roots: { cc: string; sub: string; contract: string }): string {
  return value
    .replaceAll('${CC_GATEWAY_ROOT}', roots.cc)
    .replaceAll('${SUB2API_ROOT}', roots.sub)
    .replaceAll('${SUB2API_CONTRACT_ROOT}', roots.contract)
}

function reviewedTool(name: string): string {
  if (name === 'node') return realpathSync(process.execPath)
  const candidates = name === 'npm'
    ? ['/opt/homebrew/bin/npm', '/usr/local/bin/npm', '/usr/bin/npm']
    : name === 'go'
      ? ['/opt/homebrew/bin/go', '/usr/local/go/bin/go', '/usr/local/bin/go']
      : []
  for (const candidate of candidates) {
    try { return realpathSync(candidate) } catch { /* try next reviewed absolute path */ }
  }
  fail('missing_reviewed_tool', `${name} executable is unavailable at a reviewed absolute path`)
}

export function validatePhase1GoModuleCacheMetadata(
  metadata: { is_directory: boolean; is_symlink: boolean; uid: number; mode: number },
  expectedUID: number,
): void {
  if (!metadata.is_directory || metadata.is_symlink || metadata.uid !== expectedUID || (metadata.mode & 0o022) !== 0) {
    fail('external_dependency_drift', 'GOMODCACHE is not an owned, non-symlink, non-writable directory')
  }
}

export function validatePhase1GoModuleCacheRoot(candidateInput: string): string {
  const account = userInfo()
  const accountHome = realpathSync(account.homedir)
  const expected = path.join(accountHome, 'go', 'pkg', 'mod')
  if (!path.isAbsolute(candidateInput) || path.normalize(candidateInput) !== candidateInput || candidateInput !== expected) {
    fail('external_dependency_drift', 'GOMODCACHE is not the authoritative OS-account cache')
  }
  let metadata
  try { metadata = lstatSync(candidateInput) } catch { return fail('external_dependency_drift', 'authoritative OS-account GOMODCACHE is unavailable') }
  validatePhase1GoModuleCacheMetadata({
    is_directory: metadata.isDirectory(), is_symlink: metadata.isSymbolicLink(), uid: metadata.uid, mode: metadata.mode & 0o777,
  }, account.uid)
  const canonical = realpathSync(candidateInput)
  if (canonical !== expected) fail('external_dependency_drift', 'GOMODCACHE canonical path drifted')
  return canonical
}

function reviewedGoModuleCache(): string {
  const go = reviewedTool('go')
  const accountHome = realpathSync(userInfo().homedir)
  const expected = path.join(accountHome, 'go', 'pkg', 'mod')
  let output: string
  try {
    output = execFileSync(go, ['env', 'GOMODCACHE'], {
      encoding: 'utf8',
      env: { PATH: '/opt/homebrew/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin', HOME: accountHome, GOENV: 'off', GOTOOLCHAIN: 'local' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).replace(/\r?\n$/, '')
  } catch { return fail('external_dependency_drift', 'reviewed Go tool cannot resolve GOMODCACHE') }
  if (output !== expected) fail('external_dependency_drift', 'reviewed Go tool did not resolve the authoritative OS-account GOMODCACHE')
  return validatePhase1GoModuleCacheRoot(output)
}

function createPhase1ExclusiveBuildCache(): string {
  const directory = mkdtempSync('/tmp/oracle-lab-phase1-go-build-')
  chmodSync(directory, 0o700)
  const metadata = lstatSync(directory)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.uid !== process.getuid?.()
    || (metadata.mode & 0o077) !== 0 || readdirSync(directory).length !== 0) {
    fail('unsafe_full_suite_build_cache', 'exclusive GOCACHE failed ownership/mode/emptiness checks')
  }
  return directory
}

type Phase1PreparationDigests = {
  cc_gateway: string
  sub2api: string
}

function dependencyTreeRecords(root: string, relativeRoot: string): Phase1IgnoredRecord[] {
  const absoluteRoot = path.resolve(root, relativeRoot)
  const rootReal = realpathSync(absoluteRoot)
  if (rootReal !== absoluteRoot) fail('external_dependency_drift', 'dependency root is not canonical')
  const records: Phase1IgnoredRecord[] = []
  const visit = (absolute: string, relative: string): void => {
    const metadata = lstatSync(absolute)
    if (metadata.isDirectory()) {
      records.push({ path: relative, type: 'directory', mode: metadata.mode & 0o777 })
      for (const name of readdirSync(absolute).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))) {
        visit(path.join(absolute, name), `${relative}/${name}`)
      }
      return
    }
    if (metadata.isFile()) {
      records.push({ path: relative, type: 'regular', mode: metadata.mode & 0o777, size: metadata.size, content_digest: sha256(readFileSync(absolute)) })
      return
    }
    if (metadata.isSymbolicLink()) {
      const target = readlinkSync(absolute)
      const lexical = path.resolve(path.dirname(absolute), target)
      if (path.relative(absoluteRoot, lexical).startsWith('..') || path.isAbsolute(target)) fail('external_dependency_drift', 'dependency symlink escapes its bound root')
      records.push({ path: relative, type: 'symlink', mode: metadata.mode & 0o777, symlink_target: target, symlink_target_digest: sha256(target) })
      return
    }
    fail('external_dependency_drift', 'dependency tree contains a special file')
  }
  visit(absoluteRoot, relativeRoot)
  validatePhase1IgnoredSymlinkClosure(records)
  return records
}

export function parsePhase1GoModuleList(raw: string): Array<Record<string, unknown>> {
  const values: Array<Record<string, unknown>> = []
  let start = -1; let depth = 0; let quoted = false; let escaped = false
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (depth === 0 && character !== '{' && !/\s/.test(character)) fail('external_dependency_drift', 'Go module JSON stream contains a top-level non-object token')
    if (character === '"') { quoted = true; continue }
    if (character === '{') { if (depth === 0) start = index; depth += 1; continue }
    if (character === '}') {
      depth -= 1
      if (depth < 0 || start < 0) fail('external_dependency_drift', 'Go module JSON stream is malformed')
      if (depth === 0) {
        let value: unknown
        try { value = JSON.parse(raw.slice(start, index + 1)) } catch { return fail('external_dependency_drift', 'Go module JSON object is malformed') }
        if (!isObject(value)) fail('external_dependency_drift', 'Go module JSON value is not an object')
        values.push(value); start = -1
      }
    }
  }
  if (quoted || escaped || depth !== 0 || start !== -1 || values.length === 0) fail('external_dependency_drift', 'Go module JSON stream is incomplete')
  return values
}

function goManifestSummary(root: string, moduleRoot: string, verificationDigest: string, goModuleCache: string): Phase1ExternalDependencyBinding['go_module_manifests'][number] {
  const moduleDirectory = path.resolve(root, moduleRoot)
  const goMod = readFileSync(path.join(moduleDirectory, 'go.mod'))
  const goSumPath = path.join(moduleDirectory, 'go.sum')
  const goSum = existsSync(goSumPath) ? readFileSync(goSumPath) : Buffer.alloc(0)
  const goModText = goMod.toString('utf8')
  for (const line of goModText.split(/\r?\n/)) {
    const match = /^\s*replace\s+\S+(?:\s+\S+)?\s+=>\s+(\S+)/.exec(line)
    if (match && (path.isAbsolute(match[1]) || match[1].startsWith('.') || match[1].includes('..'))) {
      const target = path.resolve(moduleDirectory, match[1])
      if (path.relative(root, target).startsWith('..')) fail('external_dependency_drift', 'Go replacement escapes the tested repository')
    }
  }
  let moduleOutput: string
  try {
    moduleOutput = execFileSync(reviewedTool('go'), ['list', '-mod=readonly', '-m', '-json', 'all'], {
      cwd: moduleDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/opt/homebrew/bin:/usr/local/go/bin:/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', GOENV: 'off', GOFLAGS: '-mod=readonly', GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local', GOMODCACHE: goModuleCache, GOCACHE: createPhase1ExclusiveBuildCache() },
    })
  } catch { return fail('external_dependency_drift', 'go list -mod=readonly -m -json all failed') }
  const listed = parsePhase1GoModuleList(moduleOutput)
  const seen = new Set<string>(); const manifests: Array<Record<string, unknown>> = []; const contents: Array<Record<string, unknown>> = []
  for (const module of listed) {
    const modulePath = String(module.Path ?? ''); const version = String(module.Version ?? '')
    const key = `${modulePath}@${version}`
    if (!modulePath || seen.has(key)) fail('external_dependency_drift', 'listed Go module identity is missing or duplicated')
    seen.add(key)
    const replacement = isObject(module.Replace) ? module.Replace : undefined
    const effectiveDirectory = String(replacement?.Dir ?? module.Dir ?? '')
    const manifest = { path: modulePath, version, replacement_path: replacement ? String(replacement.Path ?? '') : '', replacement_version: replacement ? String(replacement.Version ?? '') : '' }
    manifests.push(manifest)
    if (!effectiveDirectory) fail('external_dependency_drift', 'listed Go module has no authenticated directory')
    const canonicalDirectory = realpathSync(effectiveDirectory)
    const repositoryRelative = path.relative(root, canonicalDirectory)
    const cacheRelative = path.relative(goModuleCache, canonicalDirectory)
    const insideRepository = repositoryRelative === '' || (!repositoryRelative.startsWith('..') && !path.isAbsolute(repositoryRelative))
    const insideCache = cacheRelative === '' || (!cacheRelative.startsWith('..') && !path.isAbsolute(cacheRelative))
    if (!insideRepository && !insideCache) fail('external_dependency_drift', 'listed Go module directory escapes tested repository and GOMODCACHE')
    if (replacement && !insideRepository && !insideCache) fail('external_dependency_drift', 'Go replacement escapes dependency authority')
    if (insideCache) contents.push({ module: manifest, records: dependencyTreeRecords(goModuleCache, cacheRelative) })
  }
  manifests.sort((left, right) => Buffer.compare(Buffer.from(String(left.path)), Buffer.from(String(right.path))))
  contents.sort((left, right) => Buffer.compare(Buffer.from(String((left.module as Record<string, unknown>).path)), Buffer.from(String((right.module as Record<string, unknown>).path))))
  return {
    repository_relative_root: moduleRoot,
    go_mod_digest: sha256(goMod), go_sum_digest: sha256(goSum), module_count: manifests.length,
    module_manifest_digest: sha256(canonicalJson(manifests)),
    module_content_digest: sha256(canonicalJson(contents)),
    go_mod_verify_digest: verificationDigest,
  }
}

function liveExternalDependencyBinding(
  repository: 'cc_gateway' | 'sub2api',
  root: string,
  verificationDigest: string,
  goModuleCache: string,
): Phase1ExternalDependencyBinding {
  const nodeRoot = repository === 'cc_gateway' ? '.' : 'frontend'
  const goRoot = repository === 'cc_gateway' ? 'sidecar/egress-tls-sidecar' : 'backend'
  const nodeModulesRoot = nodeRoot === '.' ? 'node_modules' : `${nodeRoot}/node_modules`
  const nodeRecords = dependencyTreeRecords(root, nodeModulesRoot)
  return derivePhase1ExternalDependencyBinding({
    algorithm: 'phase1_external_dependency_content_v1', repository,
    preparation: 'npm_ci_offline_ignore_scripts_and_go_mod_verify_v1',
    node_binary_digest: sha256(readFileSync(reviewedTool('node'))),
    npm_binary_digest: sha256(readFileSync(reviewedTool('npm'))),
    go_binary_digest: sha256(readFileSync(reviewedTool('go'))),
    node_dependency_manifests: [{
      repository_relative_root: nodeRoot,
      package_json_digest: sha256(readFileSync(path.join(root, nodeRoot, 'package.json'))),
      package_lock_digest: sha256(readFileSync(path.join(root, nodeRoot, 'package-lock.json'))),
      entry_count: nodeRecords.length,
      content_digest: sha256(canonicalJson(nodeRecords)),
    }],
    go_module_manifests: [goManifestSummary(root, goRoot, verificationDigest, goModuleCache)],
  })
}

function liveExternalDependencySet(roots: { cc: string; sub: string }, verification: Phase1PreparationDigests, goModuleCache: string): Phase1ExternalDependencySet {
  return {
    cc_gateway: liveExternalDependencyBinding('cc_gateway', roots.cc, verification.cc_gateway, goModuleCache),
    sub2api: liveExternalDependencyBinding('sub2api', roots.sub, verification.sub2api, goModuleCache),
  }
}

export function preparePhase1ExternalDependencies(options: {
  ccGatewayRoot: string
  sub2apiRoot: string
  sandbox: Phase1LoopbackSandbox
  runner?: typeof runBoundedProcess
  goModuleCache?: string
}): { dependencies: Phase1ExternalDependencySet; verification: Phase1PreparationDigests } {
  const roots = { cc: realpathSync(options.ccGatewayRoot), sub: realpathSync(options.sub2apiRoot) }
  const runner = options.runner ?? runBoundedProcess
  const reviewedCache = reviewedGoModuleCache()
  const goModuleCache = options.goModuleCache === undefined
    ? reviewedCache
    : validatePhase1GoModuleCacheRoot(options.goModuleCache)
  const cache = createPhase1ExclusiveBuildCache()
  const env = buildPhase1CommandEnvironment({ id: 'dependency-preparation', env: {} } as Phase1Command,
    { ...roots, contract: roots.sub }, { goBuildCache: cache, goModuleCache })
  const npmRoots = [roots.cc, path.join(roots.sub, 'frontend')]
  for (const cwd of npmRoots) {
    const observed = runner({
      argv: wrapPhase1Command({ executable: options.sandbox.executable, profilePath: options.sandbox.profile_path, argv: [reviewedTool('npm'), 'ci', '--offline', '--ignore-scripts'] }),
      cwd, env, timeoutMs: 900_000, maxOutputBytes: 8 * 1024 * 1024,
    })
    if (observed.exitCode !== 0 || observed.timedOut || observed.outputOverflow || observed.infrastructureFailure || observed.unsafeOutputDetected) {
      fail('external_dependency_drift', 'offline npm preparation failed')
    }
  }
  const verification = {} as Phase1PreparationDigests
  for (const [repository, cwd] of [
    ['cc_gateway', path.join(roots.cc, 'sidecar/egress-tls-sidecar')],
    ['sub2api', path.join(roots.sub, 'backend')],
  ] as const) {
    const observed = runner({
      argv: wrapPhase1Command({ executable: options.sandbox.executable, profilePath: options.sandbox.profile_path, argv: [reviewedTool('go'), 'mod', 'verify'] }),
      cwd, env, timeoutMs: 900_000, maxOutputBytes: 8 * 1024 * 1024,
    })
    if (observed.exitCode !== 0 || observed.timedOut || observed.outputOverflow || observed.infrastructureFailure || observed.unsafeOutputDetected) {
      fail('external_dependency_drift', 'go mod verify failed')
    }
    verification[repository] = sha256(canonicalJson({ stdout_digest: observed.stdoutDigest, stderr_digest: observed.stderrDigest, exit_code: observed.exitCode }))
  }
  return { dependencies: liveExternalDependencySet(roots, verification, goModuleCache), verification }
}

function verifyCurrentPhase1ExternalDependencies(options: {
  ccGatewayRoot: string
  sub2apiRoot: string
  sandbox: Phase1LoopbackSandbox
  runner?: typeof runBoundedProcess
  goModuleCache?: string
}): Phase1ExternalDependencySet {
  const roots = { cc: realpathSync(options.ccGatewayRoot), sub: realpathSync(options.sub2apiRoot) }
  const runner = options.runner ?? runBoundedProcess
  const reviewedCache = reviewedGoModuleCache()
  const goModuleCache = options.goModuleCache === undefined
    ? reviewedCache
    : validatePhase1GoModuleCacheRoot(options.goModuleCache)
  const cache = createPhase1ExclusiveBuildCache()
  const env = buildPhase1CommandEnvironment({ id: 'dependency-validation', env: {} } as Phase1Command,
    { ...roots, contract: roots.sub }, { goBuildCache: cache, goModuleCache })
  const verification = {} as Phase1PreparationDigests
  for (const [repository, cwd] of [
    ['cc_gateway', path.join(roots.cc, 'sidecar/egress-tls-sidecar')],
    ['sub2api', path.join(roots.sub, 'backend')],
  ] as const) {
    const observed = runner({
      argv: wrapPhase1Command({ executable: options.sandbox.executable, profilePath: options.sandbox.profile_path, argv: [reviewedTool('go'), 'mod', 'verify'] }),
      cwd, env, timeoutMs: 900_000, maxOutputBytes: 8 * 1024 * 1024,
    })
    if (observed.exitCode !== 0 || observed.timedOut || observed.outputOverflow || observed.infrastructureFailure || observed.unsafeOutputDetected) fail('external_dependency_drift', 'live go mod verify failed')
    verification[repository] = sha256(canonicalJson({ stdout_digest: observed.stdoutDigest, stderr_digest: observed.stderrDigest, exit_code: observed.exitCode }))
  }
  return liveExternalDependencySet(roots, verification, goModuleCache)
}

const STARTUP_INJECTION_KEYS = [
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'TSX_TSCONFIG_PATH',
  'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
] as const

export function buildPhase1CommandEnvironment(
  command: Phase1Command,
  roots: { cc: string; sub: string; contract: string },
  runtime: { goBuildCache: string; goModuleCache: string },
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  for (const name of STARTUP_INJECTION_KEYS) {
    if ((inherited[name] ?? '') !== '') fail('unsafe_full_suite_environment', `${name} is forbidden at the H1 launch boundary`)
  }
  if (!path.isAbsolute(runtime.goBuildCache)
    || !runtime.goBuildCache.startsWith('/tmp/oracle-lab-phase1-go-build-')
    || runtime.goBuildCache.includes('caller-selected')) {
    fail('unsafe_full_suite_build_cache', 'GOCACHE is not one command-scoped exclusive directory')
  }
  if (!path.isAbsolute(runtime.goModuleCache)) fail('external_dependency_drift', 'GOMODCACHE is not an authenticated absolute root')
  const declared = Object.fromEntries(Object.entries(command.env).map(([name, value]) => [name, expandToken(value, roots)]))
  const contractRow = command.id === 'cc-tests' || command.id === 'cc-tests-repeat'
  const env: Record<string, string> = {
    ...declared,
    PATH: `${roots.cc}/node_modules/.bin:${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
    HOME: '/tmp', TMPDIR: '/tmp', LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
    npm_config_userconfig: '/dev/null',
    npm_config_globalconfig: '/nonexistent/oracle-lab-empty-global-npmrc',
    npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false',
    GOENV: 'off', GOFLAGS: '-mod=readonly', GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local',
    GOMODCACHE: runtime.goModuleCache, GOCACHE: runtime.goBuildCache,
  }
  if (contractRow) {
    delete env.SUB2API_ROOT
    env.SUB2API_FORMAL_POOL_CONTRACT_PATH = `${roots.contract}/backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json`
  } else {
    delete env.SUB2API_FORMAL_POOL_CONTRACT_PATH
    env.SUB2API_ROOT = command.id === 'cc-b4-b6-red' ? roots.contract : roots.sub
  }
  return env
}

const RED_CHILD_SOURCE = String.raw`
const { spawn } = require('node:child_process')
const { createHash } = require('node:crypto')
const { gzipSync } = require('node:zlib')
const options = JSON.parse(Buffer.from(process.argv[1], 'base64url').toString('utf8'))
const child = spawn(options.argv[0], options.argv.slice(1), { cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
const chunks = { stdout: [], stderr: [] }; let bytes = 0; let overflow = false
for (const name of ['stdout', 'stderr']) child[name].on('data', (chunk) => { bytes += chunk.length; if (bytes > 8388608) { overflow = true; child.kill('SIGKILL') } else chunks[name].push(chunk) })
child.on('error', (error) => { process.stderr.write(String(error.code || error.message)); process.exit(125) })
child.on('close', async (code, signal) => {
  try {
    if (overflow || signal) throw Object.assign(new Error('child overflow or signal'), { code: 'red_runner_output_incomplete' })
    const stdout = Buffer.concat(chunks.stdout); const stderr = Buffer.concat(chunks.stderr)
    const unsafe = /(?:ORACLE[_-]?SECRET[_-]?CANARY|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\bsk-[A-Za-z0-9_-]{8,}|\bBearer\s+[A-Za-z0-9._~+\/-]{4,}|\b(?:Cookie|Set-Cookie|Authorization)\s*:|\b(?:TOKEN|SECRET|API_KEY)\s*[:=]\s*[^\s"']+)/i.test(Buffer.concat([stdout, stderr]).toString('utf8'))
    if (unsafe) throw Object.assign(new Error('unsafe child output'), { code: 'unsafe_artifact' })
    const module = await import(options.module)
    const parsed = module.parsePhase1RedFailureLeaves({ parser: options.parser, stdout, stderr })
    const meta = { stdout_digest: 'sha256:' + createHash('sha256').update(stdout).digest('hex'), stderr_digest: 'sha256:' + createHash('sha256').update(stderr).digest('hex'), output_bytes: bytes, parsed }
    process.stdout.write('PHASE1_META ' + gzipSync(Buffer.from(JSON.stringify(meta))).toString('base64url') + '\n')
    process.exitCode = Number.isInteger(code) ? code : 125
  } catch (error) { process.stderr.write(String(error.code || error.message)); process.exitCode = 125 }
})
`

function runCatalogProcess(
  command: Phase1Command,
  roots: { cc: string; sub: string; contract: string },
  sandbox: Phase1LoopbackSandbox,
  runner: typeof runBoundedProcess,
  runtime: { goBuildCache: string; goModuleCache: string },
): { observed: BoundedProcessResult; stdoutDigest: string; stderrDigest: string; outputBytes: number; parsed?: Phase1RedParseResult } {
  const cwd = expandToken(command.cwd, roots)
  const rawArgv = command.argv.map((part) => expandToken(part, roots))
  rawArgv[0] = reviewedTool(rawArgv[0])
  const env = buildPhase1CommandEnvironment(command, roots, runtime)
  let invocation = rawArgv
  if (command.group === 'phase1-red') {
    const helperOptions = Buffer.from(JSON.stringify({ argv: rawArgv, cwd, env, parser: command.failure_parser, module: pathToFileURL(fileURLToPath(import.meta.url)).href })).toString('base64url')
    invocation = [process.execPath, '-e', RED_CHILD_SOURCE, helperOptions]
  }
  const observed = runner({
    argv: wrapPhase1Command({ executable: sandbox.executable, profilePath: sandbox.profile_path, argv: invocation }),
    cwd,
    env,
    timeoutMs: command.timeout_ms,
    maxOutputBytes: command.max_output_bytes,
  })
  if (command.group === 'phase1-green') return { observed, stdoutDigest: observed.stdoutDigest, stderrDigest: observed.stderrDigest, outputBytes: observed.outputBytes }
  const encoded = /^PHASE1_META ([A-Za-z0-9_-]+)/m.exec(observed.outputExcerpt)?.[1]
  if (!encoded) return { observed, stdoutDigest: observed.stdoutDigest, stderrDigest: observed.stderrDigest, outputBytes: observed.outputBytes }
  let meta: unknown
  try { meta = JSON.parse(gunzipSync(Buffer.from(encoded, 'base64url')).toString('utf8')) }
  catch { return fail('red_runner_output_incomplete', 'RED helper metadata is malformed') }
  if (!isObject(meta) || !validDigest(meta.stdout_digest) || !validDigest(meta.stderr_digest) || !Number.isSafeInteger(meta.output_bytes) || !isObject(meta.parsed)
    || !Array.isArray(meta.parsed.failure_events) || !isObject(meta.parsed.lifecycle)) fail('red_runner_output_incomplete', 'RED helper metadata is incomplete')
  return { observed, stdoutDigest: meta.stdout_digest, stderrDigest: meta.stderr_digest, outputBytes: Number(meta.output_bytes), parsed: meta.parsed as unknown as Phase1RedParseResult }
}

function ignoredRecords(binding: Phase1IgnoredStateBinding): readonly Phase1IgnoredRecord[] {
  return internalIgnored(binding)[IGNORED_RECORDS]
}

function controllerTransition(stage: 'feature-candidate' | 'post-integration', before: Phase1IgnoredStateBinding, after: Phase1IgnoredStateBinding, ccTransition?: Phase1IgnoredStateTransition): Record<string, unknown> {
  if (stage === 'feature-candidate') {
    if (!ccTransition || !same(before, ccTransition.before) || !same(after, ccTransition.after)) fail('ignored_state_drift', 'controller alias does not equal tested CC transition')
    return { policy: 'controller_alias_cc_gateway_v1', policy_digest: sha256(canonicalJson({ policy: 'controller_alias_cc_gateway_v1' })), before, after }
  }
  return comparePhase1IgnoredState({ repository: 'cc_gateway', before, after, policy: 'none' })
}

function liveExecutionContextChain(controllerRoot: string, ccRoot: string, subRoot: string): Phase1ContextNode[] {
  const head = reviewedGitText(controllerRoot, ['rev-parse', 'HEAD'])
  const names = runReviewedGit(controllerRoot, ['ls-tree', '-r', '--name-only', '-z', head, 'docs/superpowers/evidence/phase-1']).stdout
    .toString('utf8').split('\0').filter((name) => name === 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json'
      || /^docs\/superpowers\/evidence\/phase-1\/phase-1-execution-context-[0-9]{4}\.json$/.test(name))
  const values = names.map((name) => {
    const bytes = runReviewedGit(controllerRoot, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${head}:${name}`]).stdout
    let value: Record<string, unknown>
    try { value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown> } catch { return fail('context_schema_invalid', `${name} is malformed`) }
    return { name, bytes, value }
  }).sort((left, right) => Number(left.value.sequence) - Number(right.value.sequence))
  return values.map(({ name, bytes, value }, index) => {
    const introductions = reviewedGitText(controllerRoot, ['log', '--format=%H', '--diff-filter=A', '--', name]).split(/\r?\n/).filter(Boolean)
    const artifactCommit = introductions[0] ?? ''
    const latestTouch = reviewedGitText(controllerRoot, ['log', '-1', '--format=%H', '--', name])
    const parents = artifactCommit ? reviewedGitText(controllerRoot, ['show', '-s', '--format=%P', artifactCommit]).split(' ').filter(Boolean) : []
    const delta = artifactCommit ? runReviewedGit(controllerRoot, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-z', artifactCommit]).stdout.toString('utf8').split('\0').filter(Boolean) : []
    const expectedDelta = index === 0
      ? ['A', 'docs/superpowers/evidence/phase-1/phase-1-execution-context.json', 'A', 'docs/superpowers/evidence/phase-1/phase-1-plan-review.json']
      : ['A', name]
    let headsDescend = true
    if (index > 0) {
      const prior = values[index - 1].value.repositories; const current = value.repositories
      if (!isObject(prior) || !isObject(current) || !isObject(prior.cc_gateway) || !isObject(current.cc_gateway) || !isObject(prior.sub2api) || !isObject(current.sub2api)) headsDescend = false
      else headsDescend = reviewedGitAncestor(ccRoot, String(prior.cc_gateway.authorized_parent_head), String(current.cc_gateway.authorized_parent_head))
        && reviewedGitAncestor(subRoot, String(prior.sub2api.authorized_parent_head), String(current.sub2api.authorized_parent_head))
    }
    return {
      path: name, digest: sha256(bytes), artifact_commit: artifactCommit,
      introduced_once: introductions.length === 1, unchanged_after: artifactCommit === latestTouch,
      commit_parent_valid: parents.length === 1, commit_delta_valid: same(delta, expectedDelta),
      repository_heads_descend: headsDescend, value,
    }
  })
}

function validateContextAuthorityFiles(root: string, context: Record<string, unknown>, entryPath?: string): void {
  if (!isObject(context.plan) || typeof context.plan.path !== 'string' || !DIGEST_RE.test(String(context.plan.digest)) || !COMMIT_RE.test(String(context.plan.reviewed_commit))) fail('context_binding_drift', 'context plan binding is invalid')
  const workingPlan = readFileSync(path.resolve(root, context.plan.path))
  const reviewedPlan = runReviewedGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${context.plan.reviewed_commit}:${context.plan.path}`]).stdout
  if (sha256(workingPlan) !== context.plan.digest || sha256(reviewedPlan) !== context.plan.digest) fail('context_remote_authority_drift', 'working/reviewed plan bytes drifted')
  if (!isObject(context.approval_receipt) || !isObject(context.approval_receipt.artifact) || context.approval_receipt.decision !== 'approved'
    || context.approval_receipt.critical_findings !== 0 || context.approval_receipt.important_findings !== 0) fail('context_approval_invalid', 'plan approval is absent or blocking')
  const approval = rawArtifactBinding(root, String(context.approval_receipt.artifact.path))
  if (!same(approval, context.approval_receipt.artifact)) fail('context_approval_invalid', 'plan approval bytes drifted')
  const review = JSON.parse(readFileSync(path.resolve(root, approval.path), 'utf8')) as Record<string, unknown>
  if (review.decision !== 'approved' || !isObject(review.finding_counts) || review.finding_counts.critical !== 0 || review.finding_counts.important !== 0 || !same(review.plan, context.plan)) fail('context_approval_invalid', 'plan review semantic binding drifted')
  if (!isObject(context.gate_schemas)) fail('context_schema_binding_drift', 'gate schema bindings are absent')
  for (const binding of Object.values(context.gate_schemas)) {
    if (!isObject(binding) || typeof binding.path !== 'string' || rawArtifactBinding(root, binding.path).digest !== binding.digest) fail('context_schema_binding_drift', 'gate schema bytes drifted')
  }
  if (!same(context.disabled_capabilities, DISABLED_CAPABILITIES)) fail('context_binding_drift', 'disabled capabilities drifted')
  if (entryPath) {
    if (!isObject(context.planning_provenance) || !isObject(context.planning_provenance.entry)) fail('context_binding_drift', 'planning entry provenance is absent')
    const binding = rawArtifactBinding(root, entryPath)
    if (!same(binding, context.planning_provenance.entry)) fail('context_binding_drift', 'planning entry bytes drifted')
  }
}

export function derivePhase1StageAuthorityHeads(
  value: Record<string, unknown>,
  stage: 'feature-candidate' | 'post-integration',
): { expectedSub: string; contractHead: string; contractOriginDigest: string; integratedCC?: string } {
  const authorityRepositories = stage === 'feature-candidate' ? value.repositories : value.remote_mains
  if (!isObject(authorityRepositories) || !isObject(authorityRepositories.cc_gateway) || !isObject(authorityRepositories.sub2api)) {
    fail('context_schema_invalid', 'stage authority repository bindings are absent')
  }
  const expectedSub = stage === 'feature-candidate'
    ? String(authorityRepositories.sub2api.authorized_parent_head ?? '')
    : String(authorityRepositories.sub2api.integrated_head ?? '')
  const contractHead = stage === 'feature-candidate'
    ? String(authorityRepositories.sub2api.baseline_main_head ?? '')
    : expectedSub
  const contractOriginDigest = stage === 'feature-candidate'
    ? String(authorityRepositories.sub2api.remote_url_digest ?? '')
    : String(authorityRepositories.sub2api.origin_url_digest ?? '')
  const integratedCC = stage === 'post-integration'
    ? String(authorityRepositories.cc_gateway.integrated_head ?? '')
    : undefined
  if (!COMMIT_RE.test(expectedSub) || !COMMIT_RE.test(contractHead) || !DIGEST_RE.test(contractOriginDigest)
    || (integratedCC !== undefined && !COMMIT_RE.test(integratedCC))) {
    fail('context_binding_drift', 'stage authority head/origin bindings are invalid')
  }
  return { expectedSub, contractHead, contractOriginDigest, integratedCC }
}

function validatePostIntegrationEntryAuthority(root: string, entry: Record<string, unknown>, selectedPath: string, now: Date): void {
  const validation = validatePhase1IntegrationEntryValue(entry)
  if (!validation.ok) fail('integration_entry_mismatch', JSON.stringify(validation.errors))
  if (!isObject(entry.attempt) || selectedPath !== expectedAttemptPath(entry.attempt, 'phase-1-integration-entry.json')) fail('attempt_chain_invalid', 'integration-entry path does not match its attempt')
  const generated = Date.parse(String(entry.generated_at)); const expires = Date.parse(String(entry.expires_at))
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > now.getTime() || now.getTime() >= expires
    || expires - generated !== 24 * 60 * 60 * 1000) fail('stale_execution_context', 'integration entry is not in its exact live window')
  if (!isObject(entry.catalog) || entry.catalog.path !== 'docs/superpowers/registry/oracle-lab-phase-1-command-catalog.json'
    || entry.catalog.digest !== CATALOG_DIGEST) fail('red_evidence_mismatch', 'integration-entry catalog binding drifted')
  const catalogBinding = rawArtifactBinding(root, String(entry.catalog.path))
  if (!same(catalogBinding, entry.catalog)) fail('red_evidence_mismatch', 'integration-entry catalog bytes drifted')
  const catalog = readPhase1Catalog(path.resolve(root, catalogBinding.path))
  const bindings = ['context', 'plan_review', 'feature_results', 'feature_review'] as const
  for (const field of bindings) {
    const binding = entry[field]
    if (!isObject(binding) || typeof binding.path !== 'string' || !same(rawArtifactBinding(root, binding.path), { path: binding.path, digest: binding.digest })) {
      fail(field === 'feature_results' ? 'red_evidence_mismatch' : 'integration_entry_mismatch', `${field} bytes drifted from integration entry`)
    }
  }
  const featureResults = JSON.parse(readFileSync(path.resolve(root, String((entry.feature_results as Record<string, unknown>).path)), 'utf8')) as Record<string, unknown>
  const resultsValidation = validatePhase1ResultsValue(featureResults, { catalog })
  if (!resultsValidation.ok || featureResults.stage !== 'feature-candidate') fail('red_evidence_mismatch', 'integration-entry feature results are invalid')
  const featureReview = JSON.parse(readFileSync(path.resolve(root, String((entry.feature_review as Record<string, unknown>).path)), 'utf8')) as Record<string, unknown>
  const reviewValidation = validatePhase1FeatureReviewValue(featureReview)
  if (!reviewValidation.ok || !same(featureReview.feature_results, entry.feature_results)
    || !same(featureReview.context, entry.context) || !same(featureReview.plan_review, entry.plan_review)
    || !same(featureReview.candidate_heads, entry.candidate_heads)
    || !isObject(featureReview.implementation_trees) || !isObject(entry.implementation_trees)
    || !sameImplementationTreeContent(featureReview.implementation_trees.candidate_cc_gateway, entry.implementation_trees.cc_gateway)
    || !sameImplementationTreeContent(featureReview.implementation_trees.candidate_sub2api, entry.implementation_trees.sub2api)) {
    fail('feature_review_mismatch', 'integration-entry feature review bindings drifted')
  }
  if (!same(entry.disabled_capabilities, DISABLED_CAPABILITIES) || !isObject(entry.shared_contract)
    || entry.shared_contract.digest !== 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1') fail('integration_entry_mismatch', 'entry capability or contract binding drifted')
  const receiptHistory = inspectPhase1ReceiptHistory(root)
  const predecessor = entry.attempt.predecessor
  validatePhase1AttemptChain({
    committed: receiptHistory.map((node) => ({
      attempt_id: node.attempt_id, path: node.path, digest: node.digest, receipt_commit: node.receipt_commit,
      introduced_once: true, present_unchanged: true, ancestor: true, child_topology_valid: true,
    })),
    requested: entry.attempt.attempt_id,
    predecessor,
  })
}

function captureAuthority(options: {
  stage: 'feature-candidate' | 'post-integration'
  controllerRoot: string
  ccGatewayRoot: string
  sub2apiRoot: string
  entryPath?: string
  executionContextPath?: string
  integrationEntryPath?: string
  now: Date
}): { value: Record<string, unknown>; binding: Record<string, unknown>; expectedCC: string; expectedSub: string; contractHead: string; contractOriginDigest: string } {
  const selected = options.stage === 'feature-candidate' ? options.executionContextPath : options.integrationEntryPath
  if (!selected) fail('context_chain_gap', 'stage authority artifact is required')
  const absolute = path.resolve(options.controllerRoot, selected)
  if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink()) fail('context_symlink', 'stage authority is missing or a symlink')
  const value = JSON.parse(readFileSync(absolute, 'utf8')) as Record<string, unknown>
  if (options.stage === 'feature-candidate') {
    const chain = liveExecutionContextChain(options.controllerRoot, options.ccGatewayRoot, options.sub2apiRoot)
    const selectedNode = selectLatestPhase1ExecutionContext({ contexts: chain, selectedPath: relativeToRoot(options.controllerRoot, absolute), expectedStage: 'feature_capture', now: options.now.toISOString() })
    if (selectedNode.digest !== sha256(readFileSync(absolute))) fail('predecessor_context_mutated', 'selected working context differs from committed bytes')
    validateContextAuthorityFiles(options.controllerRoot, value, options.entryPath)
  } else {
    validatePostIntegrationEntryAuthority(options.controllerRoot, value, relativeToRoot(options.controllerRoot, absolute), options.now)
  }
  const heads = derivePhase1StageAuthorityHeads(value, options.stage)
  const expectedCC = options.stage === 'feature-candidate'
    ? reviewedGitText(options.ccGatewayRoot, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'])
    : heads.integratedCC!
  if (!COMMIT_RE.test(expectedCC)) fail('context_binding_drift', 'stage authority CC head binding is invalid')
  return {
    value,
    binding: options.stage === 'feature-candidate'
      ? {
          path: relativeToRoot(options.controllerRoot, absolute), digest: sha256(readFileSync(absolute)),
          sequence: Number(value.sequence), stage: String(value.stage), artifact_commit: expectedCC,
        }
      : {
          path: relativeToRoot(options.controllerRoot, absolute), digest: sha256(readFileSync(absolute)),
          sequence: Number(isObject(value.attempt) ? value.attempt.sequence : 0),
          stage: 'post_integration', artifact_commit: expectedCC,
        },
    expectedCC,
    expectedSub: heads.expectedSub,
    contractHead: heads.contractHead,
    contractOriginDigest: heads.contractOriginDigest,
  }
}

function contractRootBinding(rootInput: string, forbiddenRoots: readonly string[], expectedHead: string, expectedOriginDigest: string): Record<string, unknown> {
  const root = realpathSync(rootInput)
  if (forbiddenRoots.some((candidate) => realpathSync(candidate) === root)) fail('contract_root_not_authorized', 'contract clone aliases an implementation/controller root')
  const gitDir = realpathSync(reviewedGitText(root, ['rev-parse', '--path-format=absolute', '--git-dir']))
  const common = realpathSync(reviewedGitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  if (gitDir !== common || gitDir !== realpathSync(path.join(root, '.git')) || !lstatSync(gitDir).isDirectory()) fail('contract_root_not_authorized', 'contract root is not an independent clone')
  const snapshot = repositorySnapshot(root, 'sub2api')
  const branch = reviewedGitText(root, ['branch', '--show-current'])
  const origin = reviewedGitText(root, ['remote', 'get-url', 'muqihang'])
  const contractRelative = 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
  if (snapshot.status.length !== 0 || snapshot.head !== expectedHead || branch !== 'main' || sha256(origin) !== expectedOriginDigest
    || sha256(readFileSync(path.join(root, contractRelative))) !== 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1') {
    fail('contract_root_not_authorized', 'contract root binding drifted')
  }
  return {
    repository: 'sub2api', clone_kind: 'independent_clone', branch: 'main', head: snapshot.head,
    origin_url_digest: expectedOriginDigest, root_identity_digest: snapshot.root_identity_digest,
    clean_status_digest: sha256(''), contract_relative_path: contractRelative,
    contract_digest: 'sha256:70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
  }
}

function outputPaths(stage: 'feature-candidate' | 'post-integration', baseline: string, results: string): void {
  const expected = stage === 'feature-candidate'
    ? /^docs\/superpowers\/evidence\/phase-1\/(feature-[0-9]{4})\/phase-1-feature-(?:baseline|command-results)\.json$/
    : /^docs\/superpowers\/evidence\/phase-1\/(attempt-[0-9]{4})\/phase-1-(?:exit-baseline|command-results)\.json$/
  const left = expected.exec(baseline); const right = expected.exec(results)
  if (!left || !right || left[1] !== right[1] || baseline === results) fail('artifact_path_escape', 'capture outputs do not share one closed attempt namespace')
}

export function captureAndRunPhase1(options: {
  stage: 'feature-candidate' | 'post-integration'
  controllerRoot: string
  ccGatewayRoot: string
  sub2apiRoot: string
  sub2apiContractRoot: string
  entryPath?: string
  executionContextPath?: string
  integrationEntryPath?: string
  catalogPath: string
  baselineOut: string
  resultsOut: string
  now?: string
  runner?: typeof runBoundedProcess
  sandbox?: Phase1LoopbackSandbox
}): { baseline: Phase1ExitBaseline; results: Phase1Results } {
  if (options.stage === 'feature-candidate') {
    if (!options.entryPath || !options.executionContextPath || options.integrationEntryPath !== undefined || realpathSync(options.controllerRoot) !== realpathSync(options.ccGatewayRoot)) fail('capture_root_not_authorized', 'feature capture requires entry/context and one controller/tested CC root')
  } else if (options.stage === 'post-integration') {
    if (!options.integrationEntryPath || options.entryPath !== undefined || options.executionContextPath !== undefined || realpathSync(options.controllerRoot) === realpathSync(options.ccGatewayRoot)) fail('capture_root_not_authorized', 'post-integration capture requires only a distinct integration-entry controller')
  } else fail('capture_root_not_authorized', 'capture stage is unsupported')
  const controllerRoot = realpathSync(options.controllerRoot)
  const ccRoot = realpathSync(options.ccGatewayRoot)
  const subRoot = realpathSync(options.sub2apiRoot)
  const contractRoot = realpathSync(options.sub2apiContractRoot)
  const now = new Date(options.now ?? new Date().toISOString())
  if (!Number.isFinite(now.getTime())) fail('invalid_timestamp', 'capture time is invalid')
  outputPaths(options.stage, relativeToRoot(controllerRoot, options.baselineOut), relativeToRoot(controllerRoot, options.resultsOut))
  if (existsSync(path.resolve(controllerRoot, options.baselineOut)) || existsSync(path.resolve(controllerRoot, options.resultsOut))) fail('artifact_exists', 'capture outputs must be absent before the first command')
  let initialController = repositorySnapshot(controllerRoot, 'cc_gateway')
  let initialCC = controllerRoot === ccRoot ? initialController : repositorySnapshot(ccRoot, 'cc_gateway')
  let initialSub = repositorySnapshot(subRoot, 'sub2api')
  const expectedControllerStatus = options.stage === 'post-integration' && options.integrationEntryPath ? [`?? ${relativeToRoot(controllerRoot, options.integrationEntryPath)}`] : []
  validatePhase1CaptureInputs({
    stage: options.stage, controllerStatus: initialController.status, ccGatewayStatus: initialCC.status,
    sub2apiStatus: initialSub.status, controllerEqualsCCTestedRoot: controllerRoot === ccRoot,
    entryPath: options.integrationEntryPath ? relativeToRoot(controllerRoot, options.integrationEntryPath) : undefined,
  })
  const authority = captureAuthority({ ...options, controllerRoot, ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, now })
  if (initialCC.head !== authority.expectedCC || initialSub.head !== authority.expectedSub) fail('context_head_mismatch', 'tested repository heads differ from stage authority')
  const contract = contractRootBinding(contractRoot, [controllerRoot, ccRoot, subRoot], authority.contractHead, authority.contractOriginDigest)
  const catalog = readPhase1Catalog(path.resolve(controllerRoot, options.catalogPath))
  const sandbox = options.sandbox ?? resolvePhase1LoopbackSandbox()
  const canaries = runPhase1SandboxCanaries(sandbox)
  const sandboxEvidence = sandboxBinding(sandbox, canaries)
  const sandboxPolicyDigest = String(sandboxEvidence.policy_digest)
  const roots = { cc: ccRoot, sub: subRoot, contract: contractRoot }
  const runner = options.runner ?? runBoundedProcess
  const goModuleCache = reviewedGoModuleCache()
  const authorizedController = initialController
  const authorizedCC = initialCC
  const authorizedSub = initialSub
  const prepared = preparePhase1ExternalDependencies({
    ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, sandbox, runner, goModuleCache,
  })
  initialController = repositorySnapshot(controllerRoot, 'cc_gateway')
  initialCC = controllerRoot === ccRoot ? initialController : repositorySnapshot(ccRoot, 'cc_gateway')
  initialSub = repositorySnapshot(subRoot, 'sub2api')
  immutableSnapshot(authorizedController, initialController, expectedControllerStatus)
  immutableSnapshot(authorizedCC, initialCC, [])
  immutableSnapshot(authorizedSub, initialSub, [])
  let controllerIgnored = initialController.ignored
  let ccIgnored = initialCC.ignored
  let subIgnored = initialSub.ignored
  let externalDependencies = prepared.dependencies
  const records: Record<string, unknown>[] = []
  const transitionTriples: Record<string, unknown>[] = []
  const externalTransitions: Phase1ExternalDependencyTransition[] = []
  for (const command of catalog) {
    const beforeController = repositorySnapshot(controllerRoot, 'cc_gateway')
    const beforeCC = controllerRoot === ccRoot ? beforeController : repositorySnapshot(ccRoot, 'cc_gateway')
    const beforeSub = repositorySnapshot(subRoot, 'sub2api')
    immutableSnapshot(initialController, beforeController, expectedControllerStatus)
    immutableSnapshot(initialCC, beforeCC, [])
    immutableSnapshot(initialSub, beforeSub, [])
    if (!same(beforeController.ignored, controllerIgnored) || !same(beforeCC.ignored, ccIgnored) || !same(beforeSub.ignored, subIgnored)) fail('ignored_state_drift', 'ignored state changed between catalog rows')
    const beforeDependencies = liveExternalDependencySet(roots, prepared.verification, goModuleCache)
    if (!same(beforeDependencies, externalDependencies)) fail('external_dependency_drift', 'external dependency state changed between catalog rows')
    const processResult = runCatalogProcess(command, roots, sandbox, runner, {
      goBuildCache: createPhase1ExclusiveBuildCache(),
      goModuleCache,
    })
    const afterController = repositorySnapshot(controllerRoot, 'cc_gateway')
    const afterCC = controllerRoot === ccRoot ? afterController : repositorySnapshot(ccRoot, 'cc_gateway')
    const afterSub = repositorySnapshot(subRoot, 'sub2api')
    immutableSnapshot(initialController, afterController, expectedControllerStatus)
    immutableSnapshot(initialCC, afterCC, [])
    immutableSnapshot(initialSub, afterSub, [])
    const ccTransition = comparePhase1IgnoredState({ repository: 'cc_gateway', before: beforeCC.ignored, after: afterCC.ignored, policy: command.ignored_output_policies.cc_gateway })
    const subTransition = comparePhase1IgnoredState({ repository: 'sub2api', before: beforeSub.ignored, after: afterSub.ignored, policy: command.ignored_output_policies.sub2api })
    const controllerIgnoredTransition = controllerTransition(options.stage, beforeController.ignored, afterController.ignored, controllerRoot === ccRoot ? ccTransition : undefined)
    const afterDependencies = liveExternalDependencySet(roots, prepared.verification, goModuleCache)
    if (!same(beforeDependencies, afterDependencies)) fail('external_dependency_drift', `${command.id} changed external dependency authority`)
    const externalDependencyTransition: Phase1ExternalDependencyTransition = {
      before: beforeDependencies, after: afterDependencies,
      ephemeral_build_cache_token: 'command_scoped_empty_mkdtemp_v1',
    }
    const classification = classifyPhase1Result({
      command,
      exitCode: processResult.observed.exitCode,
      stdout: '', stderr: '',
      failureEvents: processResult.parsed?.failure_events ?? [],
      parserLifecycle: processResult.parsed?.lifecycle ?? null,
      timedOut: processResult.observed.timedOut,
      outputOverflow: processResult.observed.outputOverflow,
      unsafeOutputDetected: processResult.observed.unsafeOutputDetected,
      networkPolicyViolations: 0,
    })
    if (classification.status !== (command.group === 'phase1-green' ? 'pass' : 'expected_fail')) fail('unexpected_result_status', `${command.id} did not produce its exact reviewed outcome`)
    const base = {
      command_id: command.id, repository: command.repository,
      repository_commit: command.repository === 'sub2api' ? initialSub.head : initialCC.head,
      exit_code: processResult.observed.exitCode, status: classification.status,
      stdout_digest: processResult.stdoutDigest, stderr_digest: processResult.stderrDigest,
      failure_parser: classification.failure_parser, parser_lifecycle: classification.parser_lifecycle,
      failure_event_count: classification.failure_event_count, failure_event_names: classification.failure_event_names,
      failure_count: classification.failure_count, failure_names: classification.failure_names,
      observed_failure_families: classification.observed_failure_families,
      unclassified_failure_names: classification.unclassified_failure_names,
      sandbox_policy_digest: sandboxPolicyDigest, network_policy_violations: 0,
      unsafe_output_detected: processResult.observed.unsafeOutputDetected,
      ignored_state_transitions: { controller: controllerIgnoredTransition, cc_gateway: ccTransition, sub2api: subTransition },
      external_dependency_transition: externalDependencyTransition,
    }
    const record = { ...base, result_digest: sha256(canonicalJson(base)) }
    records.push(record)
    transitionTriples.push(record.ignored_state_transitions)
    externalTransitions.push(externalDependencyTransition)
    controllerIgnored = afterController.ignored; ccIgnored = afterCC.ignored; subIgnored = afterSub.ignored
    externalDependencies = afterDependencies
  }
  const generatedAt = now.toISOString()
  const catalogBinding = { path: relativeToRoot(controllerRoot, path.resolve(controllerRoot, options.catalogPath)), digest: CATALOG_DIGEST }
  const rootEnvelope = {
    roots: {
      controller: {
        stage: options.stage, head: initialController.head, root_identity_digest: initialController.root_identity_digest,
        same_as_tested_cc_root: controllerRoot === ccRoot, preexisting_delta_paths: expectedControllerStatus.map((entry) => entry.slice(3)),
        declared_output_paths: [relativeToRoot(controllerRoot, options.baselineOut), relativeToRoot(controllerRoot, options.resultsOut)],
      },
      cc_gateway: { head: initialCC.head, root_identity_digest: initialCC.root_identity_digest, clean_status_digest: sha256('') },
      sub2api: { head: initialSub.head, root_identity_digest: initialSub.root_identity_digest, clean_status_digest: sha256('') },
    },
    sub2api_contract_root: contract,
    implementation_trees: { cc_gateway: initialCC.implementation_tree, sub2api: initialSub.implementation_tree },
    ignored_state: { controller: initialController.ignored, cc_gateway: initialCC.ignored, sub2api: initialSub.ignored },
    external_dependencies: prepared.dependencies,
  }
  const baselineBase = {
    schema_version: 1, artifact_kind: 'phase_1_exit_baseline', stage: options.stage,
    generated_at: generatedAt, captured_at: generatedAt, catalog: catalogBinding, authority: authority.binding,
    ...rootEnvelope, sandbox: sandboxEvidence, disabled_capabilities: [...DISABLED_CAPABILITIES],
  }
  const baseline = { ...baselineBase, baseline_digest: sha256(canonicalJson(baselineBase)) }
  const resultsBase = {
    schema_version: 1, artifact_kind: 'phase_1_command_results', stage: options.stage,
    generated_at: generatedAt, captured_at: new Date().toISOString(), catalog: catalogBinding,
    baseline: { path: relativeToRoot(controllerRoot, options.baselineOut), digest: sha256(artifactBytes(baseline)) },
    authority: authority.binding, ...rootEnvelope, sandbox: sandboxEvidence,
    disabled_capabilities: [...DISABLED_CAPABILITIES], command_results: records,
    ignored_state_chain: {
      initial: rootEnvelope.ignored_state,
      final: { controller: controllerIgnored, cc_gateway: ccIgnored, sub2api: subIgnored },
      transition_count: 17, transitions_digest: sha256(canonicalJson(transitionTriples)),
    },
    external_dependency_chain: {
      initial: prepared.dependencies, final: externalDependencies,
      transition_count: 17, transitions_digest: sha256(canonicalJson(externalTransitions)),
    },
  }
  const results = { ...resultsBase, results_digest: sha256(canonicalJson(resultsBase)) }
  const validation = validatePhase1ResultsValue(results, { catalog })
  if (!validation.ok) fail(validation.errors[0]?.code ?? 'invalid_results', JSON.stringify(validation.errors))
  writeExclusivePair(controllerRoot, [
    { file: options.baselineOut, value: baseline },
    { file: options.resultsOut, value: results },
  ])
  return { baseline, results }
}

type Phase1CommandName =
  | 'validate-catalog' | 'validate-feature-review' | 'run-all' | 'validate-results'
  | 'build-integration-entry' | 'build-handoff' | 'validate-handoff'
  | 'build-integration-receipt' | 'validate-integration-receipt' | 'verify-final-remote'

const CLI_FLAGS: Record<Phase1CommandName, readonly string[]> = {
  'validate-catalog': ['catalog'],
  'validate-feature-review': ['catalog', 'controller-root', 'sub2api-root', 'execution-context', 'plan-review', 'feature-baseline', 'feature-results', 'feature-review', 'reviewed-cc-candidate-head', 'reviewed-sub2api-candidate-head'],
  'run-all': ['stage', 'entry', 'execution-context', 'integration-entry', 'catalog', 'controller-root', 'cc-gateway-root', 'sub2api-root', 'sub2api-contract-root', 'baseline-out', 'results-out'],
  'validate-results': ['stage', 'entry', 'execution-context', 'integration-entry', 'catalog', 'controller-root', 'cc-gateway-root', 'sub2api-root', 'sub2api-contract-root', 'baseline', 'results'],
  'build-integration-entry': ['catalog', 'controller-root', 'attempt-id', 'previous-attempt-id', 'previous-attempt-receipt', 'previous-attempt-receipt-digest', 'previous-attempt-receipt-commit', 'cc-gateway-root', 'sub2api-root', 'sub2api-contract-root', 'execution-context', 'plan-review', 'feature-results', 'feature-review', 'reviewed-cc-candidate-head', 'reviewed-sub2api-candidate-head', 'cc-review-attestation-head', 'cc-pre-merge-main-head', 'sub2api-pre-merge-main-head', 'cc-merge-commit', 'sub2api-merge-commit', 'cc-remote', 'cc-remote-ref', 'cc-origin-digest', 'sub2api-remote', 'sub2api-remote-ref', 'sub2api-origin-digest', 'out'],
  'build-handoff': ['catalog', 'controller-root', 'cc-gateway-root', 'sub2api-root', 'sub2api-contract-root', 'integration-entry', 'baseline', 'results', 'registry', 'claims', 'observations', 'handoff-out', 'report-out'],
  'validate-handoff': ['catalog', 'controller-root', 'cc-gateway-root', 'sub2api-root', 'sub2api-contract-root', 'integration-entry', 'baseline', 'results', 'requirements', 'claims', 'observations', 'handoff', 'report'],
  'build-integration-receipt': ['catalog', 'controller-root', 'sub2api-root', 'artifact-commit', 'integration-entry', 'baseline', 'results', 'handoff', 'report', 'requirements', 'claims', 'observations', 'receipt-out'],
  'validate-integration-receipt': ['catalog', 'controller-root', 'sub2api-root', 'artifact-commit', 'receipt-commit', 'integration-entry', 'baseline', 'results', 'handoff', 'report', 'requirements', 'claims', 'observations', 'receipt'],
  'verify-final-remote': ['catalog', 'cc-gateway-root', 'sub2api-root', 'attempt-id', 'receipt', 'receipt-commit', 'cc-remote', 'cc-remote-ref', 'cc-origin-digest', 'sub2api-remote', 'sub2api-remote-ref', 'sub2api-origin-digest'],
}

const OPTIONAL_FLAGS: Partial<Record<Phase1CommandName, readonly string[]>> = {
  'run-all': ['entry', 'execution-context', 'integration-entry'],
  'validate-results': ['entry', 'execution-context', 'integration-entry'],
  'validate-integration-receipt': ['receipt-commit'],
}

export type Phase1CLIInvocation = { command: Phase1CommandName; values: Readonly<Record<string, string>> }

function safeCliValue(name: string, value: string): void {
  if (value.length === 0 || value.includes('\0') || value.includes('\r') || value.includes('\n')) fail('invalid_arguments', `--${name} is invalid`)
  if (name.includes('root')) {
    if (!path.isAbsolute(value)) fail('invalid_arguments', `--${name} must be absolute`)
    return
  }
  if (name.includes('digest')) {
    if (value !== 'none' && !DIGEST_RE.test(value)) fail('invalid_arguments', `--${name} must be a digest`)
    return
  }
  if (name.includes('head') || name.includes('commit')) {
    if (value !== 'none' && value !== 'HEAD' && !COMMIT_RE.test(value)) fail('invalid_arguments', `--${name} must be a commit`)
    return
  }
  if ((name.includes('entry') || name.includes('results') || name.includes('baseline') || name.includes('review') || name.includes('receipt') || name.includes('report') || name.includes('catalog') || name.includes('handoff') || name.includes('registry') || name === 'claims' || name === 'observations')
    && value !== 'none' && (path.isAbsolute(value) || value.includes('\\') || value.split('/').includes('..') || path.posix.normalize(value) !== value)) {
    fail('invalid_arguments', `--${name} must be repository-relative`)
  }
}

export function parsePhase1CLI(argv: readonly string[]): Phase1CLIInvocation {
  const tokens = argv[0] === '--' ? argv.slice(1) : [...argv]
  const [commandToken, ...rest] = tokens
  if (!commandToken || !(commandToken in CLI_FLAGS)) fail('invalid_arguments', 'unsupported Phase 1 subcommand')
  const command = commandToken as Phase1CommandName
  const parsed = parseArgs(rest)
  if (parsed.positionals.length !== 0) fail('invalid_arguments', 'positional arguments are forbidden')
  const permitted = new Set(CLI_FLAGS[command])
  const optional = new Set(OPTIONAL_FLAGS[command] ?? [])
  for (const name of Object.keys(parsed.values)) if (!permitted.has(name)) fail('invalid_arguments', `--${name} is not accepted by ${command}`)
  const values: Record<string, string> = {}
  for (const name of permitted) {
    const observed = parsed.values[name]
    if ((!observed || observed.length !== 1) && !optional.has(name)) fail('invalid_arguments', `--${name} is required exactly once`)
    if (observed && observed.length !== 1) fail('invalid_arguments', `--${name} may appear only once`)
    if (observed) {
      safeCliValue(name, observed[0])
      values[name] = observed[0]
    }
  }
  return { command, values: Object.freeze(values) }
}

export function readPhase1Catalog(file: string): Phase1Command[] {
  const value = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const validation = validatePhase1CatalogValue(value)
  if (!validation.ok) fail(validation.errors[0]?.code ?? 'invalid_catalog', JSON.stringify(validation.errors))
  return value as Phase1Command[]
}

function loadJson(root: string, relative: string): Record<string, unknown> {
  const absolute = path.resolve(root, relative)
  relativeToRoot(root, absolute)
  if (lstatSync(absolute).isSymbolicLink()) fail('artifact_symlink', 'input artifact is a symlink')
  const parsed = JSON.parse(readFileSync(absolute, 'utf8')) as unknown
  if (!isObject(parsed)) fail('invalid_artifact', `${relative} is not an object`)
  return parsed
}

function pathBinding(root: string, relative: string): { path: string; digest: string } {
  return { path: relativeToRoot(root, relative), digest: sha256(readFileSync(path.resolve(root, relative))) }
}

function writeOne(root: string, relative: string, value: unknown): void {
  const absolute = path.resolve(root, relative)
  relativeToRoot(root, absolute)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeExclusiveArtifact(absolute, value, path.join(root, 'docs/superpowers/evidence/phase-1'))
}

function assertActualReceiptTopology(root: string, artifactCommit: string, receiptCommit: string | undefined, receiptPath: string, receipt: Record<string, unknown>): void {
  if (!COMMIT_RE.test(artifactCommit)) fail('receipt_commit_mismatch', 'artifact commit is invalid')
  if (!receiptCommit) {
    if (reviewedGitText(root, ['rev-parse', 'HEAD']) !== artifactCommit || !same(repositoryStatus(root), [`?? ${receiptPath}`])) fail('receipt_commit_mismatch', 'pre-commit receipt boundary is invalid')
    return
  }
  const resolved = receiptCommit === 'HEAD' ? reviewedGitText(root, ['rev-parse', 'HEAD']) : receiptCommit
  const parents = reviewedGitText(root, ['show', '-s', '--format=%P', resolved]).split(' ').filter(Boolean)
  const delta = runReviewedGit(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-z', resolved]).stdout.toString('utf8').split('\0').filter(Boolean)
  const committedBytes = runReviewedGit(root, ['show', '--format=', '--no-ext-diff', '--no-textconv', `${resolved}:${receiptPath}`]).stdout
  if (!same(parents, [artifactCommit]) || !same(delta, ['A', receiptPath]) || !committedBytes.equals(artifactBytes(receipt))) fail('receipt_commit_mismatch', 'receipt commit is not the exact one-path child')
}

function committedJsonBinding(root: string, commitValue: string, binding: unknown): Record<string, unknown> {
  if (!isObject(binding) || typeof binding.path !== 'string' || !validDigest(binding.digest)) fail('artifact_source_chain_mismatch', 'committed artifact binding is malformed')
  relativeToRoot(root, binding.path)
  const bytes = committedArtifactBytes(root, commitValue, binding.path)
  if (sha256(bytes) !== binding.digest) fail('artifact_source_chain_mismatch', `${binding.path} committed digest drifted`)
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) } catch { return fail('artifact_source_chain_mismatch', `${binding.path} is malformed`) }
  if (!isObject(value)) fail('artifact_source_chain_mismatch', `${binding.path} is not an object`)
  return value
}

function finalRemoteLive(values: Readonly<Record<string, string>>): Record<string, unknown> {
  const ccRoot = realpathSync(values['cc-gateway-root'])
  const subRoot = realpathSync(values['sub2api-root'])
  if (repositoryStatus(ccRoot).length !== 0 || repositoryStatus(subRoot).length !== 0) fail('dirty_repository', 'final verification roots must be clean')
  if (reviewedGitText(ccRoot, ['branch', '--show-current']) !== '' || reviewedGitText(subRoot, ['branch', '--show-current']) !== '') fail('context_head_mismatch', 'final verification roots must be detached')
  const beforeCC = ignoredInventory(ccRoot, 'cc_gateway'); const beforeSub = ignoredInventory(subRoot, 'sub2api')
  const ccEndpoints = new Set(ignoredRecords(beforeCC).map((record) => record.path.split('/')[0]))
  const subEndpoints = new Set(ignoredRecords(beforeSub).map((record) => record.path.split('/')[0]))
  if ([...ccEndpoints].some((entry) => !['node_modules', '.codegraph'].includes(entry)) || [...subEndpoints].some((entry) => entry !== '.codegraph')) fail('final_verify_ignored_profile_invalid', 'final verification ignored endpoint profile drifted')
  const ccRemote = remoteObservation(ccRoot, values['cc-remote'], values['cc-remote-ref'], values['cc-origin-digest'])
  const subRemote = remoteObservation(subRoot, values['sub2api-remote'], values['sub2api-remote-ref'], values['sub2api-origin-digest'])
  const requestedCommit = values['receipt-commit']
  const requestedPath = values.receipt
  const history = inspectPhase1ReceiptHistory(ccRoot, ccRemote.integrated_head)
  const requested = history.find((node) => node.attempt_id === values['attempt-id'])
  if (!requested || requested.path !== requestedPath || requested.receipt_commit !== requestedCommit) fail('attempt_chain_invalid', 'requested receipt tuple is not in the immutable chain')
  const effective = history.at(-1)!
  const receiptCommit = effective.receipt_commit
  const receiptPath = effective.path
  const receiptBytes = effective.bytes
  const receipt = effective.value
  const receiptValidation = validatePhase1IntegrationReceiptValue(receipt)
  if (!receiptValidation.ok || !isObject(receipt.attempt) || receipt.attempt.attempt_id !== effective.attempt_id) fail('attempt_chain_invalid', 'effective receipt is invalid')
  if (!isObject(receipt.artifacts)) fail('artifact_source_chain_mismatch', 'effective receipt artifacts are absent')
  const entry = committedJsonBinding(ccRoot, receiptCommit, receipt.artifacts.integration_entry)
  const baseline = committedJsonBinding(ccRoot, receiptCommit, receipt.artifacts.baseline)
  const resultsValue = committedJsonBinding(ccRoot, receiptCommit, receipt.artifacts.results)
  const handoff = committedJsonBinding(ccRoot, receiptCommit, receipt.artifacts.handoff)
  if (!isObject(entry.catalog)) fail('artifact_source_chain_mismatch', 'integration entry catalog binding is absent')
  const catalog = committedJsonBinding(ccRoot, receiptCommit, entry.catalog)
  const featureResults = committedJsonBinding(ccRoot, receiptCommit, entry.feature_results)
  const featureReview = committedJsonBinding(ccRoot, receiptCommit, entry.feature_review)
  const chainBindings = {
    entry: receipt.artifacts.integration_entry as { path: string; digest: string },
    baseline: receipt.artifacts.baseline as { path: string; digest: string },
    results: receipt.artifacts.results as { path: string; digest: string },
    handoff: receipt.artifacts.handoff as { path: string; digest: string },
    featureResults: entry.feature_results as { path: string; digest: string },
    featureReview: entry.feature_review as { path: string; digest: string },
  }
  const chainValidation = validatePhase1CommittedArtifactChain({ catalog, featureResults, featureReview, entry, baseline, results: resultsValue, handoff, receipt, bindings: chainBindings })
  if (!chainValidation.ok) fail(chainValidation.errors[0]?.code ?? 'artifact_source_chain_mismatch', JSON.stringify(chainValidation.errors))
  if (!isObject(featureReview.feature_baseline) || !isObject(featureReview.context) || !isObject(featureReview.plan_review)) fail('feature_review_mismatch', 'feature review loaded-source bindings are absent')
  const featureBaseline = committedJsonBinding(ccRoot, receiptCommit, featureReview.feature_baseline)
  const context = committedJsonBinding(ccRoot, receiptCommit, featureReview.context)
  const planReview = committedJsonBinding(ccRoot, receiptCommit, featureReview.plan_review)
  if (!isObject(context.gate_schemas) || !isObject(context.gate_schemas.plan_review) || !isObject(context.gate_schemas.execution_context)
    || !isObject(context.planning_provenance) || !isObject(context.planning_provenance.entry) || !isObject(context.planning_provenance.context)) {
    fail('context_schema_binding_drift', 'committed context schema or planning provenance bindings are absent')
  }
  const planReviewSchema = committedJsonBinding(ccRoot, receiptCommit, context.gate_schemas.plan_review)
  const executionContextSchema = committedJsonBinding(ccRoot, receiptCommit, context.gate_schemas.execution_context)
  const evidenceDelta = isObject(entry.candidate_heads) ? commitDelta(ccRoot, String(entry.candidate_heads.cc_gateway)) : []
  const loadedReview = validatePhase1LoadedFeatureReview({
    catalog, featureBaseline, featureResults, context, planReview, planReviewSchema, executionContextSchema, featureReview,
    featureReviewPath: String((entry.feature_review as Record<string, unknown>).path), reviewMode: 'committed',
    liveStatuses: { cc_gateway: repositoryStatus(ccRoot), sub2api: repositoryStatus(subRoot) },
    bindings: {
      featureBaseline: featureReview.feature_baseline as { path: string; digest: string },
      featureResults: entry.feature_results as { path: string; digest: string },
      context: featureReview.context as { path: string; digest: string },
      planReview: featureReview.plan_review as { path: string; digest: string },
      planReviewSchema: context.gate_schemas.plan_review as { path: string; digest: string },
      executionContextSchema: context.gate_schemas.execution_context as { path: string; digest: string },
      planningEntry: context.planning_provenance.entry as { path: string; digest: string },
      planningContext: context.planning_provenance.context as { path: string; digest: string },
    },
    evidenceCommit: {
      tested_head: isObject(featureReview.tested_heads) ? featureReview.tested_heads.cc_gateway : '',
      candidate_head: isObject(entry.candidate_heads) ? entry.candidate_heads.cc_gateway : '',
      parents: isObject(entry.candidate_heads) ? reviewedGitText(ccRoot, ['show', '-s', '--format=%P', String(entry.candidate_heads.cc_gateway)]).split(' ').filter(Boolean) : [],
      added_paths: evidenceDelta.filter((item) => item.status === 'A').map((item) => item.path),
      bytes_match: evidenceDelta.length === 2 && evidenceDelta.every((item) => item.status === 'A'),
      sub2api_tested_head: isObject(featureReview.tested_heads) ? featureReview.tested_heads.sub2api : '',
      sub2api_candidate_head: isObject(entry.candidate_heads) ? entry.candidate_heads.sub2api : '',
    },
  })
  if (!loadedReview.ok) fail(loadedReview.errors[0]?.code ?? 'feature_review_mismatch', JSON.stringify(loadedReview.errors))
  if (!isObject(receipt.integrated_heads)) fail('attempt_chain_invalid', 'receipt integrated heads are absent')
  if (!isObject(receipt.shared_contract) || receipt.shared_contract.repository !== 'sub2api'
    || receipt.shared_contract.path !== 'backend/internal/service/testdata/cc_gateway_formal_pool_contract/vectors.json'
    || receipt.shared_contract.digest !== sha256(readFileSync(path.join(subRoot, String(receipt.shared_contract.path))))) {
    fail('contract_root_not_authorized', 'effective receipt shared contract differs from current Sub2API bytes')
  }
  const integratedCC = String(receipt.integrated_heads.cc_gateway); const integratedSub = String(receipt.integrated_heads.sub2api)
  if (!reviewedGitAncestor(ccRoot, integratedCC, ccRemote.integrated_head) || !reviewedGitAncestor(ccRoot, receiptCommit, ccRemote.integrated_head)
    || !reviewedGitAncestor(subRoot, integratedSub, subRemote.integrated_head)) fail('context_remote_rewind', 'remote main does not descend from receipt authority')
  if (!isObject(receipt.implementation_trees) || !isObject(receipt.implementation_trees.cc_gateway) || !isObject(receipt.implementation_trees.sub2api)) fail('phase1_implementation_drift', 'receipt tree bindings are absent')
  const currentCC = treeAt(ccRoot, 'cc_gateway', ccRemote.integrated_head); const currentSub = treeAt(subRoot, 'sub2api', subRemote.integrated_head)
  if (currentCC.entries_digest !== receipt.implementation_trees.cc_gateway.entries_digest || currentSub.entries_digest !== receipt.implementation_trees.sub2api.entries_digest) fail('phase1_implementation_drift', 'live implementation tree differs from receipt')
  const ccChanged = runReviewedGit(ccRoot, ['diff', '--name-only', '-z', integratedCC, ccRemote.integrated_head]).stdout.toString('utf8').split('\0').filter(Boolean)
  const subChanged = runReviewedGit(subRoot, ['diff', '--name-only', '-z', integratedSub, subRemote.integrated_head]).stdout.toString('utf8').split('\0').filter(Boolean)
  if (subChanged.length !== 0 || ccChanged.some((entry) => !entry.startsWith('docs/superpowers/evidence/phase-1/') && !CC_EXCLUDED_PATHS.includes(entry as never))) fail('phase1_implementation_drift', 'remote descendant contains a nonexcluded tracked change')
  const afterCC = ignoredInventory(ccRoot, 'cc_gateway'); const afterSub = ignoredInventory(subRoot, 'sub2api')
  if (!same(beforeCC, afterCC) || !same(beforeSub, afterSub)) fail('ignored_state_drift', 'ignored state changed during final verification')
  const sandbox = resolvePhase1LoopbackSandbox()
  const currentDependencies = verifyCurrentPhase1ExternalDependencies({ ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, sandbox })
  if (!isObject(receipt.external_dependency_reference)
    || !same(receipt.external_dependency_reference.final, currentDependencies)) fail('external_dependency_drift', 'live dependencies differ from the effective receipt')
  return {
    schema_version: 1, verification_kind: 'phase_1_final_remote', verified_at: new Date().toISOString(), decision: effective === requested ? 'ready' : 'superseded',
    attempt_id: effective.attempt_id, receipt: { path: receiptPath, digest: sha256(receiptBytes), commit: receiptCommit },
    repositories: { cc_gateway: ccRemote, sub2api: subRemote }, implementation_trees: { cc_gateway: currentCC, sub2api: currentSub },
    ignored_state: { cc_gateway: { before: beforeCC, after: afterCC }, sub2api: { before: beforeSub, after: afterSub } },
    latest_receipt_chain_head: { attempt_id: effective.attempt_id, path: receiptPath, commit: receiptCommit },
  }
}

function runCli(tokens: readonly string[]): void {
  const invocation = parsePhase1CLI(tokens)
  const v = invocation.values
  if (invocation.command === 'validate-catalog') {
    readPhase1Catalog(path.resolve(v.catalog))
  } else if (invocation.command === 'run-all') {
    captureAndRunPhase1({
      stage: v.stage as 'feature-candidate' | 'post-integration', controllerRoot: v['controller-root'],
      ccGatewayRoot: v['cc-gateway-root'], sub2apiRoot: v['sub2api-root'], sub2apiContractRoot: v['sub2api-contract-root'],
      entryPath: v.entry, executionContextPath: v['execution-context'], integrationEntryPath: v['integration-entry'],
      catalogPath: v.catalog, baselineOut: v['baseline-out'], resultsOut: v['results-out'],
    })
  } else if (invocation.command === 'validate-results') {
    const root = realpathSync(v['controller-root']); const catalog = readPhase1Catalog(path.resolve(root, v.catalog)); const resultsValue = loadJson(root, v.results)
    const baseline = loadJson(root, v.baseline)
    const ccRoot = realpathSync(v['cc-gateway-root']); const subRoot = realpathSync(v['sub2api-root']); const contractRoot = realpathSync(v['sub2api-contract-root'])
    const stage = v.stage as 'feature-candidate' | 'post-integration'
    const authority = captureAuthority({
      stage, controllerRoot: root, ccGatewayRoot: ccRoot, sub2apiRoot: subRoot,
      entryPath: v.entry, executionContextPath: v['execution-context'], integrationEntryPath: v['integration-entry'],
      now: new Date(String(resultsValue.captured_at)),
    })
    const controllerSnapshot = repositorySnapshot(root, 'cc_gateway')
    const ccSnapshot = root === ccRoot ? controllerSnapshot : repositorySnapshot(ccRoot, 'cc_gateway')
    const subSnapshot = repositorySnapshot(subRoot, 'sub2api')
    const contract = contractRootBinding(contractRoot, [root, ccRoot, subRoot], authority.contractHead, authority.contractOriginDigest)
    const persistedController = isObject(resultsValue.roots) && isObject(resultsValue.roots.controller) ? resultsValue.roots.controller : {}
    const roots = {
      controller: { ...persistedController, head: controllerSnapshot.head, root_identity_digest: controllerSnapshot.root_identity_digest },
      cc_gateway: { head: ccSnapshot.head, root_identity_digest: ccSnapshot.root_identity_digest, clean_status_digest: sha256('') },
      sub2api: { head: subSnapshot.head, root_identity_digest: subSnapshot.root_identity_digest, clean_status_digest: sha256('') },
    }
    const sandbox = resolvePhase1LoopbackSandbox()
    const dependencies = verifyCurrentPhase1ExternalDependencies({ ccGatewayRoot: ccRoot, sub2apiRoot: subRoot, sandbox })
    const validation = validatePhase1LoadedResultsAuthority({
      stage, catalog, baseline, results: resultsValue, authority: authority.binding, roots, contract,
      implementationTrees: { cc_gateway: ccSnapshot.implementation_tree, sub2api: subSnapshot.implementation_tree },
      ignoredFinal: { controller: controllerSnapshot.ignored, cc_gateway: ccSnapshot.ignored, sub2api: subSnapshot.ignored },
      externalDependencies: dependencies,
      controllerEqualsCC: root === ccRoot,
      outputPaths: {
        baseline: relativeToRoot(root, v.baseline), results: relativeToRoot(root, v.results),
        integrationEntry: stage === 'post-integration' ? relativeToRoot(root, v['integration-entry']) : undefined,
      },
      liveStatuses: { controller: controllerSnapshot.status, cc_gateway: ccSnapshot.status, sub2api: subSnapshot.status },
    })
    if (!validation.ok) fail(validation.errors[0]?.code ?? 'invalid_results', JSON.stringify(validation.errors))
  } else if (invocation.command === 'validate-feature-review') {
    const root = realpathSync(v['controller-root']); const catalog = readPhase1Catalog(path.resolve(root, v.catalog))
    const subRoot = realpathSync(v['sub2api-root'])
    const review = loadJson(root, v['feature-review'])
    const featureBaseline = loadJson(root, v['feature-baseline'])
    const featureResults = loadJson(root, v['feature-results'])
    const context = loadJson(root, v['execution-context'])
    const planReview = loadJson(root, v['plan-review'])
    const planReviewSchema = loadJson(root, 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json')
    const executionContextSchema = loadJson(root, 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json')
    if (!isObject(review.candidate_heads) || review.candidate_heads.cc_gateway !== v['reviewed-cc-candidate-head']
      || review.candidate_heads.sub2api !== v['reviewed-sub2api-candidate-head']) fail('feature_review_mismatch', 'candidate head flags drifted')
    const ccStatus = repositoryStatus(root); const subStatus = repositoryStatus(subRoot)
    if (subStatus.length !== 0 || reviewedGitText(subRoot, ['rev-parse', 'HEAD']) !== v['reviewed-sub2api-candidate-head']) fail('dirty_repository', 'Sub2API review root must be the clean reviewed candidate')
    const delta = commitDelta(root, v['reviewed-cc-candidate-head'])
    const evidenceCommit = {
      tested_head: isObject(review.tested_heads) ? review.tested_heads.cc_gateway : '',
      candidate_head: v['reviewed-cc-candidate-head'],
      parents: reviewedGitText(root, ['show', '-s', '--format=%P', v['reviewed-cc-candidate-head']]).split(' ').filter(Boolean),
      added_paths: delta.filter((entry) => entry.status === 'A').map((entry) => entry.path),
      bytes_match: delta.length === 2 && delta.every((entry) => entry.status === 'A')
        && committedArtifactBytes(root, v['reviewed-cc-candidate-head'], v['feature-baseline']).equals(readFileSync(path.resolve(root, v['feature-baseline'])))
        && committedArtifactBytes(root, v['reviewed-cc-candidate-head'], v['feature-results']).equals(readFileSync(path.resolve(root, v['feature-results']))),
      sub2api_tested_head: isObject(review.tested_heads) ? review.tested_heads.sub2api : '',
      sub2api_candidate_head: v['reviewed-sub2api-candidate-head'],
    }
    const validation = validatePhase1LoadedFeatureReview({
      catalog, featureBaseline, featureResults, context, planReview, planReviewSchema, executionContextSchema, featureReview: review,
      featureReviewPath: v['feature-review'], reviewMode: 'uncommitted', liveStatuses: { cc_gateway: ccStatus, sub2api: subStatus },
      bindings: {
        featureBaseline: pathBinding(root, v['feature-baseline']), featureResults: pathBinding(root, v['feature-results']),
        context: pathBinding(root, v['execution-context']), planReview: pathBinding(root, v['plan-review']),
        planReviewSchema: pathBinding(root, 'docs/superpowers/schemas/oracle-lab-phase-1-plan-review.schema.json'),
        executionContextSchema: pathBinding(root, 'docs/superpowers/schemas/oracle-lab-phase-1-execution-context.schema.json'),
        planningEntry: pathBinding(root, 'docs/superpowers/evidence/phase-1/phase-1-entry-baseline.json'),
        planningContext: pathBinding(root, 'docs/superpowers/evidence/phase-1/phase-1-context.json'),
      },
      evidenceCommit,
    })
    if (!validation.ok) fail(validation.errors[0]?.code ?? 'feature_review_mismatch', JSON.stringify(validation.errors))
  } else if (invocation.command === 'build-integration-entry') {
    const root = realpathSync(v['controller-root'])
    const entry = buildPhase1IntegrationEntry({
      actual: true, controllerRoot: root, attemptId: v['attempt-id'],
      previousAttempt: { id: v['previous-attempt-id'], receipt: v['previous-attempt-receipt'], digest: v['previous-attempt-receipt-digest'], commit: v['previous-attempt-receipt-commit'] },
      catalogPath: v.catalog, ccGatewayRoot: v['cc-gateway-root'], sub2apiRoot: v['sub2api-root'], sub2apiContractRoot: v['sub2api-contract-root'],
      executionContextPath: v['execution-context'], planReviewPath: v['plan-review'], featureResultsPath: v['feature-results'], featureReviewPath: v['feature-review'],
      reviewedCCCandidateHead: v['reviewed-cc-candidate-head'], reviewedSub2APICandidateHead: v['reviewed-sub2api-candidate-head'], ccReviewAttestationHead: v['cc-review-attestation-head'],
      ccPreMergeMainHead: v['cc-pre-merge-main-head'], sub2apiPreMergeMainHead: v['sub2api-pre-merge-main-head'], ccMergeCommit: v['cc-merge-commit'], sub2apiMergeCommit: v['sub2api-merge-commit'],
      ccRemote: v['cc-remote'], ccRemoteRef: v['cc-remote-ref'], ccOriginDigest: v['cc-origin-digest'], sub2apiRemote: v['sub2api-remote'], sub2apiRemoteRef: v['sub2api-remote-ref'], sub2apiOriginDigest: v['sub2api-origin-digest'],
    })
    writeOne(root, v.out, entry)
  } else if (invocation.command === 'build-handoff') {
    const root = realpathSync(v['controller-root']); const catalog = readPhase1Catalog(path.resolve(root, v.catalog))
    const entry = loadJson(root, v['integration-entry']); const baseline = loadJson(root, v.baseline); const resultsValue = loadJson(root, v.results)
    const handoff = buildPhase1Handoff({
      actual: true, controllerRoot: root, ccGatewayRoot: v['cc-gateway-root'], sub2apiRoot: v['sub2api-root'],
      sub2apiContractRoot: v['sub2api-contract-root'], catalog, entry, baseline, results: resultsValue,
      registries: { requirements: pathBinding(root, v.registry), claims: pathBinding(root, v.claims), observations: pathBinding(root, v.observations) },
    })
    const report = Buffer.from(renderPhase1HandoffMarkdown(handoff))
    writeExclusivePair(root, [{ file: v['handoff-out'], value: handoff }, { file: v['report-out'], raw: report }])
  } else if (invocation.command === 'validate-handoff') {
    const root = realpathSync(v['controller-root']); const catalog = readPhase1Catalog(path.resolve(root, v.catalog)); const resultsValue = loadJson(root, v.results)
    const entry = loadJson(root, v['integration-entry']); const baseline = loadJson(root, v.baseline); const handoff = loadJson(root, v.handoff)
    const registries = { requirements: pathBinding(root, v.requirements), claims: pathBinding(root, v.claims), observations: pathBinding(root, v.observations) }
    const regenerated = buildPhase1Handoff({
      actual: true, controllerRoot: root, ccGatewayRoot: v['cc-gateway-root'], sub2apiRoot: v['sub2api-root'],
      sub2apiContractRoot: v['sub2api-contract-root'], catalog, entry, baseline, results: resultsValue,
      registries, generatedAt: String(handoff.generated_at),
    })
    const validation = validatePhase1HandoffValue(handoff)
    if (!validation.ok || !same(regenerated, handoff)
      || readFileSync(path.resolve(root, v.report), 'utf8') !== renderPhase1HandoffMarkdown(handoff)) {
      fail('handoff_mismatch', validation.ok ? 'handoff sources or report bytes drifted' : JSON.stringify(validation.errors))
    }
  } else if (invocation.command === 'build-integration-receipt') {
    const root = realpathSync(v['controller-root']); readPhase1Catalog(path.resolve(root, v.catalog))
    if (reviewedGitText(root, ['rev-parse', 'HEAD']) !== v['artifact-commit'] || repositoryStatus(root).length !== 0) fail('receipt_commit_mismatch', 'receipt builder requires the clean exact artifact commit')
    const entry = loadJson(root, v['integration-entry']); const baseline = loadJson(root, v.baseline); const resultsValue = loadJson(root, v.results); const handoff = loadJson(root, v.handoff)
    const receipt = buildPhase1IntegrationReceipt({
      actual: true, catalog: readPhase1Catalog(path.resolve(root, v.catalog)), controllerRoot: root,
      sub2apiRoot: v['sub2api-root'], artifactCommit: v['artifact-commit'], entry, baseline, results: resultsValue,
      handoff, report: pathBinding(root, v.report),
      registries: { requirements: pathBinding(root, v.requirements), claims: pathBinding(root, v.claims), observations: pathBinding(root, v.observations) },
    })
    writeOne(root, v['receipt-out'], receipt)
  } else if (invocation.command === 'validate-integration-receipt') {
    const root = realpathSync(v['controller-root']); const catalog = readPhase1Catalog(path.resolve(root, v.catalog)); const resultsValue = loadJson(root, v.results)
    const entry = loadJson(root, v['integration-entry']); const baseline = loadJson(root, v.baseline); const handoff = loadJson(root, v.handoff); const receipt = loadJson(root, v.receipt)
    const registries = { requirements: pathBinding(root, v.requirements), claims: pathBinding(root, v.claims), observations: pathBinding(root, v.observations) }
    const regenerated = buildPhase1IntegrationReceipt({
      actual: true, catalog, artifactCommit: v['artifact-commit'], entry, baseline, results: resultsValue,
      handoff, report: pathBinding(root, v.report), registries, generatedAt: String(receipt.generated_at),
    })
    const validation = validatePhase1IntegrationReceiptValue(receipt)
    if (!validation.ok || !same(regenerated, receipt)) fail(validation.ok ? 'receipt_mismatch' : validation.errors[0]?.code ?? 'receipt_mismatch', validation.ok ? 'receipt source bindings drifted' : JSON.stringify(validation.errors))
    assertActualReceiptTopology(root, v['artifact-commit'], v['receipt-commit'], v.receipt, receipt)
  } else if (invocation.command === 'verify-final-remote') {
    process.stdout.write(`${canonicalJson(finalRemoteLive(v))}\n`)
    return
  }
  process.stdout.write(`${canonicalJson({ ok: true, command: invocation.command, catalog_digest: CATALOG_DIGEST })}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try { runCli(process.argv.slice(2)) }
  catch (error) {
    const typed = error as Error & { code?: string }
    process.stderr.write(`${canonicalJson({ code: typed.code ?? 'phase1_error', message: typed.message })}\n`)
    process.exitCode = 1
  }
}
