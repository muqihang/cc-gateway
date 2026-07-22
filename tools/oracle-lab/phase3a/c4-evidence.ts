import { Phase3AError } from './core.js'

const PAIRS = ['tz-utc-shanghai', 'locale-c-en', 'locale-c-zh'] as const
const ARMS = ['control', 'treatment'] as const

export function expectedAuthoritativeC4RunIds(): string[] {
  return PAIRS.flatMap((pair) => Array.from({ length: 12 }, (_, repetition) => ARMS.map((arm) => `c4-${pair}-r${String(repetition).padStart(2, '0')}-${arm}`))).flat().sort()
}

export function validateAuthoritativeC4RunIds(observedInput: string[]): string[] {
  const observed = [...new Set(observedInput)].sort()
  if (observed.length === 0) return []
  const expected = expectedAuthoritativeC4RunIds()
  if (observed.length !== expected.length || observed.some((runId, index) => runId !== expected[index])) {
    throw new Phase3AError('c4_evidence_incomplete', 'authoritative c4 evidence must contain exactly three pairs with twelve repetitions and both arms')
  }
  return observed
}
