import type { RunEvent } from 'intellibrix'

/**
 * Emitted by supervisor/router/handoff/pipeline at each delegation point.
 * Combined with each Brick's own bubbled `RunEvent`s (annotated with
 * `brickName`), a full multi-agent call graph for a given `runId` can be
 * reconstructed purely from the event stream.
 */
export type StructureHopEvent = {
  type: 'structure:hop'
  runId: string
  from?: string
  to: string
  kind: 'supervisor' | 'router' | 'pipeline' | 'handoff'
  depth?: number
}

export type StructuresEvent = RunEvent | StructureHopEvent

export type StructuresEventHandler = (event: StructuresEvent) => void
