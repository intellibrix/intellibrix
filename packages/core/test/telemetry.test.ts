import { describe, expect, it } from 'vitest'
import { getTracer, resetTracer, withSpan } from '../src/telemetry.js'

describe('telemetry', () => {
  it('falls back to a no-op tracer/span when @opentelemetry/api is absent', async () => {
    resetTracer()
    const tracer = getTracer()
    const span = tracer.startSpan('test-span')

    // No-op span methods must not throw.
    span.setAttribute('key', 'value')
    span.recordException(new Error('boom'))
    span.end()

    expect(tracer).toBeDefined()
  })

  it('getTracer() memoizes across calls', () => {
    resetTracer()
    const a = getTracer()
    const b = getTracer()
    expect(a).toBe(b)
  })

  it('withSpan records an exception and always ends the span, then rethrows', async () => {
    resetTracer()
    let ended = false
    let recordedError: unknown
    const span = {
      setAttribute() {},
      recordException(error: unknown) {
        recordedError = error
      },
      end() {
        ended = true
      },
    }
    const tracer = { startSpan: () => span }

    await expect(
      withSpan(
        'failing-op',
        async () => {
          throw new Error('nope')
        },
        tracer,
      ),
    ).rejects.toThrow('nope')

    expect(ended).toBe(true)
    expect(recordedError).toBeInstanceOf(Error)
  })

  it('withSpan returns the callback result and ends the span on success', async () => {
    let ended = false
    const span = {
      setAttribute() {},
      recordException() {},
      end() {
        ended = true
      },
    }
    const tracer = { startSpan: () => span }

    const result = await withSpan('op', async () => 42, tracer)
    expect(result).toBe(42)
    expect(ended).toBe(true)
  })
})
