import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { asTool } from '../src/as-tool.js'

describe('asTool', () => {
  it('lets a parent Intelligence call a wrapped sub-brick via a scripted tool call', async () => {
    const subProvider = new MockProvider([{ text: 'sub-brick reply' }])
    const subBrick = new Brick({
      name: 'sub',
      intelligence: new Intelligence({ provider: subProvider, model: 'mock' }),
    })

    const parentProvider = new MockProvider([
      { toolCalls: [{ toolName: 'sub', input: { prompt: 'delegate this' } }] },
      { text: 'parent final reply' },
    ])
    const parent = new Intelligence({ provider: parentProvider, model: 'mock' })

    const result = await parent.ask('do something', { tools: [asTool(subBrick)] })

    expect(result.text).toBe('parent final reply')
  })
})
