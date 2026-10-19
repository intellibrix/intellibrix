import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import ignore from 'ignore'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'
import { withFileLock, writeFileAtomic } from './atomic.js'
import { resolveJailed } from './jail.js'
import type { FileTracker } from './tracker.js'

const MAX_READ_BYTES = 256 * 1024
/** Largest file a ranged read will scan, since only a slice is returned. */
const MAX_RANGED_READ_BYTES = 10 * 1024 * 1024
const MAX_RESULTS = 500
const MAX_GLOB_LENGTH = 1024
const MAX_BRACE_DEPTH = 5

/**
 * Glob patterns come from the model, so they are validated before reaching fast-glob. They must
 * stay inside the workspace (no absolute paths, no `..` segments, even via brace expansion), and
 * are bounded in length and brace nesting because deeply nested braces can exhaust the stack in
 * the `braces` dependency.
 */
function assertSafeGlob(pattern: string): string {
  if (pattern.length > MAX_GLOB_LENGTH) throw new Error('Glob pattern is too long')
  let depth = 0
  for (const char of pattern) {
    if (char === '{') depth++
    else if (char === '}') depth = Math.max(0, depth - 1)
    if (depth > MAX_BRACE_DEPTH) throw new Error('Glob pattern nests braces too deeply')
  }
  if (
    /^!*(?:[/\\~]|[a-zA-Z]:)/.test(pattern) ||
    /(?:^|[/\\{,!(|])\.\.(?:$|[/\\},)|])/.test(pattern)
  ) {
    throw new Error('Glob pattern must be relative to the workspace and cannot contain ".."')
  }
  return pattern
}

export type FsToolOptions = {
  root: string
  /** Require approval for `write_file`/`edit_file`. @default true */
  approveWrites?: boolean
  /**
   * Refuse `write_file`/`edit_file` on an existing file the model has not read, or that changed
   * since it did. Share the tracker with `agentTools` so `apply_patch` follows the same rule.
   */
  tracker?: FileTracker
}

async function gitignoreFilter(root: string) {
  const ig = ignore().add(['.git', 'node_modules'])
  try {
    ig.add(await readFile(path.join(root, '.gitignore'), 'utf8'))
  } catch {}
  return ig
}

/** Jailed read tools (`read_file`, `list_dir`, `glob`, `grep`) and write tools (`write_file`, `edit_file`). */
export function fsTools({ root, approveWrites = true, tracker }: FsToolOptions): ToolDefinition[] {
  const read_file = defineTool({
    name: 'read_file',
    description:
      'Read a UTF-8 text file inside the workspace. For large files pass offset (1-based first line) and limit (number of lines); lineNumbers prefixes each line with its number.',
    input: z.object({
      path: z.string(),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional(),
      lineNumbers: z.boolean().default(false),
    }),
    resultTrust: 'untrusted',
    execute: async ({ path: p, offset, limit, lineNumbers }) => {
      const file = await resolveJailed(root, p)
      const info = await stat(file)
      const ranged = offset !== undefined || limit !== undefined
      if (!ranged && !lineNumbers && info.size <= MAX_READ_BYTES) {
        const content = await readFile(file, 'utf8')
        tracker?.recordRead(file, content)
        return { path: p, content }
      }
      if (info.size > MAX_RANGED_READ_BYTES || (!ranged && info.size > MAX_READ_BYTES)) {
        const limitBytes = ranged ? MAX_RANGED_READ_BYTES : MAX_READ_BYTES
        throw new Error(
          `File is ${info.size} bytes; the limit is ${limitBytes}${ranged ? '' : '. Pass offset and limit to read part of it'}`,
        )
      }
      const text = await readFile(file, 'utf8')
      // A slice counts as a read: the model chose to look at the file, and a later change is caught.
      tracker?.recordRead(file, text)
      const lines = text.split('\n')
      if (lines.at(-1) === '') lines.pop()
      const start = (offset ?? 1) - 1
      let end = Math.min(lines.length, start + (limit ?? lines.length))
      // Cap what comes back at the size a whole-file read would allow.
      let bytes = 0
      for (let i = start; i < end; i++) {
        bytes += Buffer.byteLength(lines[i] as string) + 1
        if (bytes > MAX_READ_BYTES && i > start) {
          end = i
          break
        }
      }
      const width = String(end).length
      const content = lines
        .slice(start, end)
        .map((l, i) => (lineNumbers ? `${String(start + i + 1).padStart(width)}\t${l}` : l))
        .join('\n')
      return {
        path: p,
        content: end > start ? `${content}\n` : '',
        startLine: start + 1,
        endLine: end,
        totalLines: lines.length,
        truncated: end < lines.length,
      }
    },
  })

  const list_dir = defineTool({
    name: 'list_dir',
    description: 'List the entries of a directory inside the workspace.',
    input: z.object({ path: z.string().default('.') }),
    resultTrust: 'untrusted',
    execute: async ({ path: p }) => {
      const dir = await resolveJailed(root, p ?? '.')
      const entries = await readdir(dir, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
    },
  })

  const glob = defineTool({
    name: 'glob',
    description: 'Find files by glob pattern, respecting .gitignore.',
    input: z.object({ pattern: z.string() }),
    resultTrust: 'untrusted',
    execute: async ({ pattern }) => {
      const realRoot = await resolveJailed(root, '.')
      const ig = await gitignoreFilter(realRoot)
      const files: string[] = await fg(assertSafeGlob(pattern), {
        cwd: realRoot,
        dot: true,
        followSymbolicLinks: false,
      })
      return files
        .filter((f) => !ig.ignores(f))
        .sort()
        .slice(0, MAX_RESULTS)
    },
  })

  const grep = defineTool({
    name: 'grep',
    description: 'Search file contents with a regular expression, respecting .gitignore.',
    input: z.object({
      pattern: z.string(),
      glob: z.string().default('**/*'),
      ignoreCase: z.boolean().default(false),
    }),
    resultTrust: 'untrusted',
    execute: async (input) => {
      const realRoot = await resolveJailed(root, '.')
      const ig = await gitignoreFilter(realRoot)
      const re = new RegExp(input.pattern, input.ignoreCase ? 'i' : '')
      const found: string[] = await fg(assertSafeGlob(input.glob ?? '**/*'), {
        cwd: realRoot,
        dot: true,
        followSymbolicLinks: false,
      })
      const files = found.filter((f) => !ig.ignores(f)).sort()
      const matches: { file: string; line: number; text: string }[] = []
      for (const file of files) {
        let lines: string[]
        let full: string
        let text: string
        try {
          full = await resolveJailed(realRoot, file)
          if ((await stat(full)).size > MAX_READ_BYTES) continue
          text = await readFile(full, 'utf8')
          lines = text.split('\n')
        } catch {
          continue // symlink escaping the jail, unreadable, or a directory
        }
        const before = matches.length
        for (const [i, line] of lines.entries()) {
          if (re.test(line)) matches.push({ file, line: i + 1, text: line.slice(0, 300) })
          if (matches.length >= MAX_RESULTS) break
        }
        // The model saw lines of this file, so it counts as read (see FileTracker). Files with no
        // matches were not shown, so they do not.
        if (matches.length > before) tracker?.recordRead(full, text)
        if (matches.length >= MAX_RESULTS) return matches
      }
      return matches
    },
  })

  const write_file = defineTool({
    name: 'write_file',
    description: 'Create or overwrite a file inside the workspace.',
    input: z.object({ path: z.string(), content: z.string() }),
    needsApproval: approveWrites,
    execute: async ({ path: p, content }) => {
      const file = await resolveJailed(root, p)
      // One writer per file at a time: parallel calls would otherwise overwrite each other.
      return withFileLock(file, async () => {
        const existing = await readFile(file, 'utf8').catch(() => undefined)
        tracker?.assertFresh(file, existing, p)
        await mkdir(path.dirname(file), { recursive: true })
        // Re-resolve after mkdir so a symlinked parent created in between cannot redirect the write.
        const target = await resolveJailed(root, p)
        await writeFileAtomic(target, content, { expected: existing ?? null })
        tracker?.recordWrite(target, content)
        return { path: p, bytes: Buffer.byteLength(content) }
      })
    },
  })

  const edit_file = defineTool({
    name: 'edit_file',
    description:
      'Replace one exact occurrence of oldString with newString in a file. Fails unless oldString matches exactly once.',
    input: z.object({ path: z.string(), oldString: z.string().min(1), newString: z.string() }),
    needsApproval: approveWrites,
    execute: async ({ path: p, oldString, newString }) => {
      const file = await resolveJailed(root, p)
      return withFileLock(file, async () => {
        const content = await readFile(file, 'utf8')
        tracker?.assertFresh(file, content, p)
        const count = content.split(oldString).length - 1
        if (count !== 1)
          throw new Error(`oldString must match exactly once; found ${count} matches`)
        const updated = content.replace(oldString, () => newString)
        await writeFileAtomic(file, updated, { expected: content })
        tracker?.recordWrite(file, updated)
        return { path: p, replaced: 1 }
      })
    },
  })

  return [read_file, list_dir, glob, grep, write_file, edit_file]
}
