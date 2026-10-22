import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { parallel, sequential } from '../src/pipeline.js'

function makeBrick(name: string, reply: string) {
  return new Brick({
    name,
    intelligence: new Intelligence({
      provider: new MockProvider([{ text: reply }]),
      model: 'mock',
    }),
  })
}

describe('pipeline', () => {
  it('sequential chains each step output into the next input, in order', async () => {
    const upper = makeBrick('upper', 'UPPERCASED')
    const suffix = makeBrick('suffix', 'UPPERCASED-DONE')

    const p = sequential([upper, suffix])
    const result = await p.run('hello')

    expect(result).toBe('UPPERCASED-DONE')
  })

  it('parallel fans the same input to every step and collects all results', async () => {
    const a = makeBrick('a', 'result-a')
    const b = makeBrick('b', 'result-b')

    const p = parallel([a, b])
    const result = await p.run('shared input')

    expect(result).toEqual(['result-a', 'result-b'])
  })
})
