import { canonicalJson, sha256Bytes } from './core.js'

function topologyInterface(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(topologyInterface)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === 'sha256' ? '<VALUE_SHA256>' : topologyInterface(child),
  ]))
}

/** Digest the content-independent protocol shape captured by a Tier A observer. */
export function tierAInterfaceDigest(events: readonly any[]): string {
  return sha256Bytes(canonicalJson(events.map((event) => ({
    method: event.method,
    path_class: event.path_class,
    header_names: event.header_names,
    header_value_classes: event.header_value_classes,
    body_topology: topologyInterface(event.body_topology),
    response_class: event.response_class,
    request_class: event.request_class,
    cch_class: event.cch_class,
    system_summary: {
      status: event.system_summary?.status,
      byte_length: event.system_summary?.byte_length,
      ast_topology: topologyInterface(event.system_summary?.ast_topology),
      span_layout: Array.isArray(event.system_summary?.span_hashes) ? event.system_summary.span_hashes.map((span: any) => ({
        path_sha256: span.path_sha256,
        ordinal: span.ordinal,
        byte_length: span.byte_length,
      })) : [],
    },
  }))))
}
