import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

for (const file of [...sourceFiles(path.join(root, 'tests')), ...sourceFiles(path.join(root, 'tools/oracle-lab'))]) {
  const source = readFileSync(file, 'utf8')
  for (const forbidden of ['NODE' + '_PATH', 'oracle-' + 'ajv-', '--pre' + 'fix']) {
    assert.equal(source.includes(forbidden), false, `${path.relative(root, file)} rewrites dependency resolution with ${forbidden}`)
  }
  const arrayInvocation = /(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\[([\s\S]*?)\]/g
  for (const match of source.matchAll(arrayInvocation)) {
    const [, executable, args] = match
    const manager = path.basename(executable)
    const installsAtRuntime = manager === 'npx'
      || /['"`](?:install|add)['"`]/.test(args)
    if (['npm', 'npx', 'yarn', 'pnpm'].includes(manager)) assert.equal(installsAtRuntime, false, `${path.relative(root, file)} spawns ${manager} dependency installation at runtime`)
  }
  const shellInvocation = /(?:execSync|exec)\s*\(\s*['"`]([^'"`]+)['"`]/g
  for (const match of source.matchAll(shellInvocation)) {
    assert.doesNotMatch(match[1], /(?:^|\s)(?:npm\s+(?:install|add)|npx(?:\s|$)|yarn\s+add|pnpm\s+add)(?:\s|$)/)
  }
  const stringConstants = new Map([...source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([^'"`]+)['"`]/g)].map((match) => [match[1], match[2]]))
  const variableInvocation = /(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*\[([\s\S]*?)\]/g
  for (const match of source.matchAll(variableInvocation)) {
    const manager = path.basename(stringConstants.get(match[1]) ?? '')
    if (manager === 'npx' || (['npm', 'yarn', 'pnpm'].includes(manager) && /['"`](?:install|add)['"`]/.test(match[2]))) {
      assert.fail(`${path.relative(root, file)} installs dependencies through a variable command alias`)
    }
  }
}

console.log('oracle-lab hermetic dependencies: ok')
