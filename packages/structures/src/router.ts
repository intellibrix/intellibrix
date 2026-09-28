import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Brick, Intelligence } from 'intellibrix'
import type { StructuresEventHandler } from './events.js'

const routeSchema: StandardSchemaV1<{ route: string }> = {
  '~standard': {
    version: 1,
    vendor: 'intellibrix',
    validate: (value: unknown) => {
      if (value && typeof value === 'object' && 'route' in value) {
        const route = (value as { route: unknown }).route
        if (typeof route === 'string') return { value: { route } }
      }
      return { issues: [{ message: 'Expected { route: string }' }] }
    },
  },
}

/**
 * Options for {@link router}.
 */
export type RouterOptions = {
  classifier: Intelligence
  routes: Record<string, Brick>
  fallback?: Brick
  onEvent?: StructuresEventHandler
}

/**
 * Classifies a prompt into one of `routes` via a single
 * `Intelligence.object()` structured-output call (one model step, no loop),
 * then dispatches to the matched brick's `ask()`. Falls back to `fallback`
 * (if provided) when the classifier picks an unknown route; throws
 * otherwise. No depth limit at this layer — a routed-to brick that is itself
 * a `supervisor()` enforces its own limit.
 */
export function router(opts: RouterOptions) {
  return {
    async ask(prompt: string, runId?: string) {
      const routeNames = Object.keys(opts.routes)
      const classification = await opts.classifier.object<{ route: string }>(
        routeSchema,
        `Classify the following request into exactly one of these routes: ${routeNames.join(', ')}.\n\nRequest: ${prompt}`,
      )

      const brick = opts.routes[classification.route] ?? opts.fallback
      if (!brick)
        throw new Error(`router: no route matched "${classification.route}" and no fallback set`)

      opts.onEvent?.({
        type: 'structure:hop',
        runId: runId ?? 'unknown',
        to: brick.name,
        kind: 'router',
      })

      return brick.ask(prompt, { runId })
    },
  }
}
