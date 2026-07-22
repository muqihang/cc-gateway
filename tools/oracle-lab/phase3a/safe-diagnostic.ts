import { SAFE_ERROR_CATEGORIES, type SafeErrorCategory } from './safe-error-classifier.js'

export type SafeDiagnostic = {
  schema_version: 'oracle-lab-phase3a-safe-diagnostic.v1'
  categories: SafeErrorCategory[]
  raw_content_persisted: false
}

const CATEGORY_PATTERNS: Readonly<Record<SafeErrorCategory, RegExp>> = {
  authentication: /api[- ]?key|auth(?:entication|orization)?|credential|oauth|token/i,
  entitlement: /entitle|permission|permitted|denied|forbidden/i,
  capacity: /capacity|overload|rate.?limit|quota/i,
  model: /\bmodel\b/i,
  'request-shape': /invalid|parse|json|request|response|protocol/i,
  proxy: /proxy|gateway/i,
  transport: /connect|network|socket|dns|tls|certificate|fetch|timeout/i,
}

export function classifySafeDiagnosticText(value: string): SafeDiagnostic {
  return {
    schema_version: 'oracle-lab-phase3a-safe-diagnostic.v1',
    categories: SAFE_ERROR_CATEGORIES.filter((category) => CATEGORY_PATTERNS[category].test(value)),
    raw_content_persisted: false,
  }
}
