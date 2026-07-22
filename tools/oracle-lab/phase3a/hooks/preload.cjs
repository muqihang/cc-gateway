'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')

const output = process.env.ORACLE_PHASE3A_HOOK_OUTPUT
const maxEvents = Math.max(1, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_EVENTS || 10000), 10000))
const maxBytes = Math.max(1024, Math.min(Number(process.env.ORACLE_PHASE3A_HOOK_MAX_BYTES || 8 * 1024 * 1024), 8 * 1024 * 1024))
let sequence = 0
let bytes = 0
let writing = false

function hash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function classify(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `bytes:${value.byteLength}`
  if (Array.isArray(value)) return `array:${value.length}`
  if (typeof value === 'string') return `string:${Buffer.byteLength(value)}`
  return typeof value
}
function emit(kind, detail) {
  if (!output || writing || sequence >= maxEvents) return
  writing = true
  try {
    const stack = new Error().stack?.split('\n').slice(2, 7).join('\n') || ''
    const line = JSON.stringify({ schema_version: 'oracle-lab-phase3a-hook.v1', sequence: sequence++, monotonic_ns: process.hrtime.bigint().toString(), pid: process.pid, kind, detail, stack_anchor_sha256: hash(stack) }) + '\n'
    const size = Buffer.byteLength(line)
    if (bytes + size <= maxBytes) { fs.appendFileSync(output, line, { encoding: 'utf8', mode: 0o600 }); bytes += size }
  } catch {} finally { writing = false }
}
function wrap(object, name, kind, summarize) {
  const original = object && object[name]
  if (typeof original !== 'function' || original.__oraclePhase3A) return
  function wrapped(...args) { emit(kind, summarize(args)); return Reflect.apply(original, this, args) }
  Object.defineProperty(wrapped, '__oraclePhase3A', { value: true })
  Object.setPrototypeOf(wrapped, original)
  object[name] = wrapped
}

const moduleLoad = Module._load
Module._load = function phase3aLoad(request, parent, isMain) {
  emit('module.load', { specifier_sha256: hash(request), builtin: Module.isBuiltin(request) })
  const exported = moduleLoad.apply(this, arguments)
  try {
    if (request === 'node:fs' || request === 'fs') {
      for (const name of ['readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'open', 'openSync', 'readdir', 'readdirSync', 'stat', 'statSync']) wrap(exported, name, `fs.${name}`, (args) => ({ path_sha256: hash(args[0]), argument_classes: args.map(classify) }))
    } else if (request === 'node:child_process' || request === 'child_process') {
      for (const name of ['spawn', 'execFile', 'fork']) wrap(exported, name, `process.${name}`, (args) => ({ executable_sha256: hash(args[0]), argument_count: Array.isArray(args[1]) ? args[1].length : 0 }))
    } else if (request === 'node:dns' || request === 'dns') {
      for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) wrap(exported, name, `dns.${name}`, (args) => ({ hostname_sha256: hash(args[0]) }))
    } else if (request === 'node:net' || request === 'net' || request === 'node:tls' || request === 'tls') {
      for (const name of ['connect', 'createConnection']) wrap(exported, name, `${request.replace('node:', '')}.${name}`, (args) => ({ argument_classes: args.map(classify) }))
    } else if (request === 'node:http' || request === 'http' || request === 'node:https' || request === 'https') {
      for (const name of ['request', 'get']) wrap(exported, name, `${request.replace('node:', '')}.${name}`, (args) => ({ argument_classes: args.map(classify) }))
    }
  } catch (error) { emit('hook.failure', { module_sha256: hash(request), error_class: error?.name || 'Error' }) }
  return exported
}

for (const name of ['setTimeout', 'setInterval', 'setImmediate']) wrap(globalThis, name, `timer.${name}`, (args) => ({ delay_class: typeof args[1] === 'number' ? Math.min(Math.max(args[1], 0), 86400000) : null, argument_count: args.length }))
if (typeof globalThis.fetch === 'function') wrap(globalThis, 'fetch', 'fetch', (args) => ({ destination_sha256: hash(args[0] instanceof URL ? args[0].origin : typeof args[0] === 'string' ? new URL(args[0], 'http://invalid.local').origin : 'request-object'), body_class: classify(args[1]?.body) }))
process.on('exit', (code) => emit('process.exit', { code }))
emit('hook.ready', { runtime: `node-${process.versions.node}`, preload_sha256: hash(__filename) })
