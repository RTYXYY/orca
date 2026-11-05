import { describe, expect, it } from 'vitest'
import { prCommentLocation, type PRCommentLocationFields } from './pr-comment-location'

const comment = (fields: PRCommentLocationFields): PRCommentLocationFields => fields

describe('prCommentLocation', () => {
  it('resolves a placed inline comment to its path and line', () => {
    expect(prCommentLocation(comment({ path: 'src/app.ts', line: 42 }))).toEqual({
      path: 'src/app.ts',
      line: 42
    })
  })

  it('prefers startLine so ranges jump to their first line', () => {
    expect(prCommentLocation(comment({ path: 'a.ts', line: 10, startLine: 4 }))).toEqual({
      path: 'a.ts',
      line: 4
    })
  })

  it('drops outdated (orphaned) anchors', () => {
    expect(prCommentLocation(comment({ path: 'a.ts', line: 3, isOutdated: true }))).toBeNull()
  })

  it('drops conversation comments without a path', () => {
    expect(prCommentLocation(comment({ line: 5 }))).toBeNull()
  })

  it('drops comments without a usable line', () => {
    expect(prCommentLocation(comment({ path: 'a.ts' }))).toBeNull()
    expect(prCommentLocation(comment({ path: 'a.ts', line: 0 }))).toBeNull()
    expect(prCommentLocation(comment({ path: 'a.ts', line: -1 }))).toBeNull()
    expect(prCommentLocation(comment({ path: 'a.ts', line: 1.5 }))).toBeNull()
  })
})
