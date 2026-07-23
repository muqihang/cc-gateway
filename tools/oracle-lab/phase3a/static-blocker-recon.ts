import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import ts from 'typescript'

import { canonicalJson, isSha256, Phase3AError, sha256Bytes } from './core.js'

export type StaticAnchorSpec = {
  id: string
  function_name: string
  required_markers: string[]
  required_calls?: string[]
}

export type StaticAnchor = {
  id: string
  function_name: string
  node_kind: string
  module_offset: number
  artifact_offset: number
  length: number
  source_sha256: string
  direct_calls: string[]
  cfg: {
    node_count: number
    edge_count: number
    branch_count: number
    kind_counts: Record<string, number>
    shape_digest: string
  }
}

export type StaticConstantAnchorSpec = {
  id: string
  symbol_name: string
  node_kind: 'assignment' | 'variable'
  required_markers: string[]
}

export type StaticConstantAnchor = {
  id: string
  symbol_name: string
  node_kind: 'BinaryExpression' | 'VariableDeclaration'
  module_offset: number
  artifact_offset: number
  length: number
  source_sha256: string
}

export type StaticAnchorScan = {
  parser: 'typescript-compiler-api'
  parser_version: string
  source_bytes: number
  source_sha256: string
  source_persisted: false
  anchors: StaticAnchor[]
  constant_anchors: StaticConstantAnchor[]
  scan_digest: string
}

const branchKinds = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
])
const branchKindNames = new Set([...branchKinds].map((kind) => ts.SyntaxKind[kind] ?? String(kind)))

function inferredFunctionName(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor'
  if (node.name) return node.name.getText(sourceFile)
  let cursor: ts.Node | undefined = node.parent
  for (let depth = 0; cursor && depth < 5; depth += 1, cursor = cursor.parent) {
    if (ts.isVariableDeclaration(cursor)) return cursor.name.getText(sourceFile)
    if (ts.isPropertyAssignment(cursor)) return cursor.name.getText(sourceFile)
    if (ts.isBinaryExpression(cursor) && cursor.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return cursor.left.getText(sourceFile)
    }
  }
  return null
}

function collectDirectCalls(node: ts.Node, sourceFile: ts.SourceFile): Set<string> {
  const calls = new Set<string>()
  const visit = (current: ts.Node): void => {
    if (current !== node && ts.isFunctionLike(current)) return
    if (ts.isCallExpression(current)) {
      const expression = current.expression
      if (ts.isIdentifier(expression)) calls.add(expression.text)
      else if (ts.isPropertyAccessExpression(expression)) calls.add(expression.name.text)
    }
    if (ts.isNewExpression(current)) {
      const expression = current.expression
      if (ts.isIdentifier(expression)) calls.add(expression.text)
      else if (ts.isPropertyAccessExpression(expression)) calls.add(expression.name.text)
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return calls
}

function cfgSummary(node: ts.FunctionLikeDeclaration): StaticAnchor['cfg'] {
  type Fragment = { entry: string | null; exits: string[] }
  const nodes: Array<{ id: string; kind: string }> = []
  const edges: Array<{ from: string; to: string; relation: string }> = []
  let nextId = 0
  const addNode = (current: ts.Node): string => {
    const id = `n${nextId++}`
    nodes.push({ id, kind: ts.SyntaxKind[current.kind] ?? String(current.kind) })
    return id
  }
  const connect = (from: string[], to: string | null, relation = 'next'): void => {
    if (!to) return
    for (const source of from) edges.push({ from: source, to, relation })
  }
  const sequence = (statements: readonly ts.Statement[]): Fragment => {
    let entry: string | null = null
    let exits: string[] = []
    for (const statement of statements) {
      const fragment = build(statement)
      if (!entry) entry = fragment.entry
      connect(exits, fragment.entry)
      exits = fragment.exits
    }
    return { entry, exits }
  }
  const build = (current: ts.Statement): Fragment => {
    if (ts.isBlock(current)) return sequence(current.statements)
    const id = addNode(current)
    if (ts.isReturnStatement(current) || ts.isThrowStatement(current)) return { entry: id, exits: [] }
    if (ts.isIfStatement(current)) {
      const thenFragment = build(current.thenStatement)
      const elseFragment = current.elseStatement ? build(current.elseStatement) : null
      if (thenFragment.entry) edges.push({ from: id, to: thenFragment.entry, relation: 'true' })
      if (elseFragment?.entry) edges.push({ from: id, to: elseFragment.entry, relation: 'false' })
      return {
        entry: id,
        exits: [
          ...(thenFragment.entry ? thenFragment.exits : [id]),
          ...(elseFragment ? (elseFragment.entry ? elseFragment.exits : [id]) : [id]),
        ],
      }
    }
    if (ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current)
      || ts.isWhileStatement(current) || ts.isDoStatement(current)) {
      const body = build(current.statement)
      if (body.entry) edges.push({ from: id, to: body.entry, relation: 'loop-body' })
      connect(body.exits, id, 'loop-back')
      return { entry: id, exits: [id] }
    }
    if (ts.isSwitchStatement(current)) {
      const exits: string[] = [id]
      for (const clause of current.caseBlock.clauses) {
        const clauseFragment = sequence(clause.statements)
        if (clauseFragment.entry) edges.push({ from: id, to: clauseFragment.entry, relation: ts.isCaseClause(clause) ? 'case' : 'default' })
        exits.push(...clauseFragment.exits)
      }
      return { entry: id, exits }
    }
    if (ts.isTryStatement(current)) {
      const tryFragment = build(current.tryBlock)
      if (tryFragment.entry) edges.push({ from: id, to: tryFragment.entry, relation: 'try' })
      const catchFragment = current.catchClause ? build(current.catchClause.block) : null
      if (catchFragment?.entry) edges.push({ from: id, to: catchFragment.entry, relation: 'catch' })
      const preFinally = [...tryFragment.exits, ...(catchFragment?.exits ?? [])]
      if (current.finallyBlock) {
        const finallyFragment = build(current.finallyBlock)
        connect(preFinally, finallyFragment.entry, 'finally')
        return { entry: id, exits: finallyFragment.exits }
      }
      return { entry: id, exits: preFinally.length > 0 ? preFinally : [id] }
    }
    return { entry: id, exits: [id] }
  }
  if (node.body) {
    if (ts.isBlock(node.body)) sequence(node.body.statements)
    else addNode(node.body)
  }
  const kindCounts: Record<string, number> = {}
  for (const entry of nodes) if (branchKindNames.has(entry.kind)) kindCounts[entry.kind] = (kindCounts[entry.kind] ?? 0) + 1
  const branchCount = Object.values(kindCounts).reduce((sum, count) => sum + count, 0)
  return {
    node_count: nodes.length,
    edge_count: edges.length,
    branch_count: branchCount,
    kind_counts: kindCounts,
    shape_digest: sha256Bytes(canonicalJson({ nodes, edges })),
  }
}

export function scanStaticAnchors(
  sourceInput: Uint8Array,
  specs: StaticAnchorSpec[],
  options: { artifact_offset: number },
  constantSpecs: StaticConstantAnchorSpec[] = [],
): StaticAnchorScan {
  if (!Number.isSafeInteger(options.artifact_offset) || options.artifact_offset < 0) {
    throw new Phase3AError('static_binding_invalid', 'artifact_offset must be a non-negative safe integer')
  }
  const source = Buffer.from(sourceInput)
  const text = source.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(source)) throw new Phase3AError('static_source_invalid', 'source must be valid UTF-8')
  const sourceFile = ts.createSourceFile('static-entry-module.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  if (sourceFile.parseDiagnostics.length > 0) throw new Phase3AError('static_parse_failed', 'source has syntax diagnostics')

  const functions = new Map<string, ts.FunctionLikeDeclaration[]>()
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) {
      const name = inferredFunctionName(node, sourceFile)
      if (name) functions.set(name, [...functions.get(name) ?? [], node])
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  const ids = new Set<string>()
  const anchors = specs.map((spec): StaticAnchor => {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(spec.id) || ids.has(spec.id)) {
      throw new Phase3AError('static_spec_invalid', `invalid or duplicate static anchor id: ${spec.id}`)
    }
    ids.add(spec.id)
    const candidates = functions.get(spec.function_name) ?? []
    const matches = candidates.filter((node) => {
      const raw = text.slice(node.getStart(sourceFile), node.end)
      return spec.required_markers.every((marker) => raw.includes(marker))
    })
    if (matches.length !== 1) {
      throw new Phase3AError('static_anchor_missing', `${spec.id} expected one matching ${spec.function_name} function, found ${matches.length}`)
    }
    const node = matches[0]!
    const raw = text.slice(node.getStart(sourceFile), node.end)
    const calls = collectDirectCalls(node, sourceFile)
    const requiredCalls = [...new Set(spec.required_calls ?? [])].sort()
    for (const call of requiredCalls) {
      if (!calls.has(call)) throw new Phase3AError('static_call_edge_missing', `${spec.id} is missing direct call ${call}`)
    }
    const moduleOffset = node.getStart(sourceFile)
    return {
      id: spec.id,
      function_name: spec.function_name,
      node_kind: ts.SyntaxKind[node.kind] ?? String(node.kind),
      module_offset: moduleOffset,
      artifact_offset: options.artifact_offset + moduleOffset,
      length: node.end - moduleOffset,
      source_sha256: createHash('sha256').update(raw).digest('hex'),
      direct_calls: requiredCalls,
      cfg: cfgSummary(node),
    }
  })

  const constantAnchors = constantSpecs.map((spec): StaticConstantAnchor => {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(spec.id) || ids.has(spec.id)) {
      throw new Phase3AError('static_spec_invalid', `invalid or duplicate static anchor id: ${spec.id}`)
    }
    ids.add(spec.id)
    const matches: ts.Node[] = []
    const collect = (node: ts.Node): void => {
      const symbolMatches = spec.node_kind === 'assignment'
        ? ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(sourceFile) === spec.symbol_name
        : ts.isVariableDeclaration(node) && node.name.getText(sourceFile) === spec.symbol_name
      if (symbolMatches) {
        const raw = text.slice(node.getStart(sourceFile), node.end)
        if (spec.required_markers.every((marker) => raw.includes(marker))) matches.push(node)
      }
      ts.forEachChild(node, collect)
    }
    collect(sourceFile)
    if (matches.length !== 1) {
      throw new Phase3AError('static_anchor_missing', `${spec.id} expected one matching ${spec.symbol_name} ${spec.node_kind}, found ${matches.length}`)
    }
    const node = matches[0]!
    const raw = text.slice(node.getStart(sourceFile), node.end)
    const moduleOffset = node.getStart(sourceFile)
    return {
      id: spec.id,
      symbol_name: spec.symbol_name,
      node_kind: spec.node_kind === 'assignment' ? 'BinaryExpression' : 'VariableDeclaration',
      module_offset: moduleOffset,
      artifact_offset: options.artifact_offset + moduleOffset,
      length: node.end - moduleOffset,
      source_sha256: createHash('sha256').update(raw).digest('hex'),
    }
  })

  const payload = {
    parser: 'typescript-compiler-api' as const,
    parser_version: ts.version,
    source_bytes: source.length,
    source_sha256: sha256Bytes(source),
    source_persisted: false as const,
    anchors,
    constant_anchors: constantAnchors,
  }
  return { ...payload, scan_digest: sha256Bytes(canonicalJson(payload)) }
}

export const claudeCode215StaticAnchorSpecs: StaticAnchorSpec[] = [
  { id: 'entrypoint-version', function_name: 'qb', required_markers: ['VERSION:"2.1.215"'] },
  { id: 'argv-start-classifier', function_name: 'sSl', required_markers: ['--resume', '--continue'] },
  { id: 'cli-option-grammar', function_name: 'iKf', required_markers: ['--bare', '--verbose', '-p, --print', '-r, --resume [value]', '--output-format <format>', '--input-format <format>', '--session-id <uuid>', '--no-session-persistence'] },
  { id: 'cli-operation-validation', function_name: 'h5f', required_markers: ['--session-id can only be used', 'Invalid session ID'] },
  { id: 'config-root-env', function_name: 'ksl', required_markers: ['CLAUDE_CONFIG_DIR'] },
  { id: 'config-root-provider', function_name: 'on', required_markers: ['ksl()??', 'homedir()', '.normalize("NFC")'], required_calls: ['homedir', 'join', 'ksl', 'normalize'] },
  { id: 'cwd-canonicalization', function_name: 'Cnl', required_markers: ['realpathSync', 'originalCwd'] },
  { id: 'project-path-hash', function_name: 'oQe', required_markers: ['charCodeAt', 't<<5'] },
  { id: 'project-path-hash-encoding', function_name: 'v8m', required_markers: ['Math.abs', 'toString(36)'], required_calls: ['oQe'] },
  { id: 'project-path-sanitizer', function_name: 'PA', required_markers: ['replace(/[^a-zA-Z0-9]/g,"-")'] },
  { id: 'project-root-derivation', function_name: 'gq', required_markers: ['"projects"'], required_calls: ['on'] },
  { id: 'project-directory-derivation', function_name: 'bb', required_markers: ['dat.join(gq(),PA(e))'], required_calls: ['PA', 'gq'] },
  { id: 'state-path-derivation', function_name: 'fy', required_markers: ['.jsonl'], required_calls: ['J5', 'Tt', 'bb', 'ln'] },
  { id: 'state-jsonl-writer', function_name: 'tQ', required_markers: ['appendFile', 'mode:384'] },
  { id: 'state-selector-parser', function_name: 'Cni', required_markers: ['.jsonl', 'randomUUID'] },
  { id: 'state-file-resolver', function_name: 'Wz_', required_markers: ['.jsonl'], required_calls: ['J5', 'bb', 'dL', 'ln'] },
  { id: 'state-jsonl-reader', function_name: 'P1e', required_markers: ['readFile', 'nZe('] },
  { id: 'state-read-resolver-bridge', function_name: 'QMd', required_markers: ['sessionFile:r'], required_calls: ['P1e', 'Wz_'] },
  { id: 'state-message-reconstructor', function_name: 'xGe', required_markers: ['messages:n', 'n.size===0'], required_calls: ['QMd'] },
  { id: 'state-jsonl-tolerant-parser', function_name: 'm7m', required_markers: ['JSON.parse', 'catch{}'] },
  { id: 'resume-loader', function_name: 'H1e', required_markers: ['session_resume', 'load_failed'], required_calls: ['I1e', 'xGe'] },
  { id: 'print-resume-router', function_name: 'K7f', required_markers: ['--resume requires a valid session ID', 'No conversation found'], required_calls: ['Cni', 'H1e'] },
  { id: 'headless-resume-bridge', function_name: 'lCS', required_markers: ['messages:I', 'G7f('], required_calls: ['G7f', 'K7f'] },
  { id: 'headless-message-runner', function_name: 'G7f', required_markers: ['mutableMessages:se', 'WVf('] },
  { id: 'message-transport-bridge', function_name: 'WVf', required_markers: ['initialMessages:k', 'submitMessage'], required_calls: ['GVf'] },
  { id: 'query-message-input', function_name: 'submitMessage', required_markers: ['messages:Ze', '$ne('], required_calls: ['$ne'] },
  { id: 'query-generator-bridge', function_name: '$ne', required_markers: ['Rtd(e,t)'], required_calls: ['Rtd'] },
  { id: 'query-pipeline', function_name: 'Rtd', required_markers: ['e.deps??ntd()', 'callModel'], required_calls: ['ntd'] },
  { id: 'default-model-dispatch', function_name: 'ntd', required_markers: ['callModel:Vrr'] },
  { id: 'model-call-bridge', function_name: 'Vrr', required_markers: ['xad('], required_calls: ['gEs'] },
  { id: 'request-normalizer', function_name: 'JS_', required_markers: ['messagesForAPI'] },
  { id: 'request-serializer', function_name: 'QS_', required_markers: ['api_system', 'role:"system"', 'PS_('] },
  { id: 'network-request-sink', function_name: 'xad', required_markers: ['beta.messages.create', 'messages:jl', 'QS_('], required_calls: ['JS_'] },
  { id: 'sdk-base-url-precedence', function_name: 'constructor', required_markers: ['baseURL:e=HA("ANTHROPIC_BASE_URL")', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'], required_calls: ['HA'] },
  { id: 'sdk-message-post-route', function_name: 'create', required_markers: ['this._client.post("/v1/messages"', 'stream:e.stream??!1'], required_calls: ['post'] },
  { id: 'persistence-disable-gate', function_name: 'rKf', required_markers: ['sessionPersistence===!1', 'Gii(!0)'], required_calls: ['Gii'] },
]

export const claudeCode215StaticConstantSpecs: StaticConstantAnchorSpec[] = [
  { id: 'config-root-assignment', symbol_name: 'on', node_kind: 'assignment', required_markers: ['on=Nr(', 'ksl()??', '".claude"', 'normalize("NFC")'] },
  { id: 'project-key-length-constant', symbol_name: 'YEt', node_kind: 'variable', required_markers: ['YEt=200'] },
]

export const claudeCode215StaticScanDigest = 'cac6799818f1f6780280d993adcb24cf2a834f7f5fd048a9c82fa35d0e464928'

function safeRef(kind: 'root', value: unknown): string {
  const digest = sha256Bytes(Buffer.concat([
    Buffer.from(`oracle-lab/p3a-s/safe-ref/v1/${kind}\0`, 'utf8'),
    Buffer.from(canonicalJson(value), 'utf8'),
  ]))
  return `sr1:${kind}:sha256:${digest}`
}

function validateAnchorScan(scan: StaticAnchorScan): StaticAnchorScan {
  const payload = {
    parser: scan.parser,
    parser_version: scan.parser_version,
    source_bytes: scan.source_bytes,
    source_sha256: scan.source_sha256,
    source_persisted: scan.source_persisted,
    anchors: scan.anchors,
    constant_anchors: scan.constant_anchors,
  }
  if (scan.parser !== 'typescript-compiler-api' || scan.parser_version !== '5.9.3'
    || scan.source_bytes !== 20_163_513
    || scan.source_sha256 !== '67472f5f9cd28b3b83003eb29ee0747bdcebc6969cc14f726bfdae2e4d998d0f'
    || scan.source_persisted !== false
    || scan.scan_digest !== sha256Bytes(canonicalJson(payload))
    || scan.scan_digest !== claudeCode215StaticScanDigest) {
    throw new Phase3AError('static_scan_invalid', 'static anchor scan binding mismatch')
  }
  if (scan.anchors.length !== claudeCode215StaticAnchorSpecs.length) {
    throw new Phase3AError('static_scan_invalid', 'static anchor scan count mismatch')
  }
  if (scan.constant_anchors.length !== claudeCode215StaticConstantSpecs.length) {
    throw new Phase3AError('static_scan_invalid', 'static constant anchor scan count mismatch')
  }
  claudeCode215StaticAnchorSpecs.forEach((spec, index) => {
    const anchor = scan.anchors[index]
    if (!anchor || anchor.id !== spec.id || anchor.function_name !== spec.function_name
      || anchor.artifact_offset !== 217_140_984 + anchor.module_offset) {
      throw new Phase3AError('static_scan_invalid', `static anchor order or location mismatch: ${spec.id}`)
    }
  })
  claudeCode215StaticConstantSpecs.forEach((spec, index) => {
    const anchor = scan.constant_anchors[index]
    if (!anchor || anchor.id !== spec.id || anchor.symbol_name !== spec.symbol_name
      || anchor.artifact_offset !== 217_140_984 + anchor.module_offset) {
      throw new Phase3AError('static_scan_invalid', `static constant anchor order or location mismatch: ${spec.id}`)
    }
  })
  return scan
}

type StaticRecordBindings = {
  safe_input_root: string
  tool_sha256: string
  schema_sha256: string
}

const safeFixtureBindings = [
  { input_kind: 'exit-v13', relative_path: 'phase-3a-exit-report-v13.json', sha256: '57f16b207933b3a751f96471733d435fa4b0c9801fbef2f5495e8884dfe0bd1b', schema_version: 'oracle-lab-phase3a-exit.v1' },
  { input_kind: 'handoff-v13', relative_path: 'phase-3b-3.5-handoff-v13.json', sha256: '9d188072719dc27a2f9cc9939bc79afa598802b84dd4d9161fb1da3263a792d7', schema_version: 'oracle-lab-phase3a-handoff.v1' },
  { input_kind: 'terminal-v8', relative_path: 'closure-terminal-manifest-v8.json', sha256: 'c9ee57fbe29125c88278961565f814326b052077b861bb41008cdde6161f12f5', schema_version: 'oracle-lab-phase3a-r4-terminal.v1' },
  { input_kind: 'artifact-index-v23', relative_path: 'artifact-index-v23.json', sha256: 'e8645c7ed4bc984a926f91e3df1b756c4b009b3a02408de213cbe81b060e80d4', schema_version: 'oracle-lab-phase3a-artifact-index.v1' },
  { input_kind: 'leak-scan-v23', relative_path: 'leak-scan-v23.json', sha256: '7ed3e2776c7fcc47d6c8d513318b33547919c92a33a068a4f0c0cb3706bad145', schema_version: 'oracle-lab-phase3a-leak-scan.v1' },
] as const

export function verifyStaticSafeInputs(rootInput: string): Record<string, unknown>[] {
  let root: string
  try {
    const lexicalRoot = path.resolve(rootInput)
    const stat = lstatSync(lexicalRoot)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('root is not a non-symlink directory')
    root = realpathSync(lexicalRoot)
    if (root !== lexicalRoot) throw new Error('root realpath differs from the declared root')
  } catch (error) {
    throw new Phase3AError('static_safe_input_root_invalid', `safe input root validation failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  const rootSafeRef = safeRef('root', root)
  return safeFixtureBindings.map((expected) => {
    const file = path.join(root, expected.relative_path)
    try {
      const stat = lstatSync(file)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('fixture is not a non-symlink regular file')
      const realFile = realpathSync(file)
      const relative = path.relative(root, realFile)
      if (relative !== expected.relative_path || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture escapes or changes its exact relative path')
      const bytes = readFileSync(file)
      if (sha256Bytes(bytes) !== expected.sha256) throw new Error('fixture SHA-256 mismatch')
      const value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
      const observedSchema = value.schema_version ?? (typeof value.schema_id === 'string' && Number.isInteger(value.schema_major) && Number.isInteger(value.schema_revision)
        ? `${value.schema_id}@${value.schema_major}.${value.schema_revision}`
        : null)
      if (observedSchema !== expected.schema_version) throw new Error('fixture schema mismatch')
      return {
        input_kind: expected.input_kind,
        root_safe_ref: rootSafeRef,
        relative_path: expected.relative_path,
        sha256: expected.sha256,
        schema_version: expected.schema_version,
        binding_checks: {
          regular_file: true,
          symlink: false,
          sha256_match: true,
          schema_match: true,
          realpath_contained: true,
        },
      }
    } catch (error) {
      throw new Phase3AError('static_safe_input_invalid', `${expected.input_kind} validation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
}

function literal(index: number, value: string): Record<string, unknown> {
  return { index, token_class: 'literal', literal: value, safe_ref_name: null }
}

function ref(index: number, name: string): Record<string, unknown> {
  return { index, token_class: 'safe-ref', literal: null, safe_ref_name: name }
}

function operation(
  operationClass: 'creation' | 'new-control' | 'resume-positive',
  selector: 'explicit-new-session-uuid' | 'explicit-resume-session-uuid',
  sessionRef: string,
  stateRootRef: string,
): Record<string, unknown> {
  const selectorFlag = operationClass === 'resume-positive' ? '--resume' : '--session-id'
  return {
    operation_class: operationClass,
    parser_route: operationClass === 'resume-positive' ? 'resume' : 'fresh',
    selector,
    state_root_safe_ref_name: stateRootRef,
    cwd_safe_ref_name: operationClass === 'new-control' ? 'new-control-cwd' : 'creation-resume-cwd',
    argv: [
      literal(0, '--print'),
      literal(1, '--bare'),
      literal(2, '--verbose'),
      literal(3, '--output-format'),
      literal(4, 'stream-json'),
      literal(5, '--input-format'),
      literal(6, 'stream-json'),
      literal(7, selectorFlag),
      ref(8, sessionRef),
    ],
    stdin: {
      input_class: 'manifest-bound-synthetic-stream-json',
      digest_required: true,
      positional_prompt: false,
    },
    state_effect: operationClass === 'creation'
      ? 'target-creates-predecessor-jsonl'
      : operationClass === 'new-control'
        ? 'independent-fresh-control-no-predecessor'
        : 'target-resolves-reads-reconstructs-predecessor-jsonl',
  }
}

const exactArgvRules = {
  options_before_separator: true,
  positional_prompt_allowed: false,
  continue_allowed: false,
  fork_session_allowed: false,
  no_session_persistence_allowed: false,
}

const exactEnvironment = {
  allowlist: [
    { name: 'ANTHROPIC_API_KEY', value_class: 'synthetic-placeholder-credential' },
    { name: 'ANTHROPIC_BASE_URL', value_class: 'declared-loopback-url' },
    { name: 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', value_class: 'disabled-boolean' },
    { name: 'NO_PROXY', value_class: 'loopback-only-bypass' },
    { name: 'PATH', value_class: 'system-binary-path' },
    { name: 'TERM', value_class: 'terminal-class' },
    { name: 'no_proxy', value_class: 'loopback-only-bypass' },
  ],
  derived_keys: ['CLAUDE_CODE_TMPDIR', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'LC_ALL', 'TEMP', 'TMP', 'TMPDIR', 'TZ', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'],
  explicit_empty: [],
  unset: ['ALL_PROXY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_API_BASE_URL', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_OAUTH_TOKEN', 'HTTPS_PROXY', 'HTTP_PROXY', 'SSH_AUTH_SOCK'],
  fake_upstream_endpoint_binding: {
    environment_key: 'ANTHROPIC_BASE_URL',
    endpoint_safe_ref_name: 'fake-upstream-endpoint',
    address_class: 'declared-loopback-http',
    port_source: 'launch-manifest.network.loopback_ports[0]',
    external_socket_budget: 0,
  },
  message_base_url_precedence: 'explicit-client-baseURL-or-ANTHROPIC_BASE_URL-or-sdk-default',
  raw_values_persisted: false,
}

const exactStateStorage = {
  config_root_derivation: 'NFC-normalize(CLAUDE_CONFIG_DIR-if-nonempty-else-join(homedir,.claude))',
  project_root_derivation: 'join(config-root,projects)',
  project_key_replacement: 'javascript-regex-replace(/[^a-zA-Z0-9]/g,"-")',
  project_key_length_limit_utf16_code_units: 200,
  project_key_overflow: 'sanitized.slice(0,200)-plus-hyphen-plus-base36(abs(js-string-hash(original-cwd)))',
  project_directory_derivation: 'join(project-root,project-key)',
  state_path_derivation: 'join(project-directory,session-uuid-plus-.jsonl)',
  directory_mode: '0o700',
  file_mode: '0o600',
  format: 'UTF8-JSON-object-per-line-LF',
  write_operation: 'queued-append',
  read_operation: 'resolve-read-parse-reconstruct-parent-chain',
  whole_file_cryptographic_integrity: false,
  malformed_line_behavior: 'line-local-parse-failure-may-be-ignored',
}

const exactSelectorConsumption = {
  new_session: 'session-id-option-valid-uuid-must-not-already-exist',
  resume: 'resume-option-uuid-to-project-jsonl-resolver',
  message_selection: 'optional-resume-session-at-must-resolve-in-reconstructed-chain',
  persistence_gate: 'session-persistence-must-remain-enabled',
}

const exactLaunchBinding = {
  executable_digest_checked_before_spawn: true,
  stdin_digest_checked_before_spawn: true,
  spawn_adapter: 'darwin-sandbox-exec-direct-child',
  shell: false,
  cwd: 'isolated-manifest-directory',
  environment: 'explicit-isolated-map',
  target_pid_rule: 'unique-descendant-with-executable-sha256-and-process-start-bound-to-run',
}

const exactCwd = {
  source: 'process.cwd',
  primary_normalization: 'realpathSync',
  fallback: 'lexical-path-resolve',
  original_cwd_retained_in_memory: true,
  durable_absolute_path: false,
}

const exactDenyBranches = [
  { condition: 'missing-predecessor', target_behavior: 'no-conversation-found-or-load-failed', future_gate: 'deny-no-resume-request', anchor_ids: ['print-resume-router', 'resume-loader'] },
  { condition: 'invalid-or-ambiguous-selector', target_behavior: 'invalid-session-or-ambiguous-title-error', future_gate: 'deny', anchor_ids: ['state-selector-parser', 'print-resume-router'] },
  { condition: 'live-background-session', target_behavior: 'resume-refused', future_gate: 'deny', anchor_ids: ['print-resume-router'] },
  { condition: 'wrong-resume-message', target_behavior: 'message-id-not-found', future_gate: 'deny', anchor_ids: ['print-resume-router'] },
  { condition: 'tampered-state', target_behavior: 'target-parser-may-ignore-malformed-lines', future_gate: 'deny-on-observer-b-pre-open-digest-mismatch', anchor_ids: ['state-jsonl-tolerant-parser', 'state-jsonl-reader'] },
  { condition: 'persistence-disabled', target_behavior: 'state-write-suppressed', future_gate: 'deny-protocol-mutation', anchor_ids: ['persistence-disable-gate'] },
]

const exactStateToNetworkFlow = [
  { from: 'state-file-resolver', to: 'state-read-resolver-bridge', relation: 'resolved-path-argument' },
  { from: 'state-jsonl-reader', to: 'state-read-resolver-bridge', relation: 'parsed-state-return' },
  { from: 'state-read-resolver-bridge', to: 'state-message-reconstructor', relation: 'state-map-return' },
  { from: 'state-message-reconstructor', to: 'resume-loader', relation: 'reconstructed-conversation-return' },
  { from: 'resume-loader', to: 'print-resume-router', relation: 'resume-state-return' },
  { from: 'print-resume-router', to: 'headless-resume-bridge', relation: 'messages-return' },
  { from: 'headless-resume-bridge', to: 'headless-message-runner', relation: 'messages-argument' },
  { from: 'headless-message-runner', to: 'message-transport-bridge', relation: 'nested-callback-messages' },
  { from: 'message-transport-bridge', to: 'query-message-input', relation: 'initial-to-mutable-messages' },
  { from: 'query-message-input', to: 'query-generator-bridge', relation: 'mutable-copy-plus-current-input' },
  { from: 'query-generator-bridge', to: 'query-pipeline', relation: 'query-input' },
  { from: 'query-pipeline', to: 'default-model-dispatch', relation: 'dependency-construction' },
  { from: 'default-model-dispatch', to: 'model-call-bridge', relation: 'call-model-binding' },
  { from: 'model-call-bridge', to: 'network-request-sink', relation: 'nested-generator-request' },
  { from: 'network-request-sink', to: 'request-normalizer', relation: 'message-normalization' },
  { from: 'network-request-sink', to: 'request-serializer', relation: 'request-builder-serialization' },
  { from: 'network-request-sink', to: 'sdk-message-post-route', relation: 'sdk-method-dispatch' },
]

const exactRequestSurface = {
  method: 'POST',
  path_class: '/v1/messages',
  ast_location: '$.messages',
  terminal_sink: 'beta.messages.create',
  base_url_source: 'ANTHROPIC_BASE_URL-bound-fake-upstream-endpoint-safe-ref',
}

const exactFreshResumeDiscriminator = {
  creation_expected: 'creation-request-plus-response-safe-conversation-topology',
  fresh_expected: 'current-input-only-no-predecessor-prefix',
  resume_expected: 'ordered-predecessor-prefix-before-final-current-input',
  minimum_predecessor_assistant_entries: 1,
  comparison: 'resume-prefix-equals-creation-safe-exchange-projection',
}

const exactProjectionAlgorithm = {
  version: 'p3as-predecessor-prefix-projection-v1',
  input: 'loopback-fake-upstream-request-json-ast-$.messages',
  ordered_steps: [
    'parse-request-body-as-json',
    'select-messages-array',
    'map-each-message-to-role-and-ordered-content-block-shape-without-values',
    'split-final-message-as-current-input',
    'require-nonempty-predecessor-prefix',
    'compare-resume-predecessor-prefix-to-creation-safe-exchange-projection',
  ],
  canonicalization: 'RFC8785-JCS',
  current_input_position: 'final-array-element',
  minimum_predecessor_assistant_entries: 1,
  raw_values_persisted: false,
}

const exactSafeProjection = {
  allowed_fields: ['array-cardinality', 'content-block-count', 'content-block-order', 'content-block-type', 'object-field-name-class', 'role-order', 'sse-event-class-order'],
  raw_values_persisted: false,
  session_ids_persisted: false,
  credentials_persisted: false,
  headers_persisted: false,
  body_bytes_persisted: false,
}

const exactObserverA = {
  observer_kind: 'network-state-signal',
  capture_surface: 'loopback-fake-upstream-http-json-ast-and-sse-topology',
  parser_class: 'http-json-ast-safe-projector',
  proves: 'predecessor-conversation-topology-reached-target-generated-request',
  failure_mode: 'request-or-ast-or-sse-capture-missing-or-mismatched',
}

const exactObserverB = {
  observer_kind: 'darwin-state-process',
  capture_surface: 'darwin-vnode-open-read-plus-process-start-attribution',
  parser_class: 'filesystem-process-event-safe-projector',
  proves: 'exact-predecessor-jsonl-was-opened-read-by-bound-target-process',
  failure_mode: 'vnode-event-or-pid-start-or-executable-attribution-missing-or-mismatched',
}

const signalAnchorIds = [
  'state-jsonl-reader',
  'state-read-resolver-bridge',
  'state-message-reconstructor',
  'resume-loader',
  'print-resume-router',
  'headless-resume-bridge',
  'headless-message-runner',
  'message-transport-bridge',
  'query-message-input',
  'query-generator-bridge',
  'query-pipeline',
  'default-model-dispatch',
  'model-call-bridge',
  'network-request-sink',
  'request-normalizer',
  'request-serializer',
  'sdk-base-url-precedence',
  'sdk-message-post-route',
]

function exactOperations(): Record<string, unknown>[] {
  return [
    operation('creation', 'explicit-new-session-uuid', 'creation-session-uuid', 'creation-state-root'),
    operation('new-control', 'explicit-new-session-uuid', 'new-control-session-uuid', 'new-control-state-root'),
    operation('resume-positive', 'explicit-resume-session-uuid', 'predecessor-session-uuid', 'creation-state-root'),
  ]
}

function buildExactStateProtocol(): Record<string, unknown> {
  return {
    status: 'static-recovered',
    evidence_level: 'Static-Recovered',
    operations: exactOperations(),
    argv_rules: exactArgvRules,
    environment: exactEnvironment,
    cwd: exactCwd,
    state_storage: exactStateStorage,
    selector_consumption: exactSelectorConsumption,
    launch_binding: exactLaunchBinding,
    deny_branches: exactDenyBranches,
  }
}

function anchorIdentityDigest(anchors: StaticAnchor[]): string {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const identities = signalAnchorIds.map((id) => {
    const anchor = byId.get(id)
    if (!anchor) throw new Phase3AError('static_record_invalid', `signal anchor is missing: ${id}`, '$.static_anchors')
    return {
      id: anchor.id,
      module_offset: anchor.module_offset,
      length: anchor.length,
      source_sha256: anchor.source_sha256,
    }
  })
  return sha256Bytes(canonicalJson(identities))
}

function buildStateDependentNetworkSignal(anchors: StaticAnchor[]): Record<string, unknown> {
  const signalAnchorDigest = anchorIdentityDigest(anchors)
  const derivation = {
    artifact_executable_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
    signal_anchor_digest: signalAnchorDigest,
    request_surface: exactRequestSurface,
    state_to_network_flow: exactStateToNetworkFlow,
    fresh_resume_discriminator: exactFreshResumeDiscriminator,
    projection_algorithm: exactProjectionAlgorithm,
  }
  return {
    status: 'static-recovered',
    evidence_level: 'Static-Recovered',
    signal_class: 'request-messages-predecessor-prefix-topology',
    request_surface: exactRequestSurface,
    state_to_network_flow: exactStateToNetworkFlow,
    fresh_resume_discriminator: exactFreshResumeDiscriminator,
    projection_algorithm: exactProjectionAlgorithm,
    safe_projection: exactSafeProjection,
    signal_anchor_digest: signalAnchorDigest,
    derivation_digest: sha256Bytes(canonicalJson(derivation)),
    observer_a: exactObserverA,
    observer_b: exactObserverB,
    proof_rule: {
      both_observers_required: true,
      terminal_builder_only_agreement: true,
      observer_a_alone_sufficient: false,
      observer_b_alone_sufficient: false,
      ordinary_fresh_http_sufficient: false,
      absence_inference_sufficient: false,
      controller_supplied_proof_sufficient: false,
      same_byte_stream_two_parsers_sufficient: false,
    },
    negative_controls: [
      { mutation: 'missing-predecessor', observer_a_expected: 'no-valid-state-dependent-prefix', observer_b_expected: 'no-valid-bound-read', outcome: 'deny' },
      { mutation: 'tampered-predecessor', observer_a_expected: 'irrelevant-if-target-tolerates-line', observer_b_expected: 'pre-open-digest-mismatch', outcome: 'deny' },
      { mutation: 'swapped-predecessor', observer_a_expected: 'prefix-projection-mismatch-or-wrong-lineage', observer_b_expected: 'path-digest-creation-tuple-mismatch', outcome: 'deny' },
      { mutation: 'fresh-session-fallback', observer_a_expected: 'current-input-only', observer_b_expected: 'no-bound-predecessor-read', outcome: 'deny' },
      { mutation: 'wrong-reader-pid-or-process-start', observer_a_expected: 'not-sufficient', observer_b_expected: 'attribution-mismatch', outcome: 'deny' },
      { mutation: 'nonterminal-predecessor', observer_a_expected: 'not-sufficient', observer_b_expected: 'state-terminal-class-mismatch', outcome: 'deny' },
    ],
  }
}

export function buildClaudeCode215StaticBlockerReconRecord(
  scanInput: StaticAnchorScan,
  bindings: StaticRecordBindings,
): Record<string, unknown> {
  const scan = validateAnchorScan(scanInput)
  if (!isSha256(bindings.tool_sha256) || !isSha256(bindings.schema_sha256)) {
    throw new Phase3AError('static_binding_invalid', 'tool and schema digests must be SHA-256 values')
  }
  const safeInputs = verifyStaticSafeInputs(bindings.safe_input_root)

  const base: Record<string, unknown> = {
    schema_id: 'oracle-lab-phase3a-static-blocker-recon@1.0',
    schema_major: 1,
    schema_revision: 0,
    record_kind: 'static-blocker-recon',
    authority: {
      lifecycle_from: 'BLOCKERS_OPEN',
      lifecycle_to: 'RECON_APPEND_ONLY_CLOSED',
      merged_plan: {
        relative_path: 'docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3a-resume-supplement.md',
        sha256: 'c13969d1d838e3a921eda8d7a0491fa0472ed35f15bb3ea7374a7b3d153059a6',
      },
      phase3b_authority: {
        relative_path: 'docs/superpowers/plans/2026-07-22-claude-code-2.1.215-phase-3b-profile-synthesis.md',
        sha256: '0687ccaea710647a357993aaefc389078d68f54c2d5ae51f6710d63c2e3906d3',
      },
      cc_gateway: {
        remote_ref: 'muqihang/main',
        commit: '7a61020761216e3d80ce76f5e2b253f7e2c16a52',
        tree: 'd1d99adad0a40b167fd6bc92b1bc0be167280617',
      },
      sub2api: {
        remote_ref: 'muqihang/main',
        commit: 'fb840673afc0ff590fef9bb147fce5b9b70eb098',
        tree: 'eeb8654eddf7a4c38364202f5024161e65d2a6d1',
      },
      p2_contract: {
        bundle_sha256: '2545113fb928131ee5a735541b5373a00566b279263aca5b1cc11181aaf78bce',
        predecessor_sha256: '70c26db06e9135db31d08f097573e3fd55bd9a8894614832eefeecabf6b1a3d1',
        schema_range: '1:0-0',
      },
      recon_tool: {
        relative_path: 'tools/oracle-lab/phase3a/static-blocker-recon.ts',
        sha256: bindings.tool_sha256,
      },
      record_schema: {
        relative_path: 'docs/superpowers/schemas/oracle-lab-phase3a-static-blocker-recon.schema.json',
        sha256: bindings.schema_sha256,
      },
      append_only_contract: {
        relative_path: 'docs/superpowers/evidence/phase3a/claude-code-2.1.215-p3as-static-blocker-recon-v1.json',
        write_mode: 'exclusive-0o600',
        size_ceiling_bytes: 262_144,
        canonicalization: 'RFC8785-JCS-UTF8-final-LF',
        digest_scope: 'JCS-without-record_digest',
        future_dag_binding: 'pinned_inputs',
        mutates_v13: false,
      },
    },
    artifact: {
      active_target: 'Claude Code 2.1.215',
      platform: 'darwin',
      architecture: 'arm64',
      release_archive_sha256: '599883973d2b4c8bb25e3490c84d65646f78d158cdc86adc73c1f5a6cfbbd600',
      release_tree_sha256: 'f5a04795289524b639b479fe6ffac187218d7c558a5a5be312ee228850c6e7fe',
      launcher_class: 'direct-native-entrypoint',
      launcher_relative_path: 'claude',
      executable_sha256: '90608b5c5ab504e96e77365cea6203d046e291d59b2bb42cf28dcb2ccdf9dd58',
      executable_size_bytes: 247_124_336,
      executable_format: 'Mach-O-64-arm64-thin-PIE',
      codesign: {
        verification: 'valid',
        identifier: 'com.anthropic.claude-code',
        team_identifier: 'Q6L2SF6YDW',
      },
      v13_identity_bridge: {
        wrapper_archive_sha256: '1a5cf8e491689154264c0b2f28371bf645cdee2903b45c497915868308502d7b',
        wrapper_tree_sha256: '024fa410b532ced37cd9e45a95aae6f9eb22e9ce8491e1fad843f24d958f4a88',
        platform_archive_sha256: 'b5dd6a135c96957dae232218c4ae5b04328a788f8c509202c92a2fec550601b2',
        platform_tree_sha256: '864f493d9fc237df6a858e1620c83279b8f6c15f205dbb47c058f3f537e924a6',
      },
      entry_module: {
        candidate_id: 'candidate-cf14ef8-67472f5f9cd28b3b',
        artifact_offset: 217_140_984,
        byte_length: 20_163_513,
        source_sha256: '67472f5f9cd28b3b83003eb29ee0747bdcebc6969cc14f726bfdae2e4d998d0f',
        parser: scan.parser,
        parser_version: scan.parser_version,
        scan_digest: scan.scan_digest,
        raw_source_persisted_in_repository: false,
      },
    },
    codegraph: {
      exclusion_sha256: 'f885ea40698ff4de9881ce6a9537388ce80c04be9515bf2c77ac186d39140e98',
      config_scope: 'local-only-untracked',
      repositories: [
        { repository: 'cc-gateway', files: 264, nodes: 9_362, edges: 32_675, protected_count: 0 },
        { repository: 'sub2api', files: 3_064, nodes: 98_766, edges: 331_888, protected_count: 0 },
      ],
      protected_count: 0,
      refresh: 'fresh-main-isolated-worktrees',
    },
    safe_inputs: safeInputs,
    exact_state_protocol: buildExactStateProtocol(),
    state_dependent_network_signal: buildStateDependentNetworkSignal(scan.anchors),
    static_anchors: scan.anchors,
    static_constants: scan.constant_anchors,
    searched_surfaces: [
      'archive-identity-and-tree',
      'bun-standalone-module-table',
      'bounded-cfg-neighborhoods',
      'cli-option-parser-and-validation',
      'config-cwd-and-state-path-derivation',
      'darwin-macho-and-codesign',
      'jsonl-writer-reader-and-reconstruction',
      'request-normalization-serialization-and-sink',
      'resume-routing-fallback-and-deny-branches',
      'typescript-ast-call-new-and-literal-xrefs',
    ],
    negative_capabilities: [
      { capability: 'dynamic-runtime-corroboration', status: 'NOT_PERFORMED', consequence: 'static closure does not establish runtime success' },
      { capability: 'target-state-cryptographic-integrity', status: 'ABSENT_IN_STATIC_PATH', consequence: 'future observer-b pre-open digest gate is mandatory' },
      { capability: 'header-or-session-id-as-resume-proof', status: 'INSUFFICIENT', consequence: 'only messages predecessor-prefix topology is accepted' },
      { capability: 'observer-b-host-availability', status: 'UNKNOWN_UNTIL_SEPARATE_PREFLIGHT', consequence: 'future supplement remains blocked if unavailable' },
      { capability: 'cross-platform-generalization', status: 'PROHIBITED', consequence: 'record applies only to Darwin arm64 2.1.215' },
      { capability: 'phase3b-runtime-use', status: 'PROHIBITED', consequence: 'separate reviewed controller decision remains required' },
    ],
    blocker_decision: {
      missing_exact_state_protocol: 'CLOSED',
      missing_state_dependent_network_signal: 'CLOSED',
      evidence_basis: 'independently-reproducible-static-anchor-and-safe-metadata-record',
      lifecycle: 'RECON_APPEND_ONLY_CLOSED',
      independent_review_gate: 'required-on-immutable-tip-before-any-controller-decision',
      controller_creation_authorized: false,
      dynamic_execution_authorized: false,
      phase3b_usable: false,
      next_action: 'separate-reviewed-controller-creation-decision-only',
    },
  }
  return { ...base, record_digest: computeStaticReconRecordDigest(base) }
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Phase3AError('static_record_invalid', 'expected object', path)
  return value as Record<string, unknown>
}

function expectExactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Phase3AError('static_record_invalid', 'unexpected or missing fields', path)
}

function expectCanonicalExact(value: unknown, expected: unknown, path: string): void {
  if (canonicalJson(value) !== canonicalJson(expected)) throw new Phase3AError('static_record_invalid', 'exact value mismatch', path)
}

function hasDirectedPath(edges: Array<{ from: string; to: string }>, start: string, end: string): boolean {
  const pending = [start]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.shift()!
    if (current === end) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) if (edge.from === current && !visited.has(edge.to)) pending.push(edge.to)
  }
  return false
}

export function computeStaticReconRecordDigest(value: Record<string, unknown>): string {
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'record_digest'))
  return sha256Bytes(canonicalJson(payload))
}

export function validateStaticBlockerReconRecord(value: unknown): Record<string, unknown> {
  const record = expectObject(value, '$')
  expectExactKeys(record, [
    'schema_id', 'schema_major', 'schema_revision', 'record_kind', 'authority', 'artifact', 'codegraph', 'safe_inputs',
    'exact_state_protocol', 'state_dependent_network_signal', 'static_anchors', 'static_constants', 'searched_surfaces', 'negative_capabilities',
    'blocker_decision', 'record_digest',
  ], '$')
  if (record.schema_id !== 'oracle-lab-phase3a-static-blocker-recon@1.0' || record.schema_major !== 1 || record.schema_revision !== 0 || record.record_kind !== 'static-blocker-recon') {
    throw new Phase3AError('static_record_invalid', 'schema discriminator mismatch')
  }
  if (!isSha256(record.record_digest) || record.record_digest !== computeStaticReconRecordDigest(record)) {
    throw new Phase3AError('static_record_invalid', 'record_digest mismatch', '$.record_digest')
  }

  if (!Array.isArray(record.safe_inputs) || record.safe_inputs.length !== safeFixtureBindings.length) {
    throw new Phase3AError('static_record_invalid', 'safe input count mismatch', '$.safe_inputs')
  }
  let rootSafeRef: string | null = null
  safeFixtureBindings.forEach((binding, index) => {
    const input = expectObject(record.safe_inputs[index], `$.safe_inputs[${index}]`)
    if (typeof input.root_safe_ref !== 'string' || !/^sr1:root:sha256:[a-f0-9]{64}$/.test(input.root_safe_ref)) {
      throw new Phase3AError('static_record_invalid', 'safe input root reference mismatch', `$.safe_inputs[${index}].root_safe_ref`)
    }
    rootSafeRef ??= input.root_safe_ref
    if (input.root_safe_ref !== rootSafeRef) throw new Phase3AError('static_record_invalid', 'safe input roots differ', '$.safe_inputs')
    expectCanonicalExact(input, {
      input_kind: binding.input_kind,
      root_safe_ref: rootSafeRef,
      relative_path: binding.relative_path,
      sha256: binding.sha256,
      schema_version: binding.schema_version,
      binding_checks: {
        regular_file: true,
        symlink: false,
        sha256_match: true,
        schema_match: true,
        realpath_contained: true,
      },
    }, `$.safe_inputs[${index}]`)
  })

  expectCanonicalExact(record.exact_state_protocol, buildExactStateProtocol(), '$.exact_state_protocol')

  if (!Array.isArray(record.static_anchors) || record.static_anchors.length !== claudeCode215StaticAnchorSpecs.length) {
    throw new Phase3AError('static_record_invalid', 'static anchor count mismatch', '$.static_anchors')
  }
  const anchors = record.static_anchors.map((entry, index) => {
    const anchor = expectObject(entry, `$.static_anchors[${index}]`) as StaticAnchor
    const spec = claudeCode215StaticAnchorSpecs[index]!
    if (anchor.id !== spec.id || anchor.function_name !== spec.function_name
      || anchor.artifact_offset !== 217_140_984 + anchor.module_offset
      || canonicalJson(anchor.direct_calls) !== canonicalJson([...new Set(spec.required_calls ?? [])].sort())
      || !Number.isSafeInteger(anchor.cfg?.node_count) || anchor.cfg.node_count < 1
      || !Number.isSafeInteger(anchor.cfg?.edge_count) || anchor.cfg.edge_count < 0) {
      throw new Phase3AError('static_record_invalid', `static anchor mismatch: ${spec.id}`, `$.static_anchors[${index}]`)
    }
    return anchor
  })
  if (!Array.isArray(record.static_constants) || record.static_constants.length !== claudeCode215StaticConstantSpecs.length) {
    throw new Phase3AError('static_record_invalid', 'static constant anchor count mismatch', '$.static_constants')
  }
  const constants = record.static_constants.map((entry, index) => {
    const anchor = expectObject(entry, `$.static_constants[${index}]`) as StaticConstantAnchor
    const spec = claudeCode215StaticConstantSpecs[index]!
    if (anchor.id !== spec.id || anchor.symbol_name !== spec.symbol_name
      || anchor.artifact_offset !== 217_140_984 + anchor.module_offset) {
      throw new Phase3AError('static_record_invalid', `static constant anchor mismatch: ${spec.id}`, `$.static_constants[${index}]`)
    }
    return anchor
  })
  const artifact = expectObject(record.artifact, '$.artifact')
  const entryModule = expectObject(artifact.entry_module, '$.artifact.entry_module')
  const scanPayload = {
    parser: entryModule.parser,
    parser_version: entryModule.parser_version,
    source_bytes: entryModule.byte_length,
    source_sha256: entryModule.source_sha256,
    source_persisted: false,
    anchors,
    constant_anchors: constants,
  }
  if (entryModule.scan_digest !== sha256Bytes(canonicalJson(scanPayload)) || entryModule.scan_digest !== claudeCode215StaticScanDigest) {
    throw new Phase3AError('static_record_invalid', 'static scan digest mismatch', '$.artifact.entry_module.scan_digest')
  }

  const signal = expectObject(record.state_dependent_network_signal, '$.state_dependent_network_signal')
  expectCanonicalExact(signal, buildStateDependentNetworkSignal(anchors), '$.state_dependent_network_signal')
  const flow = expectObject(signal, '$.state_dependent_network_signal').state_to_network_flow as Array<{ from: string; to: string }>
  if (!hasDirectedPath(flow, 'state-jsonl-reader', 'sdk-message-post-route')) {
    throw new Phase3AError('static_record_invalid', 'state-to-network flow is disconnected', '$.state_dependent_network_signal.state_to_network_flow')
  }

  const decision = expectObject(record.blocker_decision, '$.blocker_decision')
  if (decision.missing_exact_state_protocol !== 'CLOSED' || decision.missing_state_dependent_network_signal !== 'CLOSED') {
    throw new Phase3AError('static_record_invalid', 'both static blockers must be closed', '$.blocker_decision')
  }
  if (decision.phase3b_usable !== false || decision.dynamic_execution_authorized !== false || decision.lifecycle !== 'RECON_APPEND_ONLY_CLOSED') {
    throw new Phase3AError('static_record_invalid', 'static closure cannot authorize dynamic execution or Phase 3B', '$.blocker_decision')
  }
  return record
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = argument('--source')
  const scanInput = argument('--scan-input')
  const safeInputRoot = argument('--safe-input-root')
  const output = argument('--out')
  const artifactOffset = Number(argument('--artifact-offset'))
  if (!output || Boolean(source) === Boolean(scanInput)) {
    throw new Phase3AError('usage', 'provide exactly one of --source or --scan-input with --out')
  }
  if (scanInput) {
    if (!safeInputRoot) throw new Phase3AError('usage', '--safe-input-root is required with --scan-input')
    const schemaUrl = new URL('../../../docs/superpowers/schemas/oracle-lab-phase3a-static-blocker-recon.schema.json', import.meta.url)
    const record = buildClaudeCode215StaticBlockerReconRecord(
      JSON.parse(readFileSync(scanInput, 'utf8')) as StaticAnchorScan,
      {
        safe_input_root: safeInputRoot,
        tool_sha256: sha256Bytes(readFileSync(fileURLToPath(import.meta.url))),
        schema_sha256: sha256Bytes(readFileSync(fileURLToPath(schemaUrl))),
      },
    )
    const payload = `${canonicalJson(record)}\n`
    if (Buffer.byteLength(payload) > 262_144) throw new Phase3AError('static_record_oversize', 'static recon record exceeds 256 KiB')
    writeFileSync(output, payload, { mode: 0o600, flag: 'wx' })
  } else {
    if (!source || !Number.isSafeInteger(artifactOffset) || artifactOffset < 0) {
      throw new Phase3AError('usage', '--source requires --artifact-offset N')
    }
    const scan = scanStaticAnchors(
      readFileSync(source),
      claudeCode215StaticAnchorSpecs,
      { artifact_offset: artifactOffset },
      claudeCode215StaticConstantSpecs,
    )
    writeFileSync(output, `${canonicalJson(scan)}\n`, { mode: 0o600, flag: 'wx' })
  }
}
