import { randomUUID } from 'node:crypto'
import { link, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

const tails = new Map<string, Promise<void>>()

/**
 * Runs `fn` while holding an in-process lock on `file`, so concurrent tool calls on the same file
 * (the agent loop runs one step's calls in parallel) take turns instead of losing each other's
 * update. `file` should be a real path, as `resolveJailed` returns. This does not coordinate
 * between processes.
 */
export async function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(file) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => mine)
  tails.set(file, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (tails.get(file) === tail) tails.delete(file)
  }
}

/** Like {@link withFileLock} for several files at once, taken in a fixed order so callers cannot deadlock. */
export async function withFileLocks<T>(files: string[], fn: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(files)].sort()
  const run = (i: number): Promise<T> =>
    i >= ordered.length ? fn() : withFileLock(ordered[i] as string, () => run(i + 1))
  return run(0)
}

export type WriteFileAtomicOptions = {
  /**
   * What the caller believes is on disk, as UTF-8 text, or `null` if the file must not exist yet.
   * Checked again just before the new content takes its place; if it no longer holds, the write is
   * abandoned with an error and the file is untouched. Omit to skip the check.
   */
  expected?: string | null
}

/**
 * Replaces `file` with `content` so readers see the old content or the new, never a partial file:
 * the content goes to a temporary file in the same directory, which then takes the file's place
 * with a single `rename`. An existing file keeps its permissions. A crash or error leaves the
 * original intact and removes the temporary file.
 *
 * With `expected` set, the file is re-read immediately before the swap and the write is refused if
 * another writer got there first. For `expected: null` the swap is exact (`link` fails if the file
 * exists). For existing files the check narrows the race to the instant between the re-read and
 * the `rename` but does not close it against another process; use {@link withFileLock} to
 * serialize writers within this one.
 */
export async function writeFileAtomic(
  file: string,
  content: string,
  options: WriteFileAtomicOptions = {},
): Promise<void> {
  const existing = await stat(file).catch(() => undefined)
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomUUID().slice(0, 8)}.tmp`,
  )
  try {
    await writeFile(tmp, content, {
      encoding: 'utf8',
      mode: existing ? existing.mode & 0o7777 : 0o666,
    })

    const { expected } = options
    if (expected === null) {
      try {
        await link(tmp, file) // fails with EEXIST if someone created the file meanwhile
        await unlink(tmp)
        return
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(`${path.basename(file)} was created by someone else while writing`)
        }
        // Filesystems without hard links: fall back to a checked rename.
        if (
          await stat(file).then(
            () => true,
            () => false,
          )
        ) {
          throw new Error(`${path.basename(file)} was created by someone else while writing`)
        }
      }
    } else if (expected !== undefined) {
      const current = await readFile(file, 'utf8').catch(() => undefined)
      if (current !== expected) {
        throw new Error(
          `${path.basename(file)} changed while it was being written; nothing was written`,
        )
      }
    }
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}
