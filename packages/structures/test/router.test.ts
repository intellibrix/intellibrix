import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import { router } from '../src/router.js'

function makeBrick(name: string, reply: string) {
  return new Brick({
    name,
    intelligence: new Intelligence({
      provider: new MockProvider([{ text: reply }]),
      model: 'mock',
    }),
  })
}

describe('router', () => {
  it('dispatches to the matched route', async () => {
    const billing = makeBrick('billing', 'billing handled it')
    const support = makeBrick('support', 'support handled it')

    const classifierProvider = new MockProvider([
      { toolCalls: [{ toolName: '_respond_with_schema', input: { route: 'billing' } }] },
    ])

    const r = router({
      classifier: new Intelligence({ provider: classifierProvider, model: 'mock' }),
      routes: { billing, support },
    })

    const result = await r.ask('I have a billing question')
    expect(result.text).toBe('billing handled it')
  })

  it('dispatches to every configured route', async () => {
    for (const route of ['billing', 'support']) {
      const billing = makeBrick('billing', 'billing reply')
      const support = makeBrick('support', 'support reply')
      const classifierProvider = new MockProvider([
        { toolCalls: [{ toolName: '_respond_with_schema', input: { route } }] },
      ])
      const r = router({
        classifier: new Intelligence({ provider: classifierProvider, model: 'mock' }),
        routes: { billing, support },
      })
      const result = await r.ask('hi')
      expect(result.text).toBe(route === 'billing' ? 'billing reply' : 'support reply')
    }
  })

  it('falls back to `fallback` when the classifier picks an unknown route', async () => {
    const billing = makeBrick('billing', 'billing reply')
    const fallback = makeBrick('fallback', 'fallback reply')

    const classifierProvider = new MockProvider([
      { toolCalls: [{ toolName: '_respond_with_schema', input: { route: 'unknown-route' } }] },
    ])

    const r = router({
      classifier: new Intelligence({ provider: classifierProvider, model: 'mock' }),
      routes: { billing },
      fallback,
    })

    const result = await r.ask('something ambiguous')
    expect(result.text).toBe('fallback reply')
  })

  it('throws when no route matches and no fallback is configured', async () => {
    const billing = makeBrick('billing', 'billing reply')
    const classifierProvider = new MockProvider([
      { toolCalls: [{ toolName: '_respond_with_schema', input: { route: 'unknown-route' } }] },
    ])

    const r = router({
      classifier: new Intelligence({ provider: classifierProvider, model: 'mock' }),
      routes: { billing },
    })

    await expect(r.ask('something ambiguous')).rejects.toThrow(
      'no route matched "unknown-route" and no fallback set',
    )
  })
})
