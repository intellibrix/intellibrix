import { realpath } from 'node:fs/promises'
import path from 'node:path'

/** Thrown when a requested path resolves outside the workspace root. */
export class JailEscapeError extends Error {
  constructor(requested: string) {
    super(`Path escapes the workspace root: ${requested}`)
    this.name = 'JailEscapeError'
  }
}

function contains(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
}

/** `realpath` of the deepest existing ancestor of `target`, with the missing tail re-appended. */
async function realpathOfExisting(target: string): Promise<string> {
  const tail: string[] = []
  let current = target
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Resolves `requested` (relative to `root`, or absolute) to an absolute path
 * guaranteed to lie inside `root`.
 *
 * The lexical check alone is not enough: a symlink inside the root can point
 * outside it. So after resolving, the deepest existing ancestor is
 * `realpath`-ed and containment is checked again. Do not remove that step.
 *
 * @throws {JailEscapeError} if the path escapes the root, lexically or via a symlink.
 */
export async function resolveJailed(root: string, requested: string): Promise<string> {
  const realRoot = await realpath(path.resolve(root))
  const candidate = path.resolve(realRoot, requested)
  if (!contains(realRoot, candidate)) throw new JailEscapeError(requested)

  const real = await realpathOfExisting(candidate)
  if (!contains(realRoot, real)) throw new JailEscapeError(requested)
  return real
}
