import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>
}
const packageLock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages?: Record<string, { version?: string; integrity?: string; devDependencies?: Record<string, string> }>
}

const ajvIntegrity = 'sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA=='
assert.equal(packageJson.devDependencies?.ajv, '8.20.0', 'Ajv must be an exact development dependency')
assert.equal(packageLock.packages?.['']?.devDependencies?.ajv, '8.20.0', 'lockfile root must pin Ajv exactly')
assert.deepEqual(
  {
    version: packageLock.packages?.['node_modules/ajv']?.version,
    integrity: packageLock.packages?.['node_modules/ajv']?.integrity,
  },
  { version: '8.20.0', integrity: ajvIntegrity },
  'lockfile must resolve the reviewed Ajv release and integrity',
)

const baselinePath = path.join(root, 'tests/oracle-lab-baseline-freeze.test.ts')
const baselineSource = readFileSync(baselinePath, 'utf8')
assert.match(baselineSource, /^import Ajv2020 from 'ajv\/dist\/2020\.js';?$/m)

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(absolute)
    return entry.isFile() && entry.name.endsWith('.ts') ? [absolute] : []
  })
}

type StaticValue = string | number | boolean | StaticValue[] | { [key: string]: StaticValue }

const CHILD_PROCESS_OPERATIONS = new Set(['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync'])

function dependencyInstallViolations(source: string): string[] {
  const violations = new Set<string>()
  for (const forbidden of ['NODE' + '_PATH', 'oracle-' + 'ajv-', '--pre' + 'fix']) {
    if (source.includes(forbidden)) violations.add(`dependency resolution rewrite: ${forbidden}`)
  }

  const sourceFile = ts.createSourceFile('hermetic-source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const initializers = new Map<string, ts.Expression>()
  const operations = new Map<string, string>()
  const namespaces = new Set<string>()
  const declarations: ts.VariableDeclaration[] = []

  const childProcessModule = (expression: ts.Expression): boolean => {
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression) || expression.expression.text !== 'require') return false
    const moduleName = expression.arguments[0]
    return Boolean(moduleName && ts.isStringLiteral(moduleName) && ['node:child_process', 'child_process'].includes(moduleName.text))
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && ['node:child_process', 'child_process'].includes(statement.moduleSpecifier.text)) {
      const clause = statement.importClause
      if (clause?.name) namespaces.add(clause.name.text)
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text)
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text
          if (CHILD_PROCESS_OPERATIONS.has(imported)) operations.set(element.name.text, imported)
        }
      }
    }
  }

  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      declarations.push(node)
      if (ts.isIdentifier(node.name)) initializers.set(node.name.text, node.initializer)
      if (ts.isObjectBindingPattern(node.name) && childProcessModule(node.initializer)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const imported = element.propertyName && ts.isIdentifier(element.propertyName) ? element.propertyName.text : element.name.text
          if (CHILD_PROCESS_OPERATIONS.has(imported)) operations.set(element.name.text, imported)
        }
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(sourceFile)

  const unwrap = (expression: ts.Expression): ts.Expression => {
    let current = expression
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression
    return current
  }

  const evaluate = (input: ts.Expression, seen = new Set<string>()): StaticValue | undefined => {
    const expression = unwrap(input)
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text
    if (ts.isNumericLiteral(expression)) return Number(expression.text)
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
    if (ts.isIdentifier(expression)) {
      if (seen.has(expression.text)) return undefined
      const initializer = initializers.get(expression.text)
      if (!initializer) return undefined
      const nextSeen = new Set(seen)
      nextSeen.add(expression.text)
      return evaluate(initializer, nextSeen)
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(expression.left, seen)
      const right = evaluate(expression.right, seen)
      if ((typeof left === 'string' || typeof left === 'number') && (typeof right === 'string' || typeof right === 'number')) return `${left}${right}`
      return undefined
    }
    if (ts.isTemplateExpression(expression)) {
      let value = expression.head.text
      for (const span of expression.templateSpans) {
        const part = evaluate(span.expression, seen)
        if (typeof part !== 'string' && typeof part !== 'number') return undefined
        value += `${part}${span.literal.text}`
      }
      return value
    }
    if (ts.isArrayLiteralExpression(expression)) {
      const values: StaticValue[] = []
      for (const element of expression.elements) {
        if (ts.isSpreadElement(element)) {
          const spread = evaluate(element.expression, seen)
          if (!Array.isArray(spread)) return undefined
          values.push(...spread)
          continue
        }
        const value = evaluate(element, seen)
        if (value === undefined) return undefined
        values.push(value)
      }
      return values
    }
    if (ts.isObjectLiteralExpression(expression)) {
      const value: { [key: string]: StaticValue } = {}
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined
          const item = evaluate(property.initializer, seen)
          if (!name || item === undefined) return undefined
          value[name] = item
        } else if (ts.isShorthandPropertyAssignment(property)) {
          const item = evaluate(property.name, seen)
          if (item === undefined) return undefined
          value[property.name.text] = item
        } else return undefined
      }
      return value
    }
    if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'join') {
      const receiver = evaluate(expression.expression.expression, seen)
      const separator = expression.arguments[0] ? evaluate(expression.arguments[0], seen) : ','
      if (Array.isArray(receiver) && typeof separator === 'string' && receiver.every((item) => typeof item === 'string' || typeof item === 'number')) return receiver.join(separator)
    }
    return undefined
  }

  for (const declaration of declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
    const initializer = unwrap(declaration.initializer)
    if (childProcessModule(initializer)) namespaces.add(declaration.name.text)
  }
  for (let changed = true; changed;) {
    changed = false
    for (const declaration of declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer || operations.has(declaration.name.text)) continue
      const initializer = unwrap(declaration.initializer)
      let operation: string | undefined
      if (ts.isIdentifier(initializer)) operation = operations.get(initializer.text)
      else if (ts.isPropertyAccessExpression(initializer) && ts.isIdentifier(initializer.expression)
        && namespaces.has(initializer.expression.text) && CHILD_PROCESS_OPERATIONS.has(initializer.name.text)) operation = initializer.name.text
      else if (ts.isElementAccessExpression(initializer) && ts.isIdentifier(initializer.expression)
        && namespaces.has(initializer.expression.text) && initializer.argumentExpression && ts.isStringLiteral(initializer.argumentExpression)
        && CHILD_PROCESS_OPERATIONS.has(initializer.argumentExpression.text)) operation = initializer.argumentExpression.text
      if (operation) {
        operations.set(declaration.name.text, operation)
        changed = true
      }
    }
  }

  const operationForCall = (call: ts.CallExpression): string | undefined => {
    const callee = unwrap(call.expression)
    if (ts.isIdentifier(callee)) return operations.get(callee.text)
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && namespaces.has(callee.expression.text) && CHILD_PROCESS_OPERATIONS.has(callee.name.text)) return callee.name.text
    if (ts.isElementAccessExpression(callee) && ts.isIdentifier(callee.expression)
      && namespaces.has(callee.expression.text) && callee.argumentExpression && ts.isStringLiteral(callee.argumentExpression)
      && CHILD_PROCESS_OPERATIONS.has(callee.argumentExpression.text)) return callee.argumentExpression.text
    return undefined
  }

  const executableName = (value: string): string => value.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
  const forbiddenShellCommand = (command: string): boolean => {
    const tokens = command.toLowerCase().replace(/[;&|()]/g, ' ').split(/\s+/)
      .map((token) => token.replace(/^["']+|["']+$/g, '')).filter(Boolean)
    for (let index = 0; index < tokens.length; index += 1) {
      const manager = executableName(tokens[index])
      if (manager === 'npx') return true
      const remaining = tokens.slice(index + 1)
      if (manager === 'npm' && remaining.some((item) => item === 'install' || item === 'add')) return true
      if ((manager === 'yarn' || manager === 'pnpm') && remaining.includes('add')) return true
    }
    return false
  }

  const inspectCall = (call: ts.CallExpression): void => {
    const operation = operationForCall(call)
    if (!operation || call.arguments.length === 0) return
    const first = evaluate(call.arguments[0])
    if (operation === 'exec' || operation === 'execSync') {
      if (typeof first === 'string' && forbiddenShellCommand(first)) violations.add(`${operation} shell dependency installation`)
      return
    }
    if (typeof first !== 'string') return
    const args = call.arguments[1] ? evaluate(call.arguments[1]) : []
    const options = call.arguments[2] ? evaluate(call.arguments[2]) : undefined
    const shellSetting = options && !Array.isArray(options) && typeof options === 'object' ? options.shell : undefined
    if ((shellSetting === true || typeof shellSetting === 'string') && forbiddenShellCommand(first)) {
      violations.add(`${operation} shell:true dependency installation`)
    }
    if (!Array.isArray(args) || !args.every((item) => typeof item === 'string' || typeof item === 'number')) return
    const argv = args.map(String)
    const manager = executableName(first)
    if (manager === 'npx') violations.add(`${operation} npx invocation`)
    else if (manager === 'npm' && argv.some((item) => item === 'install' || item === 'add')) violations.add(`${operation} npm dependency installation`)
    else if ((manager === 'yarn' || manager === 'pnpm') && argv.includes('add')) violations.add(`${operation} ${manager} dependency installation`)
    else if (['sh', 'bash', 'zsh', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh'].includes(manager)) {
      const shellFlag = argv.findIndex((item) => ['-c', '/c', '-command'].includes(item.toLowerCase()))
      if (shellFlag >= 0 && typeof argv[shellFlag + 1] === 'string' && forbiddenShellCommand(argv[shellFlag + 1])) violations.add(`${operation} shell wrapper dependency installation`)
    } else if (manager === 'env' && forbiddenShellCommand(argv.join(' '))) violations.add(`${operation} env wrapper dependency installation`)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) inspectCall(node)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...violations]
}

const evasionFixtures = [
  `
    import { spawnSync as run } from 'node:child_process'
    const managerPart = 'n' + 'pm'
    const manager = managerPart
    const action = 'inst' + 'all'
    const argv = [action, 'ajv@8.20.0']
    run(manager, argv)
  `,
  `
    import { spawn } from 'node:child_process'
    const shell = 's' + 'h'
    const flag = '-c'
    const command = 'pnpm' + ' add ajv@8.20.0'
    spawn(shell, [flag, command])
  `,
  `
    import { exec as execute } from 'node:child_process'
    const manager = 'yarn'
    const action = 'add'
    execute(\`${'${manager}'} ${'${action}'} ajv@8.20.0\`)
  `,
  `
    import * as child from 'node:child_process'
    const manager = '/usr/local/bin/' + 'npx'
    const argv = ['tsx', 'fixture.ts']
    child.execFile(manager, argv)
  `,
  `
    import { spawnSync } from 'node:child_process'
    const command = 'npm install ajv@8.20.0'
    const argv: string[] = []
    const options = { shell: true }
    spawnSync(command, argv, options)
  `,
  `
    import { execFileSync } from 'node:child_process'
    const shell = '/bin/ba' + 'sh'
    const argv = ['-c', 'npx tsx fixture.ts']
    execFileSync(shell, argv)
  `,
  `
    const child = require('node:child_process')
    const run = child.spawnSync
    const manager = 'npm'
    const argv = ['add', 'ajv@8.20.0']
    run(manager, argv)
  `,
  `
    import { spawnSync } from 'node:child_process'
    const command = 'npm install ajv@8.20.0'
    const options = { shell: '/bin/sh' }
    spawnSync(command, [], options)
  `,
  `
    import { exec } from 'node:child_process'
    const command = '/usr/bin/npm install ajv@8.20.0'
    exec(command)
  `,
]
for (const source of evasionFixtures) assert.ok(dependencyInstallViolations(source).length > 0, source)

for (const file of [...sourceFiles(path.join(root, 'tests')), ...sourceFiles(path.join(root, 'tools/oracle-lab'))]) {
  const violations = dependencyInstallViolations(readFileSync(file, 'utf8'))
  assert.deepEqual(violations, [], `${path.relative(root, file)} violates hermetic dependency execution: ${violations.join(', ')}`)
}

console.log('oracle-lab hermetic dependencies: ok')
