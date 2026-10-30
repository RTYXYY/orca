import { useState } from 'react'
import { ImeTextarea } from '@/lib/ime-text-field'
import { CornerDownLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'

type Props = {
  onReply: (body: string) => Promise<boolean>
  onContentResize: () => void
}

function resizeReplyTextarea(textarea: HTMLTextAreaElement): boolean {
  const previousHeight = textarea.style.height
  textarea.style.height = 'auto'
  textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`
  return textarea.style.height !== previousHeight
}

/** Inline reply composer for remote diff comment threads (e.g. Bitbucket DC PR comments). */
export function DiffCommentReplyComposer({ onReply, onContentResize }: Props) {
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useMountedRef()
  const trimmed = draft.trim()
  const canSubmit = !submitting && trimmed.length > 0

  const close = (): void => {
    setDraft('')
    setSubmitting(false)
    // Measure after the composer unmounts; the zone must shrink back.
    requestAnimationFrame(onContentResize)
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      return
    }
    setSubmitting(true)
    try {
      const ok = await onReply(trimmed)
      if (ok && mountedRef.current) {
        close()
      }
    } catch (err) {
      console.error('Failed to submit diff comment reply:', err)
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 mt-1">
      <ImeTextarea
        className="orca-diff-comment-popover-textarea"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (resizeReplyTextarea(e.currentTarget)) {
            onContentResize()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
            return
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.shiftKey) {
            e.preventDefault()
            if (!canSubmit) {
              return
            }
            void submit()
          }
        }}
        rows={3}
      />
      <div className="orca-diff-comment-popover-footer">
        <Button variant="ghost" size="sm" onClick={close} disabled={submitting}>
          {translate('auto.components.diff.comments.DiffCommentCard.0203bed775', 'Cancel')}
        </Button>
        <Button
          size="sm"
          onClick={() => void submit()}
          disabled={!canSubmit}
          title={
            submitting
              ? translate(
                  'auto.components.diff.comments.DiffCommentCard.replySubmitting',
                  'Replying…'
                )
              : undefined
          }
        >
          {translate('auto.components.diff.comments.DiffCommentCard.replySubmit', 'Reply')}
          <CornerDownLeft className="ml-1 size-3 opacity-70" />
        </Button>
      </div>
    </div>
  )
}
