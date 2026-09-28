import { describe, expect, it } from 'vitest'
import { assertDepth, DepthExceededError } from '../src/limits.js'

describe('assertDepth', () => {
  it('does not throw when depth is within max', () => {
    expect(() => assertDepth(3, 3)).not.toThrow()
  })

  it('throws DepthExceededError when depth exceeds max', () => {
    expect(() => assertDepth(4, 3)).toThrow(DepthExceededError)
  })
})
