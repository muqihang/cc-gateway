import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

import { canonicalJson } from './core.js'

export type Phase3ASchemaName = 'launch-manifest' | 'artifact-index' | 'normalized-observation' | 'conclusion' | 'handoff'
export type ValidationIssue = { code: string; path: string; message: string }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const FILES: Record<Phase3ASchemaName, string> = {
  'launch-manifest': 'oracle-lab-phase3a-launch-manifest.schema.json',
  'artifact-index': 'oracle-lab-phase3a-artifact-index.schema.json',
  'normalized-observation': 'oracle-lab-phase3a-normalized-observation.schema.json',
  conclusion: 'oracle-lab-phase3a-conclusion.schema.json',
  handoff: 'oracle-lab-phase3a-handoff.schema.json',
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    'date-time': { type: 'string', validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && !Number.isNaN(Date.parse(value)) },
    uri: { type: 'string', validate: (value: string) => { try { return new URL(value).href === value || new URL(value).toString() === value } catch { return false } } },
  },
})
const validators = new Map<Phase3ASchemaName, ValidateFunction>()
for (const [name, file] of Object.entries(FILES) as Array<[Phase3ASchemaName, string]>) {
  validators.set(name, ajv.compile(JSON.parse(readFileSync(path.join(ROOT, 'docs/superpowers/schemas', file), 'utf8'))))
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path: path || '$', message }
}

function ajvIssue(error: ErrorObject): ValidationIssue {
  const path = error.keyword === 'additionalProperties'
    ? `${error.instancePath || '$'}.${String((error.params as { additionalProperty?: string }).additionalProperty)}`
    : error.instancePath || '$'
  return issue(error.keyword === 'additionalProperties' ? 'unknown_field' : 'schema_invalid', path, error.message ?? error.keyword)
}

export function scanSafePersisted(value: unknown, pathValue = '$'): ValidationIssue[] {
  const errors: ValidationIssue[] = []
  semanticScan(value, pathValue, errors)
  return errors.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code))
}

function semanticScan(value: unknown, pathValue: string, errors: ValidationIssue[]): void {
  if (typeof value === 'string') {
    if (/\b(?:sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._~+/-]{8,}|gh[pousr]_[A-Za-z0-9]{8,})\b/.test(value)) {
      errors.push(issue('sensitive_material', pathValue, 'credential-shaped value is forbidden'))
    }
    if (/^https:\/\/[^\s]+\?(?:[^#]*&)?(?:sig|signature|token|jwt|x-amz-signature)=/i.test(value) || /[?&](?:sig|signature|token|jwt|x-amz-signature)=/i.test(value)) {
      errors.push(issue('sensitive_material', pathValue, 'signed or credential-bearing URL query is forbidden'))
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => semanticScan(entry, `${pathValue}[${index}]`, errors))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, entry] of Object.entries(value)) {
    const child = `${pathValue}.${key}`
    if (/^(?:raw_?prompt|system_prompt|raw_?body|request_body|response_body|raw_?cch|credential|credentials|secret|secrets)$/i.test(key)) {
      errors.push(issue('sensitive_material', child, 'raw prompt/body/CCH or credential fields are forbidden'))
    }
    if (/^(?:receipt|lease|recovery|authority_state)$/i.test(key)) {
      errors.push(issue('prohibited_state_machine', child, 'receipt/lease/Recovery authority fields are forbidden'))
    }
    semanticScan(entry, child, errors)
  }
}

export function validatePhase3A(name: Phase3ASchemaName, value: unknown): ValidationIssue[] {
  const validator = validators.get(name)!
  const errors = validator(value) ? [] : (validator.errors ?? []).map(ajvIssue)
  errors.push(...scanSafePersisted(value))
  return errors.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code))
}

export function assertPhase3A(name: Phase3ASchemaName, value: unknown): void {
  const errors = validatePhase3A(name, value)
  if (errors.length !== 0) throw Object.assign(new Error(canonicalJson({ code: 'phase3a_schema_invalid', errors })), { code: 'phase3a_schema_invalid', errors })
}
