import { readFileSync } from 'node:fs'

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

const schema = JSON.parse(readFileSync(new URL('../../contracts/oracle-lab/v1/contract.schema.json', import.meta.url), 'utf8')) as Record<string, unknown>
const schemaId = schema.$id as string
const ajv = new Ajv2020({ allErrors: true, strict: true })
ajv.addSchema(schema)

function validator(definition: string): ValidateFunction {
  return ajv.compile({ $ref: `${schemaId}#/$defs/${definition}` })
}

const behaviorCertificateValidator = validator('behaviorCoherenceCertificate')

export type SchemaValidation = { valid: true; errors: [] } | { valid: false; errors: ErrorObject[] }

export function validateBehaviorCoherenceCertificate(value: unknown): SchemaValidation {
  if (behaviorCertificateValidator(value)) return { valid: true, errors: [] }
  return { valid: false, errors: [...(behaviorCertificateValidator.errors ?? [])] }
}
