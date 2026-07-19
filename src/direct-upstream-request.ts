import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'http'
import { request as httpsRequest, type RequestOptions } from 'https'
import { Readable, Writable } from 'stream'

const INERT_DIRECT_REQUEST_BRAND = Symbol('cc_gateway_inert_direct_request_brand')
const INERT_DIRECT_REQUEST_INVOKE = Symbol('cc_gateway_inert_direct_request_invoke')

export type InertDirectRequestObservation = Readonly<{
  protocol: 'http:' | 'https:'
  hostname: string
  method: string
  rejectUnauthorized: boolean
}>

type DirectResponseHandler = (response: IncomingMessage) => void

export type InertDirectRequestHarness = Readonly<{
  readonly [INERT_DIRECT_REQUEST_BRAND]: true
  readonly [INERT_DIRECT_REQUEST_INVOKE]: (
    upstream: URL,
    options: Readonly<RequestOptions>,
    responseHandler: DirectResponseHandler,
  ) => ClientRequest
  observations: () => readonly InertDirectRequestObservation[]
}>

export function createInertDirectRequestHarness(): InertDirectRequestHarness {
  const observed: InertDirectRequestObservation[] = []
  return Object.freeze({
    [INERT_DIRECT_REQUEST_BRAND]: true as const,
    [INERT_DIRECT_REQUEST_INVOKE]: (
      upstream: URL,
      options: Readonly<RequestOptions>,
      responseHandler: DirectResponseHandler,
    ): ClientRequest => {
      observed.push(Object.freeze({
        protocol: upstream.protocol as 'http:' | 'https:',
        hostname: upstream.hostname,
        method: String(options.method || 'GET'),
        rejectUnauthorized: options.rejectUnauthorized === true,
      }))
      const request = new Writable({
        write(_chunk, _encoding, callback) { callback() },
      })
      request.once('finish', () => {
        queueMicrotask(() => {
          const response = Readable.from([Buffer.from('{"ok":true}', 'utf8')]) as IncomingMessage
          response.statusCode = 200
          response.headers = { 'content-type': 'application/json' }
          responseHandler(response)
        })
      })
      return request as unknown as ClientRequest
    },
    observations: () => Object.freeze(observed.slice()),
  })
}

export function requestDirectUpstream(
  upstream: URL,
  options: RequestOptions,
  responseHandler: DirectResponseHandler,
  inertHarness?: InertDirectRequestHarness,
): ClientRequest {
  if (inertHarness) {
    if (inertHarness[INERT_DIRECT_REQUEST_BRAND] !== true) {
      throw new Error('invalid inert direct request harness')
    }
    const observedOptions = Object.freeze({
      ...options,
      ...(options.headers ? { headers: Object.freeze({ ...options.headers }) } : {}),
    })
    return inertHarness[INERT_DIRECT_REQUEST_INVOKE](upstream, observedOptions, responseHandler)
  }
  const request = upstream.protocol === 'http:' ? httpRequest : httpsRequest
  return request(upstream, options, responseHandler)
}
