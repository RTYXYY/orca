import {
  HostedReviewApiRequestError,
  requestHostedReviewJson
} from '../source-control/hosted-review-api-request'
import { resolveBitbucketServerAuthConfig, serverAuthHeaders } from './server-auth-config'

export { HostedReviewApiRequestError } from '../source-control/hosted-review-api-request'

export const SERVER_READ_TIMEOUT_MS = 5000

/**
 * Single HTTP entry point for all Bitbucket Server reads and writes: auth headers,
 * timeout, and error classification (status/timedOut) live in one place.
 */
export async function serverRequestJson<T>(
  path: string,
  options: {
    searchParams?: Record<string, string>
    timeoutMs?: number
    method?: string
  } = {}
): Promise<T> {
  const config = resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    throw new HostedReviewApiRequestError('Bitbucket Server request failed: no usable credential')
  }
  const url = new URL(`${config.baseUrl}${path}`)
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    url.searchParams.set(key, value)
  }
  return requestHostedReviewJson<T>(
    url,
    {
      method: options.method,
      headers: { Accept: 'application/json', ...serverAuthHeaders(config) }
    },
    options.timeoutMs ?? SERVER_READ_TIMEOUT_MS
  )
}

/** Why: callers keep the historical "HTTP <status>" contract on lookup failures. */
export function serverRequestFailureMessage(error: unknown): string {
  if (error instanceof HostedReviewApiRequestError && error.status) {
    return `Bitbucket Server request failed: HTTP ${error.status}`
  }
  return error instanceof Error
    ? `Bitbucket Server request failed: ${error.message}`
    : 'Bitbucket Server request failed'
}
