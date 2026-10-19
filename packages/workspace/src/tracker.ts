import { createHash } from 'node:crypto'

const digest = (content: string) => createHash('sha1').update(content).digest('hex')

/**
 * Remembers what the model last saw of each file, so a write can be refused when the file has
 * changed since (another process, a formatter, the user) or was never read. Share one tracker
 * between `workspaceTools` and `agentTools` so `read_file`, `edit_file`, `write_file` and
 * `apply_patch` agree. Files are keyed by their real path; create one per session.
 */
export class FileTracker {
  readonly #seen = new Map<string, string>()

  /** Notes that the model has just read `content` from `file`. */
  recordRead(file: string, content: string): void {
    this.#seen.set(file, digest(content))
  }

  /** Notes that `file` now holds `content`, because the model wrote it. */
  recordWrite(file: string, content: string): void {
    this.#seen.set(file, digest(content))
  }

  /** Notes that `file` is gone. */
  recordDelete(file: string): void {
    this.#seen.delete(file)
  }

  /**
   * Throws unless the model has seen the file's current `content`. Pass `undefined` for a file that
   * does not exist yet: creating a file needs no prior read.
   */
  assertFresh(file: string, content: string | undefined, label: string): void {
    if (content === undefined) return
    const seen = this.#seen.get(file)
    if (seen === undefined) {
      throw new Error(`Read ${label} before modifying it`)
    }
    if (seen !== digest(content)) {
      throw new Error(
        `${label} has changed since you last read it; read it again before modifying it`,
      )
    }
  }
}
