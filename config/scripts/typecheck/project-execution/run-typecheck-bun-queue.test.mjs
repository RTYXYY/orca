import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import { runTypecheckProjects, TYPECHECK_PROJECTS } from './run-typecheck-projects-in-parallel.mjs'

const spawn = vi.fn()
let children
let active
let peak
beforeEach(() => {
  children = []
  active = 0
  peak = 0
  spawn.mockReset().mockImplementation((spec) => {
    const child = new EventEmitter()
    children.push({ child, spec })
    active++
    peak = Math.max(peak, active)
    child.once('close', () => {
      active--
    })
    return child
  })
})

function start(memoryBytes = 16 * 1024 ** 3) {
  return runTypecheckProjects({
    compiler: 'bun',
    bunConcurrency: 2,
    bunThreads: 2,
    spawnCompiler: spawn,
    memoryBytes,
    parallelism: 4
  })
}

it('runs one compiler at a time in project order', async () => {
  const result = start()
  expect(children).toHaveLength(1)
  for (let index = 0; index < TYPECHECK_PROJECTS.length; index++) {
    children[index].child.emit('close', 0, null)
    if (index + 1 < TYPECHECK_PROJECTS.length) {
      await vi.waitFor(() => expect(children).toHaveLength(index + 2))
    }
  }
  expect(await result).toEqual([])
  expect(peak).toBe(1)
  expect(children.map(({ spec }) => spec.args[spec.args.indexOf('-p') + 1])).toEqual(
    TYPECHECK_PROJECTS.map(({ config }) => config)
  )
  expect(children.every(({ spec }) => spec.args[spec.args.indexOf('--threads') + 1] === '2')).toBe(
    true
  )
})

it('keeps checking after compiler failures and reports errors in project order', async () => {
  const result = start()
  children[0].child.emit('close', 1, null)
  await vi.waitFor(() => expect(children).toHaveLength(2))
  children[1].child.emit('close', null, 'SIGKILL')
  await vi.waitFor(() => expect(children).toHaveLength(3))
  for (let index = 2; index < TYPECHECK_PROJECTS.length; index++) {
    children[index].child.emit('close', 0, null)
    if (index + 1 < TYPECHECK_PROJECTS.length) {
      await vi.waitFor(() => expect(children).toHaveLength(index + 2))
    }
  }
  expect((await result).map(({ message }) => message)).toEqual([
    'bun config/tsconfig.node.json exited with code 1',
    'bun config/tsconfig.tc.web.json exited with signal SIGKILL'
  ])
  expect(peak).toBe(1)
})

it('reduces the queue to one slot when two reservations exceed the memory budget', async () => {
  const result = start(4 * 1024 ** 3)
  expect(children).toHaveLength(1)
  for (let index = 0; index < TYPECHECK_PROJECTS.length; index++) {
    await vi.waitFor(() => expect(children).toHaveLength(index + 1))
    children[index].child.emit('close', 0, null)
  }
  expect(await result).toEqual([])
  expect(peak).toBe(1)
})
