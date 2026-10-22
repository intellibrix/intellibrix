import type { Message } from './messages.js'

/**
 * The saveable state of an in-progress agent-loop run.
 */
export type CheckpointState = {
  messages: Message[]
  stepIndex: number
}

/**
 * A save/load hook a durable-execution backend can implement against.
 *
 * This is deliberately a small seam, not a workflow engine: no retry or
 * journaling semantics, no exactly-once guarantees. A production
 * `Checkpointer` (backed by Temporal, Inngest, a database, etc.) is expected
 * to be supplied by the application, not intellibrix itself.
 */
export interface Checkpointer {
  save(runId: string, state: CheckpointState): Promise<void>
  load(runId: string): Promise<CheckpointState | undefined>
}

/**
 * The default {@link Checkpointer}: an in-memory `Map`. State does not
 * survive process restarts; suitable for local development and tests, and as
 * the loop's default so behavior is unchanged for callers who don't opt in.
 */
export class InMemoryCheckpointer implements Checkpointer {
  #store = new Map<string, CheckpointState>()

  async save(runId: string, state: CheckpointState): Promise<void> {
    this.#store.set(runId, { messages: [...state.messages], stepIndex: state.stepIndex })
  }

  async load(runId: string): Promise<CheckpointState | undefined> {
    const state = this.#store.get(runId)
    if (!state) return undefined
    return { messages: [...state.messages], stepIndex: state.stepIndex }
  }
}
