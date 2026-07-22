import { closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { canonicalJson, Phase3AError, sha256Bytes, sha256File, stableError } from './core.js'
import type { ExtractedCandidate, ExtractionIndex } from './extract-bundle.js'
import { REQUIRED_STATIC_ROOTS, type RequiredStaticRoot } from './recover-ast.js'
import type { StaticLocation } from './static-inventory.js'

const MAX_MODULE_NODES = 50_000
const MAX_EVIDENCE_PER_CATEGORY = 256
const MAX_ROOT_PATHS = 256
const STRUCTURAL_CACHE = new WeakMap<ts.Node, { sha256: string; nodes: number }>()

export const DISCOVERY_CATEGORIES = [
  'cache-compact',
  'child-process',
  'config-read',
  'daemon-lifecycle',
  'dns-socket-tls',
  'env-read',
  'fetch-http',
  'filesystem-keychain-helper',
  'platform-locale',
  'request-header-model-auth',
  'session-identity',
  'state-edge',
  'telemetry-diagnostic-update-error',
  'timer-random',
  'unix-ipc',
  'url-host-path',
  'websocket-quic-udp',
] as const

export type DiscoveryCategory = typeof DISCOVERY_CATEGORIES[number]
type AstLocation = StaticLocation & { line: number; column: number }
type CandidateBinding = Pick<ExtractedCandidate, 'sha256' | 'location'>

type EvidenceAnchor = {
  module_id: string | null
  node_kind: string
  value_sha256: string
  location: AstLocation
}

type RootPath = {
  module_id: string | null
  caller_sha256: string
  callee_shape_sha256: string | null
  location: AstLocation
}

type CfgNeighborhood = {
  module_id: string | null
  function_sha256: string
  node_count: number
  branch_count: number
  edge_kinds: string[]
  budget_truncated: boolean
  location: AstLocation
}

type StateNeighborhood = {
  module_id: string | null
  discriminator_sha256: string
  transition_count: number
  location: AstLocation
}

export type DiscoveryInventory = {
  schema_version: 'oracle-lab-phase3a-discovery-inventory.v1'
  binding: {
    artifact_sha256: string
    candidate_sha256: string
    candidate_location: StaticLocation
    parser: 'typescript-compiler-api'
    parser_version: string
    command_sha256: string
  }
  parse: {
    source_bytes: number
    syntax_diagnostics: number
    module_slice_count: number
    aggregate_module_nodes: number
    max_module_nodes: number
    node_budget: number
    budget_exceeded_modules: number
    persisted_raw_source: false
  }
  module_slices: Array<{
    module_id: string
    key_sha256: string
    ast_sha256: string
    source_sha256: string
    node_count: number
    location: AstLocation
  }>
  inventory: Array<{
    category: DiscoveryCategory
    kind: 'source' | 'sink' | 'state'
    match_count: number
    module_count: number
    evidence_locations: EvidenceAnchor[]
  }>
  safe_env_keys: string[]
  env_reads: Array<{
    key: string
    match_count: number
    module_count: number
    locations: EvidenceAnchor[]
  }>
  root_coverage: Array<{
    root: RequiredStaticRoot
    status: 'observed' | 'unknown'
    xref_count: number
    evidence_locations: EvidenceAnchor[]
    call_paths: RootPath[]
    cfg_neighborhoods: CfgNeighborhood[]
    state_neighborhoods: StateNeighborhood[]
    searched_surfaces: string[]
    next_minimal_action: string | null
  }>
  unresolved_dynamic_edges: Array<{ shape_sha256: string; location: AstLocation }>
  deterministic_digest: string
}

const ROOT_PATTERNS: Record<RequiredStaticRoot, RegExp> = {
  'env-config-system': /env|config|configuration|settings?|feature.?flag|system.?property/i,
  'home-xdg-tmp-tz-lang-locale-host-platform-arch': /HOME|XDG_|TMP(?:DIR)?|TZ|LANG|LC_|locale|hostname|platform|arch/i,
  'config-precedence': /precedence|override|defaults?|managed|user.?settings|project.?settings|ide.?config/i,
  'model-capability': /model|capabilit(?:y|ies)|alias/i,
  authentication: /auth|authorization|api.?key|token|credential|refresh|expir|oauth|setup.?token/i,
  'base-url-proxy': /base.?url|proxy|NO_PROXY/i,
  'system-prompt': /system.?prompt/i,
  'request-serialization': /headers?|body|request|serializ|stringify|content.?type/i,
  'identity-time-random': /request.?id|session.?id|timestamp|Date|now|random|uuid|nonce/i,
  'cch-billing-cache-compact': /cch|billing|cache|prompt.?cache|compact|compaction/i,
  'telemetry-diagnostic-update-error': /telemetry|otel|diagnostic|update|error|exception|sentry|crash.?report/i,
  'dns-socket-tls-http-transport': /dns|socket|connect|tls|https?|fetch|undici|transport|websocket|quic|udp|unix/i,
  'retry-timer-backoff-jitter': /retry|retries|timer|timeout|backoff|jitter|setTimeout|setInterval/i,
  'child-subtask-process-ipc': /child.?process|spawn|fork|exec|subtask|worker|ipc|process/i,
  'daemon-restart-resume-lifecycle': /daemon|restart|resume|suspend|wake|shutdown|exit|long.?running|lifecycle/i,
}

const CATEGORY_KIND: Record<DiscoveryCategory, 'source' | 'sink' | 'state'> = {
  'cache-compact': 'state',
  'child-process': 'sink',
  'config-read': 'source',
  'daemon-lifecycle': 'state',
  'dns-socket-tls': 'sink',
  'env-read': 'source',
  'fetch-http': 'sink',
  'filesystem-keychain-helper': 'source',
  'platform-locale': 'source',
  'request-header-model-auth': 'sink',
  'session-identity': 'source',
  'state-edge': 'state',
  'telemetry-diagnostic-update-error': 'sink',
  'timer-random': 'source',
  'unix-ipc': 'sink',
  'url-host-path': 'sink',
  'websocket-quic-udp': 'sink',
}

function fail(code: string, message: string): never { throw new Phase3AError(code, message) }

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function location(source: ts.SourceFile, candidate: CandidateBinding, node: ts.Node): AstLocation {
  const start = node.getStart(source, false)
  const point = source.getLineAndCharacterOfPosition(start)
  return {
    artifact_sha256: candidate.location.artifact_sha256,
    offset: candidate.location.offset + start,
    length: node.getEnd() - start,
    line: point.line + 1,
    column: point.character + 1,
  }
}

function propertyText(name: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function nodeText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) return propertyText(node.name)
  return null
}

function expressionName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return `${expressionName(node.expression)}.${node.name.text}`
  if (ts.isElementAccessExpression(node)) return expressionName(node.expression)
  return ts.SyntaxKind[node.kind]
}

function structuralDigest(node: ts.Node): { sha256: string; nodes: number } {
  const cached = STRUCTURAL_CACHE.get(node)
  if (cached) return cached
  const records: Array<{ kind: string; scalar?: string }> = []
  walk(node, (child) => {
    if (records.length >= MAX_MODULE_NODES) fail('static_budget_exceeded', 'module slice exceeds 50000 AST nodes')
    const text = nodeText(child)
    records.push({ kind: ts.SyntaxKind[child.kind], ...(text === null ? {} : { scalar: sha256Bytes(text) }) })
  })
  const digest = { sha256: sha256Bytes(canonicalJson(records)), nodes: records.length }
  STRUCTURAL_CACHE.set(node, digest)
  return digest
}

function structuralAnchorDigest(source: ts.SourceFile, candidate: CandidateBinding, node: ts.Node): string {
  try {
    return structuralDigest(node).sha256
  } catch (error) {
    if (!(error instanceof Phase3AError) || error.code !== 'static_budget_exceeded') throw error
    const loc = location(source, candidate, node)
    return sha256Bytes(canonicalJson({ kind: ts.SyntaxKind[node.kind], location: loc, reason: 'module-slice-required' }))
  }
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let cursor: ts.Node | undefined = node
  while (cursor) {
    if (ts.isFunctionLike(cursor)) return cursor
    cursor = cursor.parent
  }
  return null
}

function enclosingCall(node: ts.Node): ts.CallExpression | ts.NewExpression | null {
  let cursor: ts.Node | undefined = node
  while (cursor) {
    if (ts.isCallExpression(cursor) || ts.isNewExpression(cursor)) return cursor
    if (ts.isFunctionLike(cursor) && cursor !== node) return null
    cursor = cursor.parent
  }
  return null
}

function envKey(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env') return node.name.text
  if (ts.isElementAccessExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'process'
    && node.expression.name.text === 'env'
    && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text
  return null
}

function categoriesFor(node: ts.Node, text: string | null, callName: string | null, isEnv: boolean): DiscoveryCategory[] {
  const value = `${text ?? ''} ${callName ?? ''}`
  const categories = new Set<DiscoveryCategory>()
  if (isEnv) categories.add('env-read')
  if (/config|settings?|feature.?flag|system.?property/i.test(value)) categories.add('config-read')
  if (/HOME|XDG_|TMP(?:DIR)?|TZ|LANG|LC_|locale|hostname|platform|arch/i.test(value)) categories.add('platform-locale')
  if (/https?:\/\/|base.?url|hostname|endpoint|\/v1\/|path/i.test(value)) categories.add('url-host-path')
  if (/headers?|authorization|api.?key|token|credential|model|content.?type|user.?agent/i.test(value)) categories.add('request-header-model-auth')
  if (/telemetry|otel|diagnostic|update|error|exception|sentry|crash.?report/i.test(value)) categories.add('telemetry-diagnostic-update-error')
  if (/dns|socket|connect|tls/i.test(value)) categories.add('dns-socket-tls')
  if (/fetch|https?|undici|request/i.test(callName ?? '')) categories.add('fetch-http')
  if (/websocket|quic|udp/i.test(value)) categories.add('websocket-quic-udp')
  if (/unix|ipc|named.?pipe/i.test(value)) categories.add('unix-ipc')
  if (/\bfs\b|readFile|writeFile|mkdir|stat|keychain|credential.?helper|helper/i.test(value)) categories.add('filesystem-keychain-helper')
  if (/child.?process|spawn|fork|exec|subtask|worker/i.test(value)) categories.add('child-process')
  if (/daemon|restart|resume|suspend|wake|shutdown|long.?running|lifecycle/i.test(value)) categories.add('daemon-lifecycle')
  if (/setTimeout|setInterval|timer|random|randomUUID|Date\.now|backoff|jitter/i.test(value)) categories.add('timer-random')
  if (/request.?id|session.?id|nonce|timestamp|correlation.?id/i.test(value)) categories.add('session-identity')
  if (/cch|billing|cache|compact|compaction/i.test(value)) categories.add('cache-compact')
  if (ts.isSwitchStatement(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) categories.add('state-edge')
  return [...categories]
}

function cfgNeighborhood(source: ts.SourceFile, candidate: CandidateBinding, moduleId: string | null, fn: ts.FunctionLikeDeclaration): CfgNeighborhood {
  let nodes = 0
  let branches = 0
  let budgetTruncated = false
  const kinds = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (nodes >= MAX_MODULE_NODES) { budgetTruncated = true; return }
    nodes += 1
    if (ts.isIfStatement(node) || ts.isConditionalExpression(node)) { branches += 1; kinds.add('conditional') }
    else if (ts.isSwitchStatement(node)) { branches += node.caseBlock.clauses.length; kinds.add('switch') }
    else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) { branches += 1; kinds.add('loop') }
    else if (ts.isReturnStatement(node)) kinds.add('return')
    else if (ts.isThrowStatement(node)) kinds.add('throw')
    node.forEachChild(visit)
  }
  visit(fn)
  return { module_id: moduleId, function_sha256: structuralAnchorDigest(source, candidate, fn), node_count: nodes, branch_count: branches, edge_kinds: [...kinds].sort(), budget_truncated: budgetTruncated, location: location(source, candidate, fn) }
}

export function buildDiscoveryInventory(sourceBytes: Buffer, candidate: CandidateBinding): DiscoveryInventory {
  if (sha256Bytes(sourceBytes) !== candidate.sha256 || sourceBytes.length !== candidate.location.length) fail('artifact_hash_mismatch', 'candidate digest or length disagrees with source bytes')
  const sourceText = sourceBytes.toString('utf8')
  if (sourceText.includes('\ufffd') || !Buffer.from(sourceText, 'utf8').equals(sourceBytes)) fail('static_encoding_invalid', 'candidate is not canonical UTF-8')
  const source = ts.createSourceFile(`discovery-${candidate.sha256.slice(0, 16)}.js`, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics
  if (diagnostics.length > 0) fail('static_syntax_invalid', `syntax error ${diagnostics[0].code} at ${diagnostics[0].start ?? 0}`)

  const moduleNodes: ts.PropertyAssignment[] = []
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const entries = node.properties.filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && (ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer)))
    if (entries.length >= 2) moduleNodes.push(...entries)
  })
  const moduleByFunction = new Map<ts.Node, string>()
  const moduleSlices = moduleNodes.map((entry, index) => {
    const start = entry.initializer.getStart(source, false)
    const end = entry.initializer.getEnd()
    const bytes = sourceBytes.subarray(start, end)
    const structure = structuralDigest(entry.initializer)
    const moduleId = `module-${String(index).padStart(5, '0')}-${structure.sha256.slice(0, 16)}`
    moduleByFunction.set(entry.initializer, moduleId)
    return {
      module_id: moduleId,
      key_sha256: sha256Bytes(propertyText(entry.name) ?? entry.name.getText(source)),
      ast_sha256: structure.sha256,
      source_sha256: sha256Bytes(bytes),
      node_count: structure.nodes,
      location: location(source, candidate, entry.initializer),
    }
  })
  const moduleFor = (node: ts.Node): string | null => {
    let cursor: ts.Node | undefined = node
    while (cursor) {
      const id = moduleByFunction.get(cursor)
      if (id) return id
      cursor = cursor.parent
    }
    return null
  }

  const categoryMatches = new Map<DiscoveryCategory, { count: number; modules: Set<string>; evidence: EvidenceAnchor[] }>(
    DISCOVERY_CATEGORIES.map((category) => [category, { count: 0, modules: new Set(), evidence: [] }]),
  )
  const rootMatches = new Map<RequiredStaticRoot, { count: number; evidence: EvidenceAnchor[]; nodes: ts.Node[] }>(
    REQUIRED_STATIC_ROOTS.map((root) => [root, { count: 0, evidence: [], nodes: [] }]),
  )
  const safeEnvKeys = new Set<string>()
  const envReads = new Map<string, { count: number; modules: Set<string>; locations: EvidenceAnchor[] }>()
  const unresolvedDynamicEdges: DiscoveryInventory['unresolved_dynamic_edges'] = []
  const seenRoot = new Set<string>()
  const seenCategory = new Set<string>()

  walk(source, (node) => {
    const text = nodeText(node)
    const callName = ts.isCallExpression(node) || ts.isNewExpression(node) ? expressionName(node.expression) : null
    const key = envKey(node)
    if (key && /^[A-Z][A-Z0-9_]{1,127}$/.test(key)) safeEnvKeys.add(key)
    const loc = location(source, candidate, node)
    const moduleId = moduleFor(node)
    const value = `${text ?? ''} ${callName ?? ''} ${key ?? ''}`
    const anchor: EvidenceAnchor = { module_id: moduleId, node_kind: ts.SyntaxKind[node.kind], value_sha256: sha256Bytes(value), location: loc }
    if (key && /^[A-Z][A-Z0-9_]{1,127}$/.test(key)) {
      const record = envReads.get(key) ?? { count: 0, modules: new Set<string>(), locations: [] }
      record.count += 1
      if (moduleId) record.modules.add(moduleId)
      if (record.locations.length < 32) record.locations.push(anchor)
      envReads.set(key, record)
    }

    for (const category of categoriesFor(node, text, callName, key !== null)) {
      const record = categoryMatches.get(category)!
      const identity = `${category}:${loc.offset}:${loc.length}`
      if (seenCategory.has(identity)) continue
      seenCategory.add(identity)
      record.count += 1
      if (moduleId) record.modules.add(moduleId)
      if (record.evidence.length < MAX_EVIDENCE_PER_CATEGORY) record.evidence.push(anchor)
    }
    for (const root of REQUIRED_STATIC_ROOTS) {
      if (!ROOT_PATTERNS[root].test(value)) continue
      const identity = `${root}:${loc.offset}:${loc.length}`
      if (seenRoot.has(identity)) continue
      seenRoot.add(identity)
      const record = rootMatches.get(root)!
      record.count += 1
      record.nodes.push(node)
      if (record.evidence.length < MAX_ROOT_PATHS) record.evidence.push(anchor)
    }
    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && ts.isElementAccessExpression(node.expression) && unresolvedDynamicEdges.length < MAX_ROOT_PATHS) {
      unresolvedDynamicEdges.push({ shape_sha256: structuralDigest(node.expression).sha256, location: loc })
    }
  })

  const rootCoverage: DiscoveryInventory['root_coverage'] = REQUIRED_STATIC_ROOTS.map((root) => {
    const matches = rootMatches.get(root)!
    const paths = new Map<string, RootPath>()
    const cfg = new Map<string, CfgNeighborhood>()
    const states = new Map<string, StateNeighborhood>()
    for (const node of matches.nodes) {
      if (paths.size >= MAX_ROOT_PATHS) break
      const fn = enclosingFunction(node)
      const call = enclosingCall(node)
      const moduleId = moduleFor(node)
      const caller = fn ? structuralAnchorDigest(source, candidate, fn) : sha256Bytes('root')
      const pathLoc = location(source, candidate, call ?? node)
      paths.set(`${caller}:${pathLoc.offset}`, { module_id: moduleId, caller_sha256: caller, callee_shape_sha256: call ? structuralDigest(call.expression).sha256 : null, location: pathLoc })
      if (fn && cfg.size < MAX_ROOT_PATHS) {
        const fnLoc = location(source, candidate, fn)
        const cfgKey = `${fnLoc.offset}:${fnLoc.length}`
        if (!cfg.has(cfgKey)) {
          cfg.set(cfgKey, cfgNeighborhood(source, candidate, moduleId, fn))
          let visited = 0
          const visitStates = (child: ts.Node): void => {
            if (visited >= MAX_MODULE_NODES || states.size >= MAX_ROOT_PATHS) return
            visited += 1
            if (ts.isSwitchStatement(child)) {
              const stateLoc = location(source, candidate, child)
              states.set(`${stateLoc.offset}:${stateLoc.length}`, {
                module_id: moduleId,
                discriminator_sha256: structuralAnchorDigest(source, candidate, child.expression),
                transition_count: child.caseBlock.clauses.length,
                location: stateLoc,
              })
            }
            child.forEachChild(visitStates)
          }
          visitStates(fn)
        }
      }
    }
    const observed = matches.count > 0
    return {
      root,
      status: observed ? 'observed' : 'unknown',
      xref_count: matches.count,
      evidence_locations: matches.evidence,
      call_paths: [...paths.values()].sort((left, right) => left.location.offset - right.location.offset),
      cfg_neighborhoods: [...cfg.values()].sort((left, right) => left.location.offset - right.location.offset),
      state_neighborhoods: [...states.values()].sort((left, right) => left.location.offset - right.location.offset),
      searched_surfaces: ['bun-standalone-module-graph', 'bundle-table-module-slices', 'typescript-ast-literals', 'property-and-element-access', 'call-and-new-expressions', 'bounded-cfg-neighborhoods', 'switch-state-tables'],
      next_minimal_action: observed ? null : 'use a dynamically observed hook anchor to select the next module neighborhood',
    }
  })

  const inventory = DISCOVERY_CATEGORIES.map((category) => {
    const record = categoryMatches.get(category)!
    return { category, kind: CATEGORY_KIND[category], match_count: record.count, module_count: record.modules.size, evidence_locations: record.evidence }
  })
  const nodeCounts = moduleSlices.map((entry) => entry.node_count)
  const base: Omit<DiscoveryInventory, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-discovery-inventory.v1',
    binding: {
      artifact_sha256: candidate.location.artifact_sha256,
      candidate_sha256: candidate.sha256,
      candidate_location: candidate.location,
      parser: 'typescript-compiler-api',
      parser_version: ts.version,
      command_sha256: sha256Bytes(canonicalJson({ operation: 'phase3a-discovery-inventory', artifact_sha256: candidate.location.artifact_sha256, candidate_sha256: candidate.sha256, parser_version: ts.version, module_node_budget: MAX_MODULE_NODES })),
    },
    parse: {
      source_bytes: sourceBytes.length,
      syntax_diagnostics: diagnostics.length,
      module_slice_count: moduleSlices.length,
      aggregate_module_nodes: nodeCounts.reduce((total, count) => total + count, 0),
      max_module_nodes: Math.max(0, ...nodeCounts),
      node_budget: MAX_MODULE_NODES,
      budget_exceeded_modules: nodeCounts.filter((count) => count > MAX_MODULE_NODES).length,
      persisted_raw_source: false,
    },
    module_slices: moduleSlices,
    inventory,
    safe_env_keys: [...safeEnvKeys].sort(),
    env_reads: [...envReads.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, record]) => ({
      key,
      match_count: record.count,
      module_count: record.modules.size,
      locations: record.locations,
    })),
    root_coverage: rootCoverage,
    unresolved_dynamic_edges: unresolvedDynamicEdges.sort((left, right) => left.location.offset - right.location.offset),
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

function args(argv: string[]): Record<string, string> {
  const output: Record<string, string> = {}
  const values = argv[0] === '--' ? argv.slice(1) : argv
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index]?.startsWith('--')) fail('invalid_arguments', 'arguments must start with --name')
    const name = values[index].slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) output[name] = 'true'
    else { output[name] = next; index += 1 }
  }
  return output
}

function readCandidate(file: string, extraction: ExtractionIndex, candidateId: string): { bytes: Buffer; candidate: ExtractedCandidate } {
  if (sha256File(file) !== extraction.artifact_sha256) fail('artifact_hash_mismatch', 'entrypoint differs from extraction index')
  const candidate = extraction.candidates.find((entry) => entry.candidate_id === candidateId)
  if (!candidate) fail('static_candidate_missing', 'candidate id is absent from extraction index')
  const fd = openSync(file, 'r')
  try {
    const stat = fstatSync(fd)
    const end = candidate.location.offset + candidate.location.length
    if (candidate.location.offset < 0 || end > stat.size) fail('static_range_invalid', 'candidate range is outside artifact')
    const bytes = Buffer.alloc(candidate.location.length)
    const count = readSync(fd, bytes, 0, bytes.length, candidate.location.offset)
    if (count !== bytes.length) fail('artifact_identity', 'short read while loading candidate')
    return { bytes, candidate }
  } finally {
    closeSync(fd)
  }
}

export function runDiscoveryInventoryCli(argv: string[]): void {
  const values = args(argv)
  if (!values.entrypoint || !values.extraction || !values['candidate-id'] || !values.out) fail('invalid_arguments', '--entrypoint, --extraction, --candidate-id and --out are required')
  const extraction = JSON.parse(readFileSync(values.extraction, 'utf8')) as ExtractionIndex
  const { bytes, candidate } = readCandidate(values.entrypoint, extraction, values['candidate-id'])
  const inventory = buildDiscoveryInventory(bytes, candidate)
  writeFileSync(values.out, `${canonicalJson(inventory)}\n`, { flag: 'wx', mode: 0o600 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runDiscoveryInventoryCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
