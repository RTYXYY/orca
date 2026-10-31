import type { TaskPageComposerActionsModel } from '../use-task-page-composer-actions'
import { cn } from '@/lib/utils'
import TaskProjectSourceCombobox from '@/components/task-project-source-combobox'
import { normalizeTaskRepoSelection } from '@/components/task-page/task-page-default-repo-selection'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { LoaderCircle, RefreshCw } from 'lucide-react'

export function TaskPageBitbucketFilters({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const {
    updateSettings,
    eligibleRepos,
    repoSelection,
    setRepoSelection,
    taskPickerGroups,
    taskPickerRepos,
    bitbucketPRFilters,
    getTaskPickerRepoHostLabel,
    setBitbucketFilter,
    bitbucketLoading,
    setBitbucketRefreshNonce,
    activeBitbucketFilter
  } = model
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="min-w-0 w-full sm:w-[200px]">
          <TaskProjectSourceCombobox
            groups={taskPickerGroups}
            selected={repoSelection}
            getRepoHostLabel={getTaskPickerRepoHostLabel}
            onChange={(next) => {
              const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
              setRepoSelection(normalized)
              void updateSettings({
                defaultRepoSelection: [...normalized]
              }).catch(() => {
                toast.error(
                  translate(
                    'auto.components.TaskPage.dfd72673e7',
                    'Failed to save project selection.'
                  )
                )
              })
            }}
            onSelectAll={() => {
              const allIds = new Set(taskPickerRepos.map((r) => r.id))
              setRepoSelection(allIds)
              void updateSettings({
                defaultRepoSelection: null
              }).catch(() => {
                toast.error(
                  translate(
                    'auto.components.TaskPage.dfd72673e7',
                    'Failed to save project selection.'
                  )
                )
              })
            }}
            triggerClassName="h-8 w-full rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
          />
        </div>
      </div>
      <div className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {bitbucketPRFilters.map(({ id, label }) => {
                const active = activeBitbucketFilter === id
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setBitbucketFilter(id)
                      setBitbucketRefreshNonce((n) => n + 1)
                    }}
                    className={cn(
                      'rounded-md border px-2 py-1 text-xs transition',
                      active
                        ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                        : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setBitbucketRefreshNonce((n) => n + 1)}
                  disabled={bitbucketLoading}
                  aria-label={translate(
                    'auto.components.TaskPage.refreshBitbucketPRs',
                    'Refresh Bitbucket pull requests'
                  )}
                >
                  {bitbucketLoading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {translate(
                  'auto.components.TaskPage.refreshBitbucketPRs',
                  'Refresh Bitbucket pull requests'
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  )
}
