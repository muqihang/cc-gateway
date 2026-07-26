import { Phase3BProductionError } from './core.js'

function profileEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function buildSandboxProfile(runtimeRoot: string, writableRoot: string, routePorts: readonly number[]): string {
  const unique = [...new Set(routePorts)].sort((left, right) => left - right)
  if (unique.length < 1 || unique.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new Phase3BProductionError('sandbox_profile_invalid', 'sandbox loopback ports are invalid')
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* (subpath "${profileEscape(writableRoot)}"))`,
    `(allow file-read* (subpath "${profileEscape(runtimeRoot)}"))`,
    ...unique.map((port) => `(allow network-outbound (remote tcp "localhost:${port}"))`),
  ].join(' ')
}
