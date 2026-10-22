import { describe, expect, it } from 'vitest'
import { type PriceTable, UsageAccumulator } from '../src/usage.js'

const testPriceTable: PriceTable = {
  'test:model': { inputPerMillion: 1, outputPerMillion: 2 },
}

describe('UsageAccumulator', () => {
  it('accumulates token totals across multiple .add() calls', () => {
    const acc = new UsageAccumulator(testPriceTable)
    acc.add({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }, 'test:model')
    acc.add({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }, 'test:model')

    expect(acc.totals.inputTokens).toBe(300)
    expect(acc.totals.outputTokens).toBe(150)
    expect(acc.totals.totalTokens).toBe(450)
  })

  it('computes cost from the price table', () => {
    const acc = new UsageAccumulator(testPriceTable)
    acc.add({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, 'test:model')
    expect(acc.totals.cost).toBeCloseTo(1 + 2)
  })

  it('leaves cost undefined for an unknown model key', () => {
    const acc = new UsageAccumulator(testPriceTable)
    acc.add({ inputTokens: 100, outputTokens: 100 }, 'unknown:model')
    expect(acc.totals.cost).toBeUndefined()
  })

  it('leaves cost undefined once any add() used an unknown key, even after a known one', () => {
    const acc = new UsageAccumulator(testPriceTable)
    acc.add({ inputTokens: 100, outputTokens: 100 }, 'test:model')
    expect(acc.totals.cost).toBeDefined()
    acc.add({ inputTokens: 100, outputTokens: 100 }, 'unknown:model')
    expect(acc.totals.cost).toBeUndefined()
  })

  it('.child() rolls totals up into the parent', () => {
    const parent = new UsageAccumulator(testPriceTable)
    const child = parent.child()

    child.add({ inputTokens: 10, outputTokens: 20 }, 'test:model')
    expect(child.totals.totalTokens).toBe(30)
    expect(parent.totals.totalTokens).toBe(30)

    parent.add({ inputTokens: 5, outputTokens: 5 }, 'test:model')
    expect(parent.totals.totalTokens).toBe(40)
    // Adding directly to the parent must not retroactively appear in the child.
    expect(child.totals.totalTokens).toBe(30)
  })

  it('sums two Structure-level child accumulators (two Bricks) into one grand total', () => {
    const structureUsage = new UsageAccumulator(testPriceTable)
    const brickA = structureUsage.child()
    const brickB = structureUsage.child()

    brickA.add({ inputTokens: 100, outputTokens: 100 }, 'test:model')
    brickB.add({ inputTokens: 200, outputTokens: 200 }, 'test:model')

    expect(structureUsage.totals.totalTokens).toBe(600)
    expect(brickA.totals.totalTokens).toBe(200)
    expect(brickB.totals.totalTokens).toBe(400)
  })
})
