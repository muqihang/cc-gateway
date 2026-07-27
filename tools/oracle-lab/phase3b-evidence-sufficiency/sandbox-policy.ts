import { Phase3BProductionError } from './core.js'

function profileEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

export function buildSandboxProfile(runtimeRoot: string, writableRoot: string, routePorts: readonly number[]): string {
  const unique = [...new Set(routePorts)].sort((left, right) => left - right)
  if (unique.length < 1 || unique.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new Phase3BProductionError('sandbox_profile_invalid', 'sandbox loopback ports are invalid')
  return [
    '(version 1)',
    '(deny default)',
    '(deny network*)',
    '(deny file-write*)',
    '(deny process-info*)',
    '(deny file-read* (regex "^/Users/.*/\\.ssh(/|$)"))',
    '(deny file-read* (regex "^/Users/.*/\\.claude(/|$)"))',
    '(deny file-read* (subpath "/private/var/root"))',
    '(deny file-read* (subpath "/private/etc"))',
    '(deny file-read* (subpath "/etc"))',
    '(deny file-read* (subpath "/private/var/folders"))',
    '(allow process-fork)',
    '(allow process-exec (subpath "/System/Library"))',
    '(allow process-exec (subpath "/usr/bin"))',
    '(allow process-exec (subpath "/usr/lib"))',
    `(allow process-exec (literal "${profileEscape(process.execPath)}"))`,
    `(allow process-exec (subpath "${profileEscape(runtimeRoot)}/launch-images"))`,
    '(allow sysctl-read)',
    '(allow file-read-metadata)',
    '(allow file-read-data (literal "/"))',
    `(allow file-write* (subpath "${profileEscape(writableRoot)}"))`,
    `(allow file-read* (subpath "${profileEscape(runtimeRoot)}"))`,
    '(allow file-read* (subpath "/System/Library"))',
    '(allow file-read* (subpath "/usr/lib"))',
    `(allow file-read* (literal "${profileEscape(process.execPath)}"))`,
    '(allow file-read* (subpath "/usr/share/zoneinfo"))',
    '(allow file-read* (literal "/dev/null"))',
    '(allow file-read* (literal "/dev/urandom"))',
    ...unique.map((port) => `(allow network-outbound (remote tcp "localhost:${port}"))`),
  ].join(' ')
}
