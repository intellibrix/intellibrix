import { open } from 'node:fs/promises'

/**
 * Reads a UTF-8 file and its size through one handle, so the size describes the text returned.
 * `text` is undefined, and the file is not read, when it is larger than `maxBytes`.
 */
export async function readTextFile(
  file: string,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<{ size: number; text?: string }> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    return size > maxBytes ? { size } : { size, text: await handle.readFile('utf8') }
  } finally {
    await handle.close()
  }
}
