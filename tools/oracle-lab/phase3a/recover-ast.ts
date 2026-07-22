import { lstatSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import ts from 'typescript'

import { canonicalJson, Phase3AError, sha256Bytes, stableError } from './core.js'
import type { ExtractedCandidate, ExtractionIndex } from './extract-bundle.js'
import type { StaticLocation } from './static-inventory.js'

const MAX_SOURCE_BYTES = 256 * 1024 * 1024
const MAX_AST_NODES = 2_000_000
const MAX_GRAPH_EDGES = 500_000
const MAX_DURABLE_RECORDS = 10_000

export const REQUIRED_STATIC_ROOTS = [
  'env-config-system', 'home-xdg-tmp-tz-lang-locale-host-platform-arch', 'config-precedence',
  'model-capability', 'authentication', 'base-url-proxy', 'system-prompt', 'request-serialization',
  'identity-time-random', 'cch-billing-cache-compact', 'telemetry-diagnostic-update-error',
  'dns-socket-tls-http-transport', 'retry-timer-backoff-jitter', 'child-subtask-process-ipc',
  'daemon-restart-resume-lifecycle',
] as const

export type RequiredStaticRoot = typeof REQUIRED_STATIC_ROOTS[number]

export type AstLocation = StaticLocation & { line: number; column: number }

export type RootCoverage = {
  root: RequiredStaticRoot
  status: 'observed' | 'unknown'
  evidence_locations: AstLocation[]
  searched_surfaces: string[]
  next_minimal_action: string | null
}

export type AstRecovery = {
  schema_version: 'oracle-lab-phase3a-ast-recovery.v1'
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
    node_count: number
    parse_coverage_percent: 100
    syntax_kind: string
    source_sha256: string
    printed_sha256: string
    canonical_ast_sha256: string
    reparsed_canonical_ast_sha256: string
    parser_agreement: 'agreed'
    persisted_raw_source: false
    output_truncations: string[]
  }
  modules: Array<{
    module_id: string
    kind: 'source-file' | 'bundle-table-entry'
    ast_sha256: string
    key_sha256: string | null
    location: AstLocation
  }>
  literal_xrefs: Array<{
    root: RequiredStaticRoot
    literal_class: 'string' | 'template' | 'property' | 'decoded'
    value_sha256: string
    byte_length: number
    location: AstLocation
  }>
  decoded_constants: Array<{
    rule: 'constant-table-index-v1' | 'literal-binary-fold-v1'
    value_class: 'string' | 'number' | 'boolean' | 'null'
    value_sha256: string
    byte_length: number
    location: AstLocation
  }>
  callgraph: {
    nodes: Array<{ id: string; kind: string; ast_sha256: string; location: AstLocation }>
    edges: Array<{ caller: string; callee: string; kind: 'direct' | 'alias'; location: AstLocation }>
    unresolved: Array<{ caller: string; reason: string; callee_shape_sha256: string; location: AstLocation }>
  }
  cfg: Array<{
    function_id: string
    node_count: number
    edges: Array<{ from: string; to: string; kind: string; location: AstLocation }>
  }>
  state_machines: Array<{
    state_machine_id: string
    discriminator_sha256: string
    location: AstLocation
    transitions: Array<{ from_sha256: string; to_sha256: string | null; kind: 'case' | 'assignment'; location: AstLocation }>
  }>
  root_coverage: RootCoverage[]
  transform_log: Array<{ rule: string; passes: number; input_location: StaticLocation; output_sha256: string }>
  deterministic_digest: string
}

function fail(code: string, message: string): never {
  throw new Phase3AError(code, message)
}

function location(source: ts.SourceFile, artifactDigest: string, baseOffset: number, node: ts.Node): AstLocation {
  const start = node.getStart(source, false)
  const end = node.getEnd()
  const point = source.getLineAndCharacterOfPosition(start)
  return { artifact_sha256: artifactDigest, offset: baseOffset + start, length: end - start, line: point.line + 1, column: point.character + 1 }
}

function propertyNameDigest(name: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return sha256Bytes(name.text)
  return null
}

function nodeScalar(node: ts.Node): Record<string, unknown> {
  const value: Record<string, unknown> = { kind: ts.SyntaxKind[node.kind] }
  if (ts.isStringLiteralLike(node)) {
    value.literal = { class: ts.isNoSubstitutionTemplateLiteral(node) ? 'template' : 'string', bytes: Buffer.byteLength(node.text), sha256: sha256Bytes(node.text) }
  } else if (ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
    value.literal = { class: 'primitive', sha256: sha256Bytes(node.getText()) }
  } else if (ts.isPropertyAccessExpression(node)) {
    value.property_sha256 = sha256Bytes(node.name.text)
  } else if (
    ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) || ts.isEnumMember(node)
  ) {
    value.property_sha256 = propertyNameDigest(node.name)
  } else if (ts.isBinaryExpression(node)) {
    value.operator = ts.SyntaxKind[node.operatorToken.kind]
  } else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    value.operator = ts.SyntaxKind[node.operator]
  }
  return value
}

function canonicalAst(node: ts.Node, state: { count: number }): { hash: string; encoded: string } {
  state.count += 1
  if (state.count > MAX_AST_NODES) fail('static_budget_exceeded', 'AST node count exceeds recovery budget')
  const childHashes: string[] = []
  node.forEachChild((child) => {
    childHashes.push(canonicalAst(child, state).hash)
  })
  const encoded = canonicalJson({ ...nodeScalar(node), children: childHashes })
  return { hash: sha256Bytes(encoded), encoded }
}

function parseSource(sourceBytes: Buffer, label: string): ts.SourceFile {
  if (sourceBytes.length > MAX_SOURCE_BYTES) fail('static_budget_exceeded', 'source candidate exceeds AST recovery byte budget')
  const sourceText = sourceBytes.toString('utf8')
  if (sourceText.includes('\ufffd') || !Buffer.from(sourceText, 'utf8').equals(sourceBytes)) fail('static_encoding_invalid', 'AST candidate is not canonical UTF-8')
  const source = ts.createSourceFile(label, sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] }).parseDiagnostics
  if (diagnostics.length > 0) {
    const first = diagnostics[0]
    fail('static_syntax_invalid', `syntax error ${first.code} at ${first.start ?? 0}`)
  }
  return source
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => walk(child, visit))
}

function capRecords<T>(records: T[], surface: string, truncations: string[]): void {
  if (records.length <= MAX_DURABLE_RECORDS) return
  records.splice(MAX_DURABLE_RECORDS)
  truncations.push(surface)
}

function capNestedRecords<T extends { edges?: unknown[]; transitions?: unknown[] }>(records: T[], surface: string, truncations: string[]): void {
  let remaining = MAX_DURABLE_RECORDS
  let truncated = false
  for (let index = 0; index < records.length; index += 1) {
    if (remaining === 0) {
      records.splice(index)
      truncated = true
      break
    }
    const nested = records[index].edges ?? records[index].transitions ?? []
    if (nested.length > remaining) {
      nested.splice(remaining)
      truncated = true
    }
    remaining -= nested.length
  }
  if (truncated) truncations.push(surface)
}

function literalClass(node: ts.Node): { text: string; class: 'string' | 'template' | 'property' } | null {
  if (ts.isStringLiteralLike(node)) return { text: node.text, class: ts.isNoSubstitutionTemplateLiteral(node) ? 'template' : 'string' }
  if (ts.isPropertyAccessExpression(node)) return { text: node.name.text, class: 'property' }
  return null
}

const ROOT_PATTERNS: ReadonlyArray<[RequiredStaticRoot, RegExp]> = [
  ['env-config-system', /^(?:env|config|configuration|systemProperty|settings?)$/i],
  ['home-xdg-tmp-tz-lang-locale-host-platform-arch', /^(?:HOME|XDG_[A-Z_]+|TMP(?:DIR)?|TZ|LANG|LC_[A-Z_]+|locale|hostname|platform|arch)$/i],
  ['config-precedence', /^(?:precedence|override|defaults?|userSettings|projectSettings)$/i],
  ['model-capability', /^(?:model|models|capabilit(?:y|ies)|alias)$/i],
  ['authentication', /^(?:auth|authorization|apiKey|token|credential|refresh|expiry|expiresAt)$/i],
  ['base-url-proxy', /^(?:baseURL|baseUrl|proxy|https?_proxy|no_proxy)$/i],
  ['system-prompt', /^(?:system|systemPrompt|prompt)$/i],
  ['request-serialization', /^(?:headers?|body|request|serialize|stringify|content-type)$/i],
  ['identity-time-random', /^(?:requestId|sessionId|timestamp|Date|now|random|randomUUID|nonce)$/i],
  ['cch-billing-cache-compact', /^(?:cch|billing|cache|prompt-cache|compact|compaction)$/i],
  ['telemetry-diagnostic-update-error', /^(?:telemetry|otel|diagnostic|update|error|exception|sentry)$/i],
  ['dns-socket-tls-http-transport', /^(?:dns|socket|connect|tls|https?|fetch|undici|transport)$/i],
  ['retry-timer-backoff-jitter', /^(?:retry|retries|timer|timeout|backoff|jitter|setTimeout|setInterval)$/i],
  ['child-subtask-process-ipc', /^(?:child_process|spawn|fork|exec|subtask|worker|ipc|process)$/i],
  ['daemon-restart-resume-lifecycle', /^(?:daemon|restart|resume|suspend|wake|shutdown|exit|longRunning)$/i],
]

function matchedRoots(value: string): RequiredStaticRoot[] {
  return ROOT_PATTERNS.filter(([, expression]) => expression.test(value)).map(([root]) => root)
}

type ConstantValue = string | number | boolean | null

function constantText(value: ConstantValue): string {
  return value === null ? 'null' : String(value)
}

function literalValue(node: ts.Expression): ConstantValue | undefined {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isPrefixUnaryExpression(node)) {
    const operand = literalValue(node.operand)
    if (typeof operand !== 'number') return undefined
    if (node.operator === ts.SyntaxKind.PlusToken) return +operand
    if (node.operator === ts.SyntaxKind.MinusToken) return -operand
    if (node.operator === ts.SyntaxKind.TildeToken) return ~operand
  }
  return undefined
}

function foldBinary(node: ts.BinaryExpression): ConstantValue | undefined {
  const left = literalValue(node.left)
  const right = literalValue(node.right)
  if (left === undefined || right === undefined) return undefined
  switch (node.operatorToken.kind) {
    case ts.SyntaxKind.PlusToken:
      if (typeof left === 'string' || typeof right === 'string') return String(left) + String(right)
      if (typeof left === 'number' && typeof right === 'number') return left + right
      return undefined
    case ts.SyntaxKind.MinusToken: return typeof left === 'number' && typeof right === 'number' ? left - right : undefined
    case ts.SyntaxKind.AsteriskToken: return typeof left === 'number' && typeof right === 'number' ? left * right : undefined
    case ts.SyntaxKind.SlashToken: return typeof left === 'number' && typeof right === 'number' && right !== 0 ? left / right : undefined
    case ts.SyntaxKind.PercentToken: return typeof left === 'number' && typeof right === 'number' && right !== 0 ? left % right : undefined
    case ts.SyntaxKind.CaretToken: return typeof left === 'number' && typeof right === 'number' ? left ^ right : undefined
    case ts.SyntaxKind.AmpersandToken: return typeof left === 'number' && typeof right === 'number' ? left & right : undefined
    case ts.SyntaxKind.BarToken: return typeof left === 'number' && typeof right === 'number' ? left | right : undefined
    default: return undefined
  }
}

function recoverConstants(source: ts.SourceFile, artifactDigest: string, baseOffset: number): { summaries: AstRecovery['decoded_constants']; xrefs: AstRecovery['literal_xrefs'] } {
  const tables = new Map<string, ConstantValue[]>()
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isArrayLiteralExpression(node.initializer)) return
    if (!ts.isVariableDeclarationList(node.parent) || (node.parent.flags & ts.NodeFlags.Const) === 0 || node.initializer.elements.length > 4096) return
    const values: ConstantValue[] = []
    for (const element of node.initializer.elements) {
      if (ts.isSpreadElement(element)) return
      const value = literalValue(element)
      if (value === undefined) return
      values.push(value)
    }
    tables.set(node.name.text, values)
  })
  const summaries: AstRecovery['decoded_constants'] = []
  const xrefs: AstRecovery['literal_xrefs'] = []
  const record = (rule: AstRecovery['decoded_constants'][number]['rule'], value: ConstantValue, node: ts.Node): void => {
    const text = constantText(value)
    const loc = location(source, artifactDigest, baseOffset, node)
    summaries.push({ rule, value_class: value === null ? 'null' : typeof value as 'string' | 'number' | 'boolean', value_sha256: sha256Bytes(text), byte_length: Buffer.byteLength(text), location: loc })
    if (typeof value === 'string') {
      for (const root of matchedRoots(value)) xrefs.push({ root, literal_class: 'decoded', value_sha256: sha256Bytes(value), byte_length: Buffer.byteLength(value), location: loc })
    }
  }
  walk(source, (node) => {
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.argumentExpression && ts.isNumericLiteral(node.argumentExpression)) {
      const index = Number(node.argumentExpression.text)
      const table = tables.get(node.expression.text)
      if (table && Number.isSafeInteger(index) && index >= 0 && index < table.length) record('constant-table-index-v1', table[index], node)
    } else if (ts.isBinaryExpression(node)) {
      const value = foldBinary(node)
      if (value !== undefined) record('literal-binary-fold-v1', value, node)
    }
  })
  return { summaries, xrefs }
}

function recoverModules(source: ts.SourceFile, artifactDigest: string, baseOffset: number): AstRecovery['modules'] {
  const modules: AstRecovery['modules'] = []
  const sourceHash = canonicalAst(source, { count: 0 }).hash
  modules.push({ module_id: `module-0000-${sourceHash.slice(0, 16)}`, kind: 'source-file', ast_sha256: sourceHash, key_sha256: null, location: location(source, artifactDigest, baseOffset, source) })
  let ordinal = 1
  walk(source, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const entries = node.properties.filter((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && (ts.isFunctionExpression(property.initializer) || ts.isArrowFunction(property.initializer)))
    if (entries.length < 2) return
    for (const entry of entries) {
      const astHash = canonicalAst(entry.initializer, { count: 0 }).hash
      modules.push({
        module_id: `module-${String(ordinal).padStart(4, '0')}-${astHash.slice(0, 16)}`,
        kind: 'bundle-table-entry',
        ast_sha256: astHash,
        key_sha256: propertyNameDigest(entry.name),
        location: location(source, artifactDigest, baseOffset, entry),
      })
      ordinal += 1
    }
  })
  return modules
}

type BodyFunction = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration
type FunctionRecord = { node: BodyFunction; id: string; name: string | null; ast: string }

function isBodyFunction(node: ts.Node): node is BodyFunction {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function functionName(node: BodyFunction): string | null {
  if ('name' in node && node.name && ts.isIdentifier(node.name)) return node.name.text
  const parent = node.parent
  if ((ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent)) && parent.name && ts.isIdentifier(parent.name)) return parent.name.text
  return null
}

function enclosingFunction(node: ts.Node, ids: Map<ts.Node, string>): string {
  let cursor: ts.Node | undefined = node.parent
  while (cursor) {
    const found = ids.get(cursor)
    if (found) return found
    cursor = cursor.parent
  }
  return 'root'
}

function recoverCallgraph(source: ts.SourceFile, artifactDigest: string, baseOffset: number): AstRecovery['callgraph'] {
  const functions: FunctionRecord[] = []
  walk(source, (node) => {
    if (!isBodyFunction(node) || !node.body) return
    const ast = canonicalAst(node, { count: 0 }).hash
    functions.push({ node, id: `fn-${String(functions.length).padStart(5, '0')}-${ast.slice(0, 12)}`, name: functionName(node), ast })
  })
  const ids = new Map<ts.Node, string>(functions.map((entry) => [entry.node, entry.id]))
  const byName = new Map(functions.filter((entry) => entry.name !== null).map((entry) => [entry.name!, entry.id]))
  const aliases = new Map<string, string>()
  walk(source, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer || !ts.isIdentifier(node.initializer)) return
    const target = byName.get(node.initializer.text)
    if (target) aliases.set(node.name.text, target)
  })
  const edges: AstRecovery['callgraph']['edges'] = []
  const unresolved: AstRecovery['callgraph']['unresolved'] = []
  walk(source, (node) => {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return
    const caller = enclosingFunction(node, ids)
    const expression = node.expression
    if (ts.isIdentifier(expression)) {
      const direct = byName.get(expression.text)
      const alias = aliases.get(expression.text)
      if (direct || alias) {
        edges.push({ caller, callee: direct ?? alias!, kind: direct ? 'direct' : 'alias', location: location(source, artifactDigest, baseOffset, node) })
        return
      }
    }
    unresolved.push({ caller, reason: ts.isElementAccessExpression(expression) ? 'dynamic-property-call' : 'unresolved-external-or-property-call', callee_shape_sha256: canonicalAst(expression, { count: 0 }).hash, location: location(source, artifactDigest, baseOffset, node) })
  })
  if (edges.length + unresolved.length > MAX_GRAPH_EDGES) fail('static_budget_exceeded', 'call graph edge count exceeds recovery budget')
  return {
    nodes: functions.map((entry) => ({ id: entry.id, kind: ts.SyntaxKind[entry.node.kind], ast_sha256: entry.ast, location: location(source, artifactDigest, baseOffset, entry.node) })),
    edges,
    unresolved,
  }
}

function recoverCfg(source: ts.SourceFile, artifactDigest: string, baseOffset: number, callgraph: AstRecovery['callgraph']): AstRecovery['cfg'] {
  const functionNodes: BodyFunction[] = []
  walk(source, (node) => { if (isBodyFunction(node) && node.body) functionNodes.push(node) })
  return functionNodes.map((fn, functionIndex) => {
    const edges: AstRecovery['cfg'][number]['edges'] = []
    let nodeCount = 0
    walk(fn.body!, (node) => {
      nodeCount += 1
      const from = `n-${node.getStart(source)}`
      const loc = location(source, artifactDigest, baseOffset, node)
      if (ts.isIfStatement(node)) {
        edges.push({ from, to: `n-${node.thenStatement.getStart(source)}`, kind: 'true', location: loc })
        if (node.elseStatement) edges.push({ from, to: `n-${node.elseStatement.getStart(source)}`, kind: 'false', location: loc })
      } else if (ts.isConditionalExpression(node)) {
        edges.push({ from, to: `n-${node.whenTrue.getStart(source)}`, kind: 'true', location: loc }, { from, to: `n-${node.whenFalse.getStart(source)}`, kind: 'false', location: loc })
      } else if (ts.isSwitchStatement(node)) {
        for (const clause of node.caseBlock.clauses) edges.push({ from, to: `n-${clause.getStart(source)}`, kind: ts.isCaseClause(clause) ? 'case' : 'default', location: loc })
      } else if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
        edges.push({ from, to: `n-${node.statement.getStart(source)}`, kind: 'loop', location: loc })
      } else if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
        edges.push({ from, to: 'exit', kind: ts.isReturnStatement(node) ? 'return' : 'throw', location: loc })
      }
    })
    return { function_id: callgraph.nodes[functionIndex]?.id ?? `fn-${functionIndex}`, node_count: nodeCount, edges }
  })
}

function caseDigest(clause: ts.CaseOrDefaultClause): string {
  return ts.isCaseClause(clause) ? canonicalAst(clause.expression, { count: 0 }).hash : sha256Bytes('default')
}

function recoverStateMachines(source: ts.SourceFile, artifactDigest: string, baseOffset: number): AstRecovery['state_machines'] {
  const machines: AstRecovery['state_machines'] = []
  walk(source, (node) => {
    if (!ts.isSwitchStatement(node)) return
    const transitions: AstRecovery['state_machines'][number]['transitions'] = []
    for (const clause of node.caseBlock.clauses) {
      const from = caseDigest(clause)
      transitions.push({ from_sha256: from, to_sha256: null, kind: 'case', location: location(source, artifactDigest, baseOffset, clause) })
      walk(clause, (child) => {
        if (!ts.isBinaryExpression(child) || child.operatorToken.kind !== ts.SyntaxKind.EqualsToken || !ts.isStringLiteralLike(child.right)) return
        transitions.push({ from_sha256: from, to_sha256: sha256Bytes(child.right.text), kind: 'assignment', location: location(source, artifactDigest, baseOffset, child) })
      })
    }
    const discriminator = canonicalAst(node.expression, { count: 0 }).hash
    machines.push({ state_machine_id: `sm-${machines.length}-${discriminator.slice(0, 16)}`, discriminator_sha256: discriminator, location: location(source, artifactDigest, baseOffset, node), transitions })
  })
  return machines
}

function buildRecovery(sourceBytes: Buffer, candidate: Pick<ExtractedCandidate, 'sha256' | 'location'>): AstRecovery {
  const artifactDigest = candidate.location.artifact_sha256
  if (sha256Bytes(sourceBytes) !== candidate.sha256 || sourceBytes.length !== candidate.location.length) fail('artifact_hash_mismatch', 'candidate bytes disagree with extraction index')
  const source = parseSource(sourceBytes, `candidate-${candidate.sha256.slice(0, 16)}.js`)
  const beforeState = { count: 0 }
  const before = canonicalAst(source, beforeState)
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true })
  let printed: string | null = printer.printFile(source)
  const printedSha256 = sha256Bytes(printed)
  const after = (() => {
    const reparsed = parseSource(Buffer.from(printed!, 'utf8'), 'canonical-reprint.js')
    return canonicalAst(reparsed, { count: 0 })
  })()
  printed = null
  if (before.hash !== after.hash) fail('static_ast_drift', 'TypeScript print and reparse changed canonical AST')

  const literalXrefs: AstRecovery['literal_xrefs'] = []
  const rootLocations = new Map<RequiredStaticRoot, AstLocation[]>()
  walk(source, (node) => {
    const literal = literalClass(node)
    if (!literal) return
    for (const root of matchedRoots(literal.text)) {
      const loc = location(source, artifactDigest, candidate.location.offset, node)
      literalXrefs.push({ root, literal_class: literal.class, value_sha256: sha256Bytes(literal.text), byte_length: Buffer.byteLength(literal.text), location: loc })
      const locations = rootLocations.get(root) ?? []
      if (locations.length < 64) locations.push(loc)
      rootLocations.set(root, locations)
    }
  })
  const decoded = recoverConstants(source, artifactDigest, candidate.location.offset)
  literalXrefs.push(...decoded.xrefs)
  for (const xref of decoded.xrefs) {
    const locations = rootLocations.get(xref.root) ?? []
    if (locations.length < 64) locations.push(xref.location)
    rootLocations.set(xref.root, locations)
  }
  literalXrefs.sort((left, right) => left.location.offset - right.location.offset || left.root.localeCompare(right.root))
  const callgraph = recoverCallgraph(source, artifactDigest, candidate.location.offset)
  const modules = recoverModules(source, artifactDigest, candidate.location.offset)
  const cfg = recoverCfg(source, artifactDigest, candidate.location.offset, callgraph)
  const stateMachines = recoverStateMachines(source, artifactDigest, candidate.location.offset)
  const truncations: string[] = []
  capRecords(modules, 'modules', truncations)
  capRecords(literalXrefs, 'literal-xrefs', truncations)
  capRecords(decoded.summaries, 'decoded-constants', truncations)
  capRecords(callgraph.nodes, 'callgraph-nodes', truncations)
  capRecords(callgraph.edges, 'callgraph-edges', truncations)
  capRecords(callgraph.unresolved, 'callgraph-unresolved', truncations)
  capNestedRecords(cfg, 'cfg-edges-or-functions', truncations)
  capNestedRecords(stateMachines, 'state-machine-transitions-or-machines', truncations)
  truncations.sort()
  const base: Omit<AstRecovery, 'deterministic_digest'> = {
    schema_version: 'oracle-lab-phase3a-ast-recovery.v1',
    binding: {
      artifact_sha256: artifactDigest,
      candidate_sha256: candidate.sha256,
      candidate_location: candidate.location,
      parser: 'typescript-compiler-api',
      parser_version: ts.version,
      command_sha256: sha256Bytes(canonicalJson({ operation: 'recover-ast', parser: 'typescript-compiler-api', parser_version: ts.version, artifact_sha256: artifactDigest, candidate_sha256: candidate.sha256, offset: candidate.location.offset })),
    },
    parse: {
      source_bytes: sourceBytes.length,
      node_count: beforeState.count,
      parse_coverage_percent: 100,
      syntax_kind: 'JavaScript',
      source_sha256: candidate.sha256,
      printed_sha256: printedSha256,
      canonical_ast_sha256: before.hash,
      reparsed_canonical_ast_sha256: after.hash,
      parser_agreement: 'agreed',
      persisted_raw_source: false,
      output_truncations: truncations,
    },
    modules,
    literal_xrefs: literalXrefs,
    decoded_constants: decoded.summaries,
    callgraph,
    cfg,
    state_machines: stateMachines,
    root_coverage: REQUIRED_STATIC_ROOTS.map((root) => {
      const evidence = rootLocations.get(root) ?? []
      return {
        root,
        status: evidence.length > 0 ? 'observed' : 'unknown',
        evidence_locations: evidence,
        searched_surfaces: ['typescript-ast-literals', 'property-access', 'call-expressions', 'switch-state-tables', ...truncations.map((surface) => `bounded-output:${surface}`)],
        next_minimal_action: evidence.length > 0 ? null : 'inspect bounded callgraph neighborhood or obtain a dynamically observed hook anchor',
      }
    }),
    transform_log: [
      { rule: 'stable-identifier-topology-v1', passes: 1, input_location: candidate.location, output_sha256: before.hash },
      { rule: 'typescript-printer-reparse-agreement-v1', passes: 1, input_location: candidate.location, output_sha256: after.hash },
    ],
  }
  return { ...base, deterministic_digest: sha256Bytes(canonicalJson(base)) }
}

export function recoverAstBytes(sourceBytes: Buffer, candidate: Pick<ExtractedCandidate, 'sha256' | 'location'>): AstRecovery {
  return buildRecovery(sourceBytes, candidate)
}

export function recoverAstFromArtifact(file: string, extraction: ExtractionIndex, candidateId: string): AstRecovery {
  const stat = lstatSync(file)
  if (!stat.isFile() || stat.isSymbolicLink()) fail('artifact_identity', 'AST input must be a regular non-symlink file')
  const bytes = readFileSync(file)
  const after = lstatSync(file)
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) fail('artifact_identity', 'artifact changed during AST recovery')
  if (sha256Bytes(bytes) !== extraction.artifact_sha256) fail('artifact_hash_mismatch', 'artifact differs from extraction index')
  const candidate = extraction.candidates.find((entry) => entry.candidate_id === candidateId)
  if (!candidate) fail('static_candidate_missing', 'candidate id is absent from extraction index')
  const start = candidate.location.offset
  const end = start + candidate.location.length
  if (start < 0 || end > bytes.length) fail('static_range_invalid', 'candidate range is outside artifact')
  return buildRecovery(bytes.subarray(start, end), candidate)
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

export function runRecoverAstCli(argv: string[]): void {
  const values = args(argv)
  const extractionPath = values.extraction ?? (values['static-root'] ? path.join(values['static-root'], 'extraction-index.json') : undefined)
  if (!values.entrypoint || !extractionPath) fail('invalid_arguments', '--entrypoint and either --extraction or --static-root are required')
  const extraction = JSON.parse(readFileSync(extractionPath, 'utf8')) as ExtractionIndex
  const candidates = extraction.candidates.filter((candidate) => candidate.encoding === 'utf8')
  const candidateId = values['candidate-id'] ?? (candidates.length === 1 ? candidates[0].candidate_id : undefined)
  if (!candidateId) fail('invalid_arguments', '--candidate-id is required when the extraction index does not contain exactly one UTF-8 candidate')
  const recovery = recoverAstFromArtifact(values.entrypoint, extraction, candidateId)
  const out = values.out ?? (values['static-root'] ? path.join(values['static-root'], `ast-${candidateId}.json`) : undefined)
  const serialized = `${canonicalJson(recovery)}\n`
  if (out) writeFileSync(out, serialized, { flag: 'wx', mode: 0o600 })
  else process.stdout.write(serialized)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runRecoverAstCli(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${canonicalJson(stableError(error))}\n`)
    process.exitCode = 1
  }
}
