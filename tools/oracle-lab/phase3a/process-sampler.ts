import { execFile } from 'node:child_process'
import { lstatSync, readlinkSync } from 'node:fs'

import { sha256File } from './core.js'

export type ProcessSample = {
  sequence: number
  monotonic_ns: string
  pid: number
  ppid: number
  rss_bytes: number
  cpu_ms: number
  executable_sha256: string | null
  executable_class: string
}

function exec(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(file, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)))
}

function cpuMilliseconds(value: string): number {
  const pieces = value.trim().split(':').map(Number)
  if (pieces.some(Number.isNaN)) return 0
  if (pieces.length === 3) return Math.round((pieces[0] * 3600 + pieces[1] * 60 + pieces[2]) * 1000)
  if (pieces.length === 2) return Math.round((pieces[0] * 60 + pieces[1]) * 1000)
  return Math.round(pieces[0] * 1000)
}

function executableFor(pid: number, command: string): string | null {
  try {
    if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/exe`)
    return command.startsWith('/') ? command : null
  } catch { return null }
}

function executableDigest(file: string | null): string | null {
  if (!file) return null
  try { return lstatSync(file).isFile() ? sha256File(file) : null } catch { return null }
}

export function descendants(rows: Array<{ pid: number; ppid: number }>, rootPid: number): Set<number> {
  const result = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (result.has(row.ppid) && !result.has(row.pid)) { result.add(row.pid); changed = true }
  }
  return result
}

export async function sampleProcessTree(rootPid: number, sequence = 0): Promise<ProcessSample[]> {
  const output = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,time=,comm='])
  const parsed = output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), rss: Number(match[3]), cpu: match[4], command: match[5] }] : []
  })
  const selected = descendants(parsed, rootPid)
  const monotonic = process.hrtime.bigint().toString()
  return parsed.filter((row) => selected.has(row.pid)).sort((a, b) => a.pid - b.pid).map((row, index) => {
    const executable = executableFor(row.pid, row.command)
    return {
      sequence: sequence + index,
      monotonic_ns: monotonic,
      pid: row.pid,
      ppid: row.ppid,
      rss_bytes: row.rss * 1024,
      cpu_ms: cpuMilliseconds(row.cpu),
      executable_sha256: executableDigest(executable),
      executable_class: row.pid === rootPid ? 'root' : 'descendant',
    }
  })
}

export async function sampleSocketCount(pids: number[]): Promise<number | null> {
  if (pids.length === 0) return 0
  try {
    const output = await exec('/usr/sbin/lsof', ['-nP', '-a', '-p', pids.join(','), '-i'])
    return Math.max(0, output.split('\n').filter(Boolean).length - 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /exit code 1|Command failed/.test(message) ? 0 : null
  }
}

export function enforceProcessLimits(samples: ProcessSample[], limits: { processes: number; rss_bytes: number; cpu_ms: number }): string | null {
  if (samples.length > limits.processes) return 'process_limit'
  if (samples.reduce((sum, sample) => sum + sample.rss_bytes, 0) > limits.rss_bytes) return 'rss_limit'
  if (samples.reduce((sum, sample) => sum + sample.cpu_ms, 0) > limits.cpu_ms) return 'cpu_limit'
  return null
}
