/**
 * Thrown by {@link assertDepth} when a delegation chain exceeds its configured
 * `maxDepth`.
 */
export class DepthExceededError extends Error {
  constructor(depth: number, max: number) {
    super(`Delegation depth ${depth} exceeded maxDepth ${max}`)
    this.name = 'DepthExceededError'
  }
}

/**
 * Throws {@link DepthExceededError} if `depth` exceeds `max`. Depth is
 * threaded explicitly through each hop's closure (incremented per
 * delegation), not tracked via a global/WeakMap side-table.
 */
export function assertDepth(depth: number, max: number): void {
  if (depth > max) throw new DepthExceededError(depth, max)
}
