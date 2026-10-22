import { Brick, Intelligence } from 'intellibrix'
import { MockProvider } from 'intellibrix/testing'
import { describe, expect, it } from 'vitest'
import type { StructuresEvent } from '../src/events.js'
import { router } from '../src/router.js'
import { supervisor } from '../src/supervisor.js'

function makeBrick(name: string, reply: string) {
  return new Brick({
    name,
    intelligence: new Intelligence({
      provider: new MockProvider([{ text: reply }]),
      model: 'mock',
    }),
  })
}

describe('structures event bubbling', () => {
  it('emits structure:hop with a consistent runId across supervisor delegation', async () => {
    const worker = makeBrick('worker', 'done')
    const events: StructuresEvent[] = []

    const supervisorProvider = new MockProvider([
      { toolCalls: [{ toolName: 'worker', input: { prompt: 'go' } }] },
      { text: 'summary' },
    ])

    const s = supervisor({
      supervisor: new Intelligence({ provider: supervisorProvider, model: 'mock' }),
      bricks: [worker],
      onEvent: (event) => events.push(event),
    })

    const runId = 'fixed-run-id'
    await s.ask('do it', runId)

    const hops = events.filter(
      (e): e is Extract<StructuresEvent, { type: 'structure:hop' }> => e.type === 'structure:hop',
    )
    expect(hops.length).toBeGreaterThan(0)
    for (const hop of hops) expect(hop.runId).toBe(runId)
    expect(hops[0]?.kind).toBe('supervisor')
  })

  it('emits structure:hop for a router dispatch with kind "router"', async () => {
    const billing = makeBrick('billing', 'billing reply')
    const classifierProvider = new MockProvider([
      { toolCalls: [{ toolName: '_respond_with_schema', input: { route: 'billing' } }] },
    ])

    const events: StructuresEvent[] = []
    const r = router({
      classifier: new Intelligence({ provider: classifierProvider, model: 'mock' }),
      routes: { billing },
      onEvent: (event) => events.push(event),
    })

    await r.ask('billing question', 'run-2')

    const hop = events.find((e) => e.type === 'structure:hop')
    expect(hop).toMatchObject({
      type: 'structure:hop',
      runId: 'run-2',
      to: 'billing',
      kind: 'router',
    })
  })
})
