import { describe, expect, it } from 'vitest'
import { Brick } from '../src/index.js'

describe('@intellibrix/ai-sdk scaffold', () => {
  it('resolves and re-exports intellibrix core', () => {
    expect(Brick).toBeDefined()
  })
})
