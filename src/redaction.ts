export function redactSensitiveText(value: string): string {
  return value
    .replace(/\/\/([^/@\s]+):([^/@\s]+)@/g, '//<redacted>:<redacted>@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/(authorization[:=]\s*)(Bearer\s+)?[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/(x-api-key[:=]\s*)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/(api[_-]?key=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(token=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(authorization=)[^&\s]+/gi, '$1<redacted>')
    .replace(/([?&]email=)[^&\s]+/gi, '$1<redacted>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted-email>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<redacted-uuid>')
}

export function redactRequestPath(path: string): string {
  try {
    const url = new URL(path, 'http://cc-gateway.local')
    const safePathname = url.pathname
      .split('/')
      .map((segment) => shouldRedactPathSegment(segment) ? '<redacted>' : segment)
      .join('/')
    if (!url.search) return safePathname
    const keys = [...url.searchParams.keys()].map((key) => {
      return `${key}=<redacted>`
    })
    return `${safePathname}?${keys.join('&')}`
  } catch {
    return redactSensitiveText(path)
  }
}

function shouldRedactPathSegment(segment: string): boolean {
  if (!segment) return false
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(segment)) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return true
  if (/^(sk-|sk-ant-|Bearer)/i.test(segment)) return true
  if (/^[A-Za-z0-9._~+/=-]{24,}$/.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment)) return true
  return false
}
