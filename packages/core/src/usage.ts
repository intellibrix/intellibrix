import type { Usage } from './provider.js'

/**
 * Per-million-token pricing for a `"provider:model"` key.
 */
export type PriceTable = Record<string, { inputPerMillion: number; outputPerMillion: number }>

/**
 * A conservative, non-exhaustive starting price table. Applications are
 * expected to maintain their own — this is a convenience default, not a
 * pricing source of truth, and goes stale as vendors change prices.
 */
export const defaultPriceTable: PriceTable = {
  'anthropic:claude-sonnet-5': { inputPerMillion: 3, outputPerMillion: 15 },
  'anthropic:claude-opus-5': { inputPerMillion: 15, outputPerMillion: 75 },
  'anthropic:claude-haiku-4-5': { inputPerMillion: 1, outputPerMillion: 5 },
  'openai:gpt-5': { inputPerMillion: 5, outputPerMillion: 15 },
}

/**
 * Running totals accumulated across one or more `.add()` calls.
 */
export type UsageTotals = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** `undefined` when any added usage's model key wasn't found in the price table. */
  cost: number | undefined
}

/**
 * Accumulates token usage (and, optionally, cost) across model calls.
 * `runAgentLoop` owns a per-run accumulator; a `Brick` or `Structure` can
 * hold a long-lived one and pass `.child()` into each call so totals roll up
 * across calls (and across bricks, for a `Structure`).
 */
export class UsageAccumulator {
  #inputTokens = 0
  #outputTokens = 0
  #totalTokens = 0
  #cost = 0
  #costKnown = true
  #priceTable: PriceTable
  #parent?: UsageAccumulator

  constructor(priceTable: PriceTable = defaultPriceTable, parent?: UsageAccumulator) {
    this.#priceTable = priceTable
    this.#parent = parent
  }

  /**
   * Adds one model step's usage to the running totals (and to any parent
   * this accumulator is a `.child()` of). `modelKey` (e.g.
   * `"anthropic:claude-sonnet-5"`) is looked up in the price table to
   * compute cost; an unknown key makes `.totals.cost` `undefined` rather
   * than throwing.
   */
  add(usage: Usage, modelKey?: string): void {
    this.#inputTokens += usage.inputTokens ?? 0
    this.#outputTokens += usage.outputTokens ?? 0
    this.#totalTokens += usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)

    const price = modelKey ? this.#priceTable[modelKey] : undefined
    if (price) {
      this.#cost +=
        ((usage.inputTokens ?? 0) / 1_000_000) * price.inputPerMillion +
        ((usage.outputTokens ?? 0) / 1_000_000) * price.outputPerMillion
    } else {
      this.#costKnown = false
    }

    this.#parent?.add(usage, modelKey)
  }

  /** The current running totals. */
  get totals(): UsageTotals {
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      totalTokens: this.#totalTokens,
      cost: this.#costKnown ? this.#cost : undefined,
    }
  }

  /**
   * Creates a new accumulator whose `.add()` calls roll up into this one, for
   * per-call/per-brick totals that still contribute to a parent's grand total.
   */
  child(): UsageAccumulator {
    return new UsageAccumulator(this.#priceTable, this)
  }
}
