import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { canonicalJson, Phase3AError, sha256Bytes } from './core.js'

export type PairArm = 'control' | 'treatment'
export type PairOrder = readonly [PairArm, PairArm]
export type ConvergenceRun = {
  run_id: string
  repetition: number
  arm: PairArm
  success: boolean
  observer_failures: string[]
  instrumented: boolean
  perturbation: 'not-applicable' | 'equivalent' | 'perturbed' | 'unclassified'
  normalized: unknown
}

export type ConvergenceReport = {
  schema_version: 'oracle-lab-phase3a-convergence.v1'
  pair_id: string
  status: 'CONVERGED' | 'CONTINUE' | 'MAX_UNRESOLVED' | 'INVALID'
  evidence_level: 'Reproduced' | 'Observed' | 'Unknown'
  repetitions: number
  run_order: PairOrder[]
  order_digest: string
  stable_leaves: string[]
  variable_leaves: string[]
  unresolved_leaves: string[]
  outlier_run_ids: string[]
  observer_failures: Array<{ run_id: string; failures: string[] }>
  instrumentation_classified: boolean
  profile_usable: boolean
  causal_boundary: string
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

export function balancedPairOrder(seed: number, repetitions: number): PairOrder[] {
  if (!Number.isInteger(seed) || seed < 0) throw new Phase3AError('invalid_seed', 'seed must be a non-negative integer')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 12) throw new Phase3AError('invalid_repetitions', 'repetitions must be between 1 and 12')
  const rng = random(seed)
  const result: PairOrder[] = []
  for (let index = 0; index < repetitions; index += 2) {
    const first: PairOrder = rng() < 0.5 ? ['control', 'treatment'] : ['treatment', 'control']
    result.push(first)
    if (index + 1 < repetitions) result.push([first[1], first[0]])
  }
  return result
}

function flatten(value: unknown, prefix = '$', output = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(value)) {
    output.set(`${prefix}.length`, canonicalJson(value.length))
    value.forEach((entry, index) => flatten(entry, `${prefix}[${index}]`, output))
  } else if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>).sort()) flatten((value as Record<string, unknown>)[key], `${prefix}.${key}`, output)
  } else output.set(prefix, canonicalJson(value))
  return output
}

function orders(runs: ConvergenceRun[]): PairOrder[] | null {
  const grouped = new Map<number, ConvergenceRun[]>()
  for (const run of runs) grouped.set(run.repetition, [...(grouped.get(run.repetition) ?? []), run])
  const result: PairOrder[] = []
  for (const repetition of [...grouped.keys()].sort((a, b) => a - b)) {
    const rows = grouped.get(repetition)!
    if (rows.length !== 2 || new Set(rows.map((row) => row.arm)).size !== 2) return null
    result.push([rows[0].arm, rows[1].arm])
  }
  return result
}

export function analyzeConvergence(pairId: string, runs: ConvergenceRun[], options: { min?: number; max?: number } = {}): ConvergenceReport {
  const min = options.min ?? 5
  const max = options.max ?? 12
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max > 12 || min > max) throw new Phase3AError('invalid_convergence_bounds', 'convergence bounds must satisfy 5 <= min <= max <= 12')
  const runOrder = orders(runs)
  const repetitions = new Set(runs.map((run) => run.repetition)).size
  const observerFailures = runs.filter((run) => run.observer_failures.length > 0).map((run) => ({ run_id: run.run_id, failures: [...run.observer_failures].sort() }))
  const outliers = runs.filter((run) => !run.success || run.observer_failures.length > 0).map((run) => run.run_id).sort()
  const instrumentationClassified = runs.every((run) => !run.instrumented || run.perturbation === 'equivalent' || run.perturbation === 'perturbed')
  const profileUsable = !runs.some((run) => run.instrumented && run.perturbation === 'perturbed')
  const values = new Map<string, Set<string>>()
  const perArm = new Map<PairArm, ConvergenceRun[]>([['control', []], ['treatment', []]])
  for (const run of runs) {
    perArm.get(run.arm)!.push(run)
    for (const [leaf, value] of flatten(run.normalized)) {
      const key = `${run.arm}:${leaf}`
      values.set(key, new Set([...(values.get(key) ?? []), value]))
    }
  }
  const stable = [...values].filter(([, seen]) => seen.size === 1).map(([leaf]) => leaf).sort()
  const variable = [...values].filter(([, seen]) => seen.size > 1).map(([leaf]) => leaf).sort()
  const unresolved = new Set<string>()
  for (const [arm, armRuns] of perArm) {
    armRuns.sort((a, b) => a.repetition - b.repetition)
    if (armRuns.length < min) continue
    const prefix = armRuns.slice(0, -3).map((run) => flatten(run.normalized))
    const tail = armRuns.slice(-3).map((run) => flatten(run.normalized))
    const known = new Map<string, Set<string>>()
    for (const leaves of prefix) for (const [leaf, value] of leaves) known.set(leaf, new Set([...(known.get(leaf) ?? []), value]))
    for (const leaves of tail) for (const [leaf, value] of leaves) if (!known.get(leaf)?.has(value)) unresolved.add(`${arm}:${leaf}`)
  }
  const bothOrders = runOrder !== null && runOrder.some((order) => order[0] === 'control') && runOrder.some((order) => order[0] === 'treatment')
  const repetitionKeys = [...new Set(runs.map((run) => run.repetition))].sort((a, b) => a - b)
  const contiguous = repetitionKeys.every((value, index) => value === index)
  const valid = runOrder !== null && repetitions <= max && contiguous && runs.length === repetitions * 2 && new Set(runs.map((run) => run.run_id)).size === runs.length
  const converged = valid && repetitions >= min && outliers.length === 0 && instrumentationClassified && bothOrders && unresolved.size === 0
  const status = !valid ? 'INVALID' : converged ? 'CONVERGED' : repetitions >= max ? 'MAX_UNRESOLVED' : 'CONTINUE'
  return {
    schema_version: 'oracle-lab-phase3a-convergence.v1', pair_id: pairId, status,
    evidence_level: converged ? 'Reproduced' : runs.length === 0 ? 'Unknown' : 'Observed',
    repetitions, run_order: runOrder ?? [], order_digest: sha256Bytes(canonicalJson(runOrder ?? [])),
    stable_leaves: stable, variable_leaves: variable, unresolved_leaves: [...unresolved].sort(),
    outlier_run_ids: outliers, observer_failures: observerFailures,
    instrumentation_classified: instrumentationClassified, profile_usable: profileUsable,
    causal_boundary: 'Only the tested intervention under the frozen manifest pair is covered.',
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = argument('--input')
  const pair = argument('--pair')
  if (!file || !pair) throw new Phase3AError('usage', 'usage: converge.ts --pair PAIR_ID --input RUNS.json [--min 5 --max 12]')
  const runs = JSON.parse(readFileSync(file, 'utf8')) as ConvergenceRun[]
  process.stdout.write(`${canonicalJson(analyzeConvergence(pair, runs, { min: Number(argument('--min') ?? 5), max: Number(argument('--max') ?? 12) }))}\n`)
}
