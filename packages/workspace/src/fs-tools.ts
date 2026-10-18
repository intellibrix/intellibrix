import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import fg from 'fast-glob'
import ignore from 'ignore'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'
import { resolveJailed } from './jail.js'

const MAX_READ_BYTES = 256 * 1024
const MAX_RESULTS = 500

export type FsToolOptions = {
  root: string
  /** Require approval for `write_file`/`edit_file`. @default true */
  approveWrites?: boolean
}

async function gitignoreFilter(root: string) {
  const ig = ignore().add(['.git', 'node_modules'])
  try {
    ig.add(await readFile(path.join(root, '.gitignore'), 'utf8'))
  } catch {}
  return ig
}

/** Jailed read tools (`read_file`, `list_dir`, `glob`, `grep`) and write tools (`write_file`, `edit_file`). */
export function fsTools({ root, approveWrites = true }: FsToolOptions): ToolDefinition[] {
  const read_file = defineTool({
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace.',
    input: z.object({ path: z.string() }),
    resultTrust: 'untrusted',
    execute: async ({ path: p }) => {
      const file = await resolveJailed(root, p)
      const info = await stat(file)
      if (info.size > MAX_READ_BYTES) {
        throw new Error(`File is ${info.size} bytes; the limit is ${MAX_READ_BYTES}`)
      }
      return { path: p, content: await readFile(file, 'utf8') }
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
      const files: string[] = await fg(pattern, {
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
      const found: string[] = await fg(input.glob ?? '**/*', {
        cwd: realRoot,
        dot: true,
        followSymbolicLinks: false,
      })
      const files = found.filter((f) => !ig.ignores(f)).sort()
      const matches: { file: string; line: number; text: string }[] = []
      for (const file of files) {
        let lines: string[]
        try {
          const full = await resolveJailed(realRoot, file)
          if ((await stat(full)).size > MAX_READ_BYTES) continue
          lines = (await readFile(full, 'utf8')).split('\n')
        } catch {
          continue // symlink escaping the jail, unreadable, or a directory
        }
        for (const [i, text] of lines.entries()) {
          if (re.test(text)) matches.push({ file, line: i + 1, text: text.slice(0, 300) })
          if (matches.length >= MAX_RESULTS) return matches
        }
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
      await mkdir(path.dirname(file), { recursive: true })
      // Re-resolve after mkdir so a symlinked parent created in between cannot redirect the write.
      await writeFile(await resolveJailed(root, p), content, 'utf8')
      return { path: p, bytes: Buffer.byteLength(content) }
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
      const content = await readFile(file, 'utf8')
      const count = content.split(oldString).length - 1
      if (count !== 1) throw new Error(`oldString must match exactly once; found ${count} matches`)
      await writeFile(
        file,
        content.replace(oldString, () => newString),
        'utf8',
      )
      return { path: p, replaced: 1 }
    },
  })

  return [read_file, list_dir, glob, grep, write_file, edit_file]
}
