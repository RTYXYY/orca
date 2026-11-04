// @vitest-environment happy-dom

import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { BitbucketReviewActions } from './BitbucketReviewActions'
import { TooltipProvider } from '@/components/ui/tooltip'

const rpcMocks = vi.hoisted(() => ({
  callRuntimeRpc: vi.fn()
}))

vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: rpcMocks.callRuntimeRpc
}))

const repo = { id: 'repo-1', path: '/repo', displayName: 'repo', kind: 'git' } as Repo

/** Simulates the checks panel: the refresh callback flips the prop the server would return. */
let serverDecision: string | null

function Probe(): React.JSX.Element {
  const [decision, setDecision] = useState(serverDecision)
  return (
    <TooltipProvider>
      <BitbucketReviewActions
        repo={repo}
        prNumber={12}
        reviewDecision={decision}
        disabled={false}
        onRefreshReview={async () => {
          setDecision(serverDecision)
        }}
      />
    </TooltipProvider>
  )
}

let root: Root | null = null
let container: HTMLElement

function approveButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.match(/Approve|Undo approve|Updating/i)
  )
  if (!button) {
    throw new Error('approve button not found')
  }
  return button
}

function needsWorkButton(): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.match(/Needs work|Marking needs work/i)
  )
  if (!button) {
    throw new Error('needs work button not found')
  }
  return button
}

async function renderPanel(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(Probe))
  })
}

function mockStatusRpc(): void {
  rpcMocks.callRuntimeRpc.mockImplementation(async (_target, method, params) => {
    if (method === 'bitbucket.setPRReviewStatus') {
      serverDecision =
        params.status === 'APPROVED'
          ? 'APPROVED'
          : params.status === 'NEEDS_WORK'
            ? 'CHANGES_REQUESTED'
            : null
      return { ok: true, status: params.status }
    }
    throw new Error(`unexpected rpc ${method}`)
  })
}

describe('BitbucketReviewActions button toggling', () => {
  beforeEach(() => {
    rpcMocks.callRuntimeRpc.mockReset()
    serverDecision = null
  })

  afterEach(async () => {
    await act(async () => {
      root?.unmount()
    })
    container.remove()
  })

  it('approve → Undo approve → back to Approve', async () => {
    mockStatusRpc()
    await renderPanel()
    expect(approveButton().textContent).toContain('Approve')

    await act(async () => {
      approveButton().click()
    })
    expect(serverDecision).toBe('APPROVED')
    expect(approveButton().textContent).toContain('Undo approve')

    await act(async () => {
      approveButton().click()
    })
    expect(serverDecision).toBeNull()
    expect(approveButton().textContent).toContain('Approve')
  })

  it('needs work single click marks, second click clears', async () => {
    mockStatusRpc()
    await renderPanel()
    expect(needsWorkButton().textContent).toContain('Needs work')
    expect(needsWorkButton().className).not.toContain('bg-destructive/15')

    await act(async () => {
      needsWorkButton().click()
    })
    expect(serverDecision).toBe('CHANGES_REQUESTED')
    expect(needsWorkButton().className).toContain('bg-destructive/15')

    await act(async () => {
      needsWorkButton().click()
    })
    expect(serverDecision).toBeNull()
    expect(needsWorkButton().className).not.toContain('bg-destructive/15')
  })

  it('needs work has no confirm step', async () => {
    mockStatusRpc()
    await renderPanel()
    await act(async () => {
      needsWorkButton().click()
    })
    // One click already sent the mutation — no "Confirm" intermediate state.
    expect(rpcMocks.callRuntimeRpc).toHaveBeenCalledTimes(1)
    expect(needsWorkButton().textContent).not.toContain('Confirm')
  })
})
