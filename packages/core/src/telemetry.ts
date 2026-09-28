import { createRequire } from 'node:module'

/**
 * A structural span, shaped closely enough to `@opentelemetry/api`'s `Span`
 * to be a drop-in for anyone bridging into a real OTel setup, but never
 * re-exported from that package — `tsc` never needs `@opentelemetry/api`
 * installed to typecheck core.
 */
export type Span = {
  setAttribute(key: string, value: string | number | boolean): void
  recordException(error: unknown): void
  end(): void
}

/**
 * A structural tracer. `startSpan` begins a span the caller must `end()`.
 */
export type Tracer = {
  startSpan(name: string): Span
}

const noopSpan: Span = {
  setAttribute() {},
  recordException() {},
  end() {},
}

const noopTracer: Tracer = {
  startSpan: () => noopSpan,
}

const require = createRequire(import.meta.url)

let cachedTracer: Tracer | undefined

/**
 * Memoizes a single attempt to load `@opentelemetry/api` (an optional peer)
 * and wrap its tracer behind our structural {@link Tracer} shape, falling
 * back to a permanent no-op tracer/span pair if the package isn't installed
 * or the attempt otherwise fails. Never throws.
 */
export function getTracer(name = 'intellibrix'): Tracer {
  if (cachedTracer) return cachedTracer

  try {
    const otel = require('@opentelemetry/api')
    const realTracer = otel.trace.getTracer(name)

    cachedTracer = {
      startSpan(spanName: string): Span {
        const realSpan = realTracer.startSpan(spanName)
        return {
          setAttribute(key, value) {
            realSpan.setAttribute(key, value)
          },
          recordException(error) {
            realSpan.recordException(error as Error)
          },
          end() {
            realSpan.end()
          },
        }
      },
    }
  } catch {
    cachedTracer = noopTracer
  }

  return cachedTracer
}

/**
 * Runs `fn` inside a span named `name`, recording any thrown exception and
 * always ending the span. Test-only escape hatch: pass a `tracer` to avoid
 * the memoized global.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  tracer: Tracer = getTracer(),
): Promise<T> {
  const span = tracer.startSpan(name)
  try {
    return await fn(span)
  } catch (error) {
    span.recordException(error)
    throw error
  } finally {
    span.end()
  }
}

/** Test-only: clears the memoized tracer so `getTracer()` re-attempts resolution. */
export function resetTracer(): void {
  cachedTracer = undefined
}
