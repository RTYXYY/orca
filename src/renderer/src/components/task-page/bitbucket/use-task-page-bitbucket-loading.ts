import { useEffect } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { TaskProvider } from '../../../../../shared/task-providers'
import type { BitbucketWorkItem, BitbucketTaskFilter } from '../../../../../shared/bitbucket-types'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import { mapSettledWithConcurrency } from '../../../../../shared/map-with-concurrency'
import { listBitbucketTaskPRs } from './bitbucket-task-pr-rpc'

// Leave headroom below the runtime RPC foreground concurrency of eight for sidebar and other callers.
export const BITBUCKET_TASK_FETCH_CONCURRENCY = 6

type FetchResult = { repo: Repo; items: BitbucketWorkItem[]; error: string | null }

type BitbucketLoadingInput = {
  selectedRepos: readonly Repo[]
  selectedReposKey: string
  taskSource: TaskProvider
  activeBitbucketFilter: BitbucketTaskFilter
  bitbucketRefreshNonce: number
  setBitbucketItems: (items: BitbucketWorkItem[]) => void
  setBitbucketLoading: (loading: boolean) => void
  setBitbucketError: (error: string | null) => void
}

export function useTaskPageBitbucketLoading<Model extends BitbucketLoadingInput>(
  model: Model
): Model {
  const {
    selectedRepos,
    selectedReposKey,
    taskSource,
    activeBitbucketFilter,
    bitbucketRefreshNonce,
    setBitbucketItems,
    setBitbucketLoading,
    setBitbucketError
  } = model
  useEffect(() => {
    if (taskSource !== 'bitbucket') {
      return
    }
    if (selectedRepos.length === 0) {
      setBitbucketItems([])
      setBitbucketLoading(false)
      setBitbucketError(null)
      return
    }
    let stale = false
    const emptyResult = (repo: Repo): FetchResult => ({ repo, items: [], error: null })
    setBitbucketLoading(true)
    setBitbucketError(null)
    void mapSettledWithConcurrency(selectedRepos, BITBUCKET_TASK_FETCH_CONCURRENCY, (repo) =>
      // Why: a stale selection's results are discarded below, so skip the repos not yet started.
      stale
        ? Promise.resolve(emptyResult(repo))
        : listBitbucketTaskPRs({ repo, filter: activeBitbucketFilter }).then((result) => ({
            repo,
            items: result.items,
            error: result.error
          }))
    )
      .then((results) => {
        if (stale) {
          return
        }
        const merged: BitbucketWorkItem[] = []
        const errs: string[] = []
        for (const r of results) {
          if (r.status !== 'fulfilled') {
            errs.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
            continue
          }
          // Why the host: a twin's two rows share the id, so only the stamp names the row that answered.
          const repoHostId = getRepoExecutionHostId(r.value.repo)
          for (const item of r.value.items) {
            merged.push({ ...item, repoId: r.value.repo.id, repoHostId })
          }
          if (r.value.error) {
            errs.push(r.value.error)
          }
        }
        merged.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        setBitbucketItems(merged)
        // Show failures only when no usable rows remain; mixed selections may include non-Bitbucket repos.
        if (errs.length > 0 && merged.length === 0) {
          setBitbucketError(errs[0])
        }
      })
      .finally(() => {
        if (!stale) {
          setBitbucketLoading(false)
        }
      })
    return () => {
      stale = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedReposKey covers every selectedRepos field read above; keying off the array ref would re-run on every parent render.
  }, [
    taskSource,
    activeBitbucketFilter,
    bitbucketRefreshNonce,
    selectedReposKey,
    setBitbucketError,
    setBitbucketItems,
    setBitbucketLoading
  ])
  return model
}
