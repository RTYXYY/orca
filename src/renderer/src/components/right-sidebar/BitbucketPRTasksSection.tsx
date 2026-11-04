import React, { useCallback, useEffect, useState } from 'react'
import { Circle, CircleCheck, ListTodo, LoaderCircle, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useUiLanguageRevision } from '@/i18n/use-ui-language-revision'
import type { Repo } from '../../../../shared/repo-types'
import {
  addBitbucketHostedReviewTask,
  getBitbucketHostedReviewTasks,
  setBitbucketHostedReviewTaskState,
  type BitbucketPRTask
} from './hosted-review-bitbucket-actions'

type TasksState =
  | { phase: 'loading' }
  | { phase: 'error'; error: string }
  | { phase: 'ready'; tasks: BitbucketPRTask[] }

/** Bitbucket Data Center pull request tasks (blocker comments): list, add, resolve, reopen. */
export function BitbucketPRTasksSection({
  repo,
  prNumber,
  refreshKey,
  onTasksLoaded
}: {
  repo: Repo
  prNumber: number
  refreshKey: string
  onTasksLoaded?: (openCount: number) => void
}): React.JSX.Element | null {
  const languageRevision = useUiLanguageRevision()
  const [state, setState] = useState<TasksState>({ phase: 'loading' })
  const [mutatingTaskId, setMutatingTaskId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const reload = useCallback(async () => {
    const result = await getBitbucketHostedReviewTasks({ repo, prNumber })
    if (!result.ok) {
      setState({ phase: 'error', error: result.error })
      return
    }
    setState({ phase: 'ready', tasks: result.tasks })
    onTasksLoaded?.(result.tasks.filter((task) => task.state === 'OPEN').length)
  }, [onTasksLoaded, prNumber, repo])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const handleToggle = useCallback(
    async (task: BitbucketPRTask) => {
      if (mutatingTaskId !== null) {
        return
      }
      const nextState = task.state === 'OPEN' ? 'RESOLVED' : 'OPEN'
      setMutatingTaskId(task.id)
      try {
        const result = await setBitbucketHostedReviewTaskState({
          repo,
          prNumber,
          taskId: task.id,
          state: nextState
        })
        if (!result.ok) {
          toast.error(result.error)
        } else {
          setState((current) => {
            if (current.phase !== 'ready') {
              return current
            }
            return {
              phase: 'ready',
              tasks: current.tasks.map((candidate) =>
                candidate.id === task.id ? result.task : candidate
              )
            }
          })
        }
      } finally {
        setMutatingTaskId(null)
      }
    },
    [mutatingTaskId, prNumber, repo]
  )

  const handleAdd = useCallback(async () => {
    const text = draft.trim()
    if (!text || adding) {
      return
    }
    setAdding(true)
    try {
      const result = await addBitbucketHostedReviewTask({ repo, prNumber, text })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDraft('')
      setState((current) =>
        current.phase === 'ready'
          ? { phase: 'ready', tasks: [...current.tasks, result.task] }
          : current
      )
    } finally {
      setAdding(false)
    }
  }, [adding, draft, prNumber, repo])

  if (state.phase === 'error') {
    return (
      <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground">
        {state.error}
      </div>
    )
  }

  const tasks = state.phase === 'ready' ? state.tasks : []
  const openCount = tasks.filter((task) => task.state === 'OPEN').length

  return (
    <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
        {state.phase === 'loading' ? (
          <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
        ) : (
          <ListTodo className="size-3 text-muted-foreground" />
        )}
        {translate('auto.components.right.sidebar.BitbucketPRTasks.title', 'Tasks')}
        <span className="text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.BitbucketPRTasks.openCount',
            openCount === 1 ? '{{count}} open' : '{{count}} open',
            { count: openCount }
          )}
        </span>
      </div>
      {tasks.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-start gap-1.5">
              <button
                type="button"
                className="mt-0.5 cursor-pointer text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-50"
                disabled={mutatingTaskId !== null}
                title={
                  task.state === 'OPEN'
                    ? translate(
                        'auto.components.right.sidebar.BitbucketPRTasks.resolveTask',
                        'Mark task as done'
                      )
                    : translate(
                        'auto.components.right.sidebar.BitbucketPRTasks.reopenTask',
                        'Reopen task'
                      )
                }
                onClick={() => void handleToggle(task)}
              >
                {mutatingTaskId === task.id ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : task.state === 'OPEN' ? (
                  <Circle className="size-3.5" />
                ) : (
                  <CircleCheck className="size-3.5 text-emerald-500" />
                )}
              </button>
              <span
                className={
                  task.state === 'OPEN'
                    ? 'text-[11px] text-foreground leading-snug break-words min-w-0'
                    : 'text-[11px] text-muted-foreground line-through leading-snug break-words min-w-0'
                }
              >
                {task.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.phase === 'ready' && tasks.length === 0 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.BitbucketPRTasks.empty',
            'No tasks on this pull request'
          )}
        </p>
      )}
      <div className="mt-1.5 flex items-center gap-1">
        <input
          className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          value={draft}
          placeholder={translate(
            'auto.components.right.sidebar.BitbucketPRTasks.addPlaceholder',
            'Add a task…'
          )}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              void handleAdd()
            }
          }}
          disabled={adding}
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="h-6 w-6 shrink-0 p-0"
          disabled={adding || !draft.trim()}
          title={translate('auto.components.right.sidebar.BitbucketPRTasks.addTask', 'Add task')}
          onClick={() => void handleAdd()}
        >
          {adding ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Plus className="size-3.5" />
          )}
        </Button>
      </div>
      {/* languageRevision keeps translated labels fresh; no state derives from it directly. */}
      <span className="hidden" data-language-revision={languageRevision} />
    </div>
  )
}
