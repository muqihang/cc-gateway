import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { test } from './helpers'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const docPath = join(repoRoot, 'docs', 'formal-pool-sub2api-safety.md')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

test('formal-pool Sub2API safety doc records safe field matrix and degraded claims', () => {
  if (!existsSync(docPath)) throw new Error('missing docs/formal-pool-sub2api-safety.md')
  const doc = read(docPath)
  const required = [
    '# Formal-Pool Sub2API Safety Boundary',
    'mode: sub2api',
    'Required server-side context',
    'account ref',
    'credential type',
    'credential ref',
    'egress bucket',
    'persona/profile policy version',
    'route classification',
    'session binding',
    'control-plane disposition',
    'egress_profile_ref',
    'profile_policy_version',
    'billing_shape_policy',
    'request_shape_profile_ref',
    'cache_parity_profile_ref',
    'observed_client_profile',
    'CC Gateway final-output responsibilities',
    'account identity lookup',
    'credential/account binding',
    'egress allowlist verification',
    'persona/profile header rewrite',
    'metadata.user_id',
    'X-Claude-Code-Session-Id',
    'billing/CCH strip or sign verifier',
    'control-plane separation',
    'preflight/real-upstream gate',
    'Field family',
    'Captured expectation',
    'CC Gateway P0 behavior',
    'metadata.user_id',
    'session header',
    'persona headers',
    'billing/CCH',
    'control-plane',
    'Claude Code 2.1.179 stable production policy',
    '2.1.191 latest is forward-compatibility evidence only',
    'strip_attribution',
    'explicit 2.1.179 oracle/profile proof',
    'Unknown future versions, unknown beta/body shapes, or unknown billing shapes must strip/downscope or fail closed',
    'deployed image/commit/config/profile equivalence',
    'Production readiness gate',
    'disable formal-pool egress',
    'force `strip_attribution`',
    'Rollback must never fall back to direct Anthropic bypass',
    'explicit user approval',
    'no 3012 changes',
    'Known degraded claims',
    'WebSearch/WebFetch bridge is not part of this P0',
    '2.1.179 strict native mimicry and sign-primary remain gated on oracle/profile evidence',
  ]
  for (const needle of required) {
    if (!doc.includes(needle)) throw new Error(`missing formal-pool safety doc text: ${needle}`)
  }
})

test('formal-pool safety doc and README avoid raw sensitive capture material', () => {
  const doc = read(docPath)
  const readme = read(join(repoRoot, 'README.md'))
  const forbidden = [
    /Authorization:\s*Bearer\s+\S+/i,
    /sk-ant-[A-Za-z0-9_-]+/,
    /xox[baprs]-[A-Za-z0-9-]+/,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    /account_uuid\s*[:=]\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /cch=[0-9a-f]{5};/i,
    /proxy_(?:user|password|credential)\s*[:=]/i,
  ]
  for (const [name, text] of [['doc', doc], ['README', readme]] as const) {
    for (const pattern of forbidden) {
      if (pattern.test(text)) throw new Error(`${name} contains forbidden sensitive capture shape: ${pattern}`)
    }
  }
})

test('README gateway modes link to formal-pool Sub2API safety boundary doc', () => {
  const readme = read(join(repoRoot, 'README.md'))
  const link = '[Formal-Pool Sub2API Safety Boundary](docs/formal-pool-sub2api-safety.md)'
  if (!readme.includes(link)) throw new Error('README missing formal-pool safety doc link')
})
