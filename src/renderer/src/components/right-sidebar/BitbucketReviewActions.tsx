import React, { useCallback } from 'react'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import type { Repo } from '../../../../shared/repo-types'
import { HostedReviewActionError } from './hosted-review/provider-actions/HostedReviewStateActions'
import { useBitbucketReviewStatus } from './use-bitbucket-review-status'

/** Bitbucket Data Center review actions: Approve, Request changes (NEEDS_WORK), Undo review. */
export function BitbucketReviewActions({
  repo,
  prNumber,
  reviewDecision,
  disabled,
  onRefreshReview
}: {
  repo: Repo
  prNumber: number
  reviewDecision: string | null
  disabled: boolean
  onRefreshReview: () => Promise<void>
}): React.JSX.Element {
  const languageRevision = useUiLanguageRevision()
  const { statusUpdating, statusError, handleSetReviewStatus } = useBitbucketReviewStatus({
    repo,
    prNumber,
    onRefreshReview
  })
  const busy = statusUpdating !== null
  const anyDisabled = disabled || busy
  const needsWorkMarked = reviewDecision === 'CHANGES_REQUESTED'

  const handleNeedsWork = useCallback(() => {
    // Why: toggle — mark needs work when unmarked, clear it when already marked.
    void handleSetReviewStatus(needsWorkMarked ? 'UNAPPROVED' : 'NEEDS_WORK')
  }, [handleSetReviewStatus, needsWorkMarked])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className={cn(
                'h-6 gap-1 px-2 text-[11px]',
                reviewDecision !== 'CHANGES_REQUESTED' &&
                  'border-emerald-600/50 text-emerald-600 hover:bg-emerald-600/10 hover:text-emerald-500'
              )}
              disabled={anyDisabled}
              onClick={() =>
                void handleSetReviewStatus(
                  reviewDecision === 'APPROVED' ? 'UNAPPROVED' : 'APPROVED'
                )
              }
            >
              {statusUpdating !== null ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {statusUpdating !== null
                ? translate(
                    'auto.components.right.sidebar.BitbucketReviewActions.approving',
                    'Updating...'
                  )
                : reviewDecision === 'APPROVED'
                  ? translate(
                      'auto.components.right.sidebar.BitbucketReviewActions.undoApprove',
                      'Undo approve'
                    )
                  : translate(
                      'auto.components.right.sidebar.BitbucketReviewActions.approve',
                      'Approve'
                    )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {reviewDecision === 'APPROVED'
              ? translate(
                  'auto.components.right.sidebar.BitbucketReviewActions.undoApproveTooltip',
                  'Clear your approval of this pull request'
                )
              : translate(
                  'auto.components.right.sidebar.BitbucketReviewActions.approveTooltip',
                  'Approve this pull request as the authenticated user'
                )}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="xs"
              variant="outline"
              className={cn(
                'h-6 gap-1 px-2 text-[11px]',
                needsWorkMarked
                  ? 'border-destructive/60 bg-destructive/15 text-destructive hover:bg-destructive/25'
                  : 'text-destructive hover:bg-destructive/10'
              )}
              disabled={anyDisabled}
              onClick={handleNeedsWork}
            >
              {statusUpdating === 'NEEDS_WORK' || statusUpdating === 'UNAPPROVED' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {statusUpdating === 'NEEDS_WORK'
                ? translate(
                    'auto.components.right.sidebar.BitbucketReviewActions.requestingChanges',
                    'Marking needs work...'
                  )
                : needsWorkMarked
                  ? translate(
                      'auto.components.right.sidebar.BitbucketReviewActions.needsWorkMarked',
                      'Needs work'
                    )
                  : translate(
                      'auto.components.right.sidebar.BitbucketReviewActions.requestChanges',
                      'Needs work'
                    )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {needsWorkMarked
              ? translate(
                  'auto.components.right.sidebar.BitbucketReviewActions.needsWorkMarkedTooltip',
                  'This pull request is marked as needing work. Click to clear.'
                )
              : translate(
                  'auto.components.right.sidebar.BitbucketReviewActions.requestChangesTooltip',
                  'Mark this pull request as needing work before it can merge'
                )}
          </TooltipContent>
        </Tooltip>
      </div>
      <HostedReviewActionError message={statusError} />
      {/* languageRevision keeps translated labels fresh; no state derives from it directly. */}
      <span className="hidden" data-language-revision={languageRevision} />
    </div>
  )
}
