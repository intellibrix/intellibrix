import type { Brick, Program } from 'intellibrix'

/**
 * A pipeline step: either a `Brick` (invoked via `ask()`, receiving/producing
 * a string) or a `Program` (invoked via its owning brick's `run()` — passed
 * as a `[brick, program]` tuple so `pipeline.ts` doesn't need its own
 * dispatch mechanism).
 */
export type PipelineStep = Brick | [Brick, Program]

async function runStep(step: PipelineStep, input: unknown): Promise<unknown> {
  if (Array.isArray(step)) {
    const [brick, program] = step
    return brick.run(program.name, input)
  }

  const result = await step.ask(typeof input === 'string' ? input : JSON.stringify(input))
  return result.text
}

/**
 * Chains each step's output into the next step's input.
 */
export function sequential(steps: PipelineStep[]) {
  return {
    async run(input: unknown): Promise<unknown> {
      let current = input
      for (const step of steps) current = await runStep(step, current)
      return current
    },
  }
}

/**
 * Fans the same input to every step via `Promise.all`, mirroring `loop.ts`'s
 * own parallel tool-dispatch pattern.
 */
export function parallel(steps: PipelineStep[]) {
  return {
    async run(input: unknown): Promise<unknown[]> {
      return Promise.all(steps.map((step) => runStep(step, input)))
    },
  }
}
