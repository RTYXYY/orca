import type { HostedReviewApiRequestError } from '../source-control/hosted-review-api-request'

/** Pull the first `errors[0].message` out of a Bitbucket Server JSON error body, if present. */
export function serverErrorMessage(error: HostedReviewApiRequestError): string | null {
  try {
    const parsed: unknown = JSON.parse(error.message)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'errors' in parsed &&
      Array.isArray(parsed.errors)
    ) {
      const first: unknown = parsed.errors[0]
      if (
        typeof first === 'object' &&
        first !== null &&
        'message' in first &&
        typeof first.message === 'string'
      ) {
        return first.message
      }
    }
  } catch {
    // Non-JSON body: no server reason to show.
  }
  return null
}
