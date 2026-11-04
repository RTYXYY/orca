import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { Repo } from '../../../../shared/repo-types'
import { translate } from '@/i18n/i18n'
import { codeHostErrorText } from '@/lib/code-host-error-copy'
import {
  setBitbucketHostedReviewStatus,
  type BitbucketReviewStatus
} from './hosted-review-bitbucket-actions'

export type UseBitbucketReviewStatusResult = {
  statusUpdating: BitbucketReviewStatus | null
  statusError: string | null
  handleSetReviewStatus: (status: BitbucketReviewStatus) => Promise<void>
}

export function useBitbucketReviewStatus({
  repo,
  prNumber,
  onRefreshReview
}: {
  repo: Repo
  prNumber: number
  onRefreshReview: () => Promise<void>
}): UseBitbucketReviewStatusResult {
  const [statusUpdating, setStatusUpdating] = useState<BitbucketReviewStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const handleSetReviewStatus = useCallback(
    async (status: BitbucketReviewStatus) => {
      if (statusUpdating) {
        return
      }
      setStatusUpdating(status)
      setStatusError(null)
      try {
        const result = await setBitbucketHostedReviewStatus({ repo, prNumber, status })
        if (!result.ok) {
          setStatusError(codeHostErrorText(result))
        } else {
          toast.success(
            status === 'APPROVED'
              ? translate(
                  'auto.components.right.sidebar.HostedReviewActions.bitbucketApprovedToast',
                  'Pull request approved'
                )
              : status === 'NEEDS_WORK'
                ? translate(
                    'auto.components.right.sidebar.HostedReviewActions.bitbucketChangesRequestedToast',
                    'Changes requested'
                  )
                : translate(
                    'auto.components.right.sidebar.HostedReviewActions.bitbucketReviewClearedToast',
                    'Review cleared'
                  )
          )
          await onRefreshReview()
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Review status update failed'
        setStatusError(message)
        toast.error(message)
      } finally {
        setStatusUpdating(null)
      }
    },
    [onRefreshReview, prNumber, repo, statusUpdating]
  )

  return { statusUpdating, statusError, handleSetReviewStatus }
}
