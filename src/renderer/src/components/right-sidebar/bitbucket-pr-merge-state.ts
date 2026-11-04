import type { HostedReviewInfo } from '../../../../shared/source-control/hosted-review/hosted-review-contracts'
import { translate } from '@/i18n/i18n'

type BitbucketPRMergeStateReview = Pick<
  HostedReviewInfo,
  'state' | 'status' | 'mergeable' | 'reviewDecision'
>

type MergePresentation = {
  label: string
  tooltip: string
  directMergeAvailable: boolean
}

function blockedPresentation(label: string, tooltip: string): MergePresentation {
  return { label, tooltip, directMergeAvailable: false }
}

/** Map a Bitbucket Data Center pull request's merge/readiness signals to a merge button state. */
export function presentBitbucketPRMergeState(
  review: BitbucketPRMergeStateReview
): MergePresentation {
  if (review.state === 'merged') {
    return {
      label: translate('auto.components.right.sidebar.bitbucket.pr.merge.state.merged', 'Merged'),
      tooltip: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.mergedTooltip',
        'This pull request is already merged'
      ),
      directMergeAvailable: false
    }
  }
  if (review.state === 'closed') {
    return {
      label: translate('auto.components.right.sidebar.bitbucket.pr.merge.state.closed', 'Closed'),
      tooltip: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.closedTooltip',
        'This pull request is declined'
      ),
      directMergeAvailable: false
    }
  }
  if (review.state === 'draft') {
    return {
      label: translate('auto.components.right.sidebar.bitbucket.pr.merge.state.draft', 'Draft'),
      tooltip: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.draftTooltip',
        'This pull request is still a draft'
      ),
      directMergeAvailable: false
    }
  }
  if (review.mergeable === 'CONFLICTING') {
    return blockedPresentation(
      translate('auto.components.right.sidebar.bitbucket.pr.merge.state.conflicts', 'Conflicts'),
      translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.conflictsTooltip',
        'Bitbucket reports merge conflicts'
      )
    )
  }
  if (review.reviewDecision === 'CHANGES_REQUESTED') {
    return blockedPresentation(
      translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.changesRequested',
        'Changes requested'
      ),
      translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.changesRequestedTooltip',
        'A reviewer requested changes on this pull request'
      )
    )
  }
  // Only explicit mergeable means ready; UNKNOWN may hide approval, check, or conflict blockers.
  if (review.mergeable !== 'MERGEABLE') {
    if (review.reviewDecision === 'REVIEW_REQUIRED') {
      return blockedPresentation(
        translate(
          'auto.components.right.sidebar.bitbucket.pr.merge.state.approvalRequired',
          'Approval required'
        ),
        translate(
          'auto.components.right.sidebar.bitbucket.pr.merge.state.approvalRequiredTooltip',
          'Bitbucket requires approval before this pull request can merge'
        )
      )
    }
    if (review.status === 'failure') {
      return blockedPresentation(
        translate(
          'auto.components.right.sidebar.bitbucket.pr.merge.state.checksFailed',
          'Checks failed'
        ),
        translate(
          'auto.components.right.sidebar.bitbucket.pr.merge.state.checksFailedTooltip',
          'Bitbucket has not reported a mergeable status and checks failed'
        )
      )
    }
    return blockedPresentation(
      translate('auto.components.right.sidebar.bitbucket.pr.merge.state.checking', 'Checking'),
      translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.checkingTooltip',
        'Bitbucket is still computing this pull request status'
      )
    )
  }
  if (review.status === 'failure') {
    return {
      label: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.checksFailed',
        'Checks failed'
      ),
      tooltip: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.mergeableChecksFailedTooltip',
        'Bitbucket says this PR can merge, but some checks failed'
      ),
      directMergeAvailable: true
    }
  }
  if (review.status === 'pending') {
    return {
      label: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.checksPending',
        'Checks pending'
      ),
      tooltip: translate(
        'auto.components.right.sidebar.bitbucket.pr.merge.state.checksPendingTooltip',
        'Bitbucket says this PR can merge, but checks are still running'
      ),
      directMergeAvailable: true
    }
  }
  return {
    label: translate(
      'auto.components.right.sidebar.bitbucket.pr.merge.state.ableToMerge',
      'Able to merge'
    ),
    tooltip: translate(
      'auto.components.right.sidebar.bitbucket.pr.merge.state.ableToMergeTooltip',
      'Bitbucket says this pull request can merge'
    ),
    directMergeAvailable: true
  }
}
