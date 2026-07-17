const AUTH_CONTROL_BYTES = /[\u0000-\u001f\u007f]/

export function canonicalAuthMaterialBytes(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value === '') return null
  if (value !== value.trim() || AUTH_CONTROL_BYTES.test(value)) return null
  return Buffer.from(value, 'utf8')
}
