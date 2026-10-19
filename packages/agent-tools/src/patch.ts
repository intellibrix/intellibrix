import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { type FileTracker, resolveJailed } from '@intellibrix/workspace'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const MAX_PATCH_BYTES = 1024 * 1024

type Hunk = {
  /** 0-based line the hunk claims to start at in the old file, when the header said so. */
  start?: number
  oldLines: string[]
  newLines: string[]
  /** `\ No newline at end of file` followed a line of the old / new side. */
  noNewlineOld: boolean
  noNewlineNew: boolean
}

type FilePatch = {
  oldPath?: string
  newPath?: string
  hunks: Hunk[]
}

/** What a patch did (or would do) to one file. */
export type PatchedFile = {
  path: string
  action: 'create' | 'modify' | 'delete' | 'rename'
  /** The previous path, for a rename. */
  from?: string
  hunks: number
  added: number
  removed: number
}

const HEADER = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/

function cleanPath(raw: string): string | undefined {
  const p = raw.split('\t')[0]?.trim().replace(/^"|"$/g, '')
  return !p || p === '/dev/null' ? undefined : p
}

/** Parses a unified diff, tolerating `diff --git` headers and wrong hunk line counts. */
export function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  const files: FilePatch[] = []
  let file: FilePatch | undefined
  let hunk: Hunk | undefined
  let last: ' ' | '+' | '-' | undefined

  const startsFileHeader = (i: number) =>
    lines[i]?.startsWith('--- ') === true && lines[i + 1]?.startsWith('+++ ') === true

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (line.startsWith('diff --git ') || line.startsWith('diff ')) {
      hunk = undefined
      file = undefined
      continue
    }
    if (startsFileHeader(i)) {
      file = {
        oldPath: cleanPath(line.slice(4)),
        newPath: cleanPath((lines[i + 1] as string).slice(4)),
        hunks: [],
      }
      files.push(file)
      hunk = undefined
      i++
      continue
    }
    const header = HEADER.exec(line)
    if (line.startsWith('@@')) {
      if (!file) throw new Error('Patch has a hunk before any "---"/"+++" file header')
      hunk = {
        start: header ? Math.max(0, Number(header[1]) - 1) : undefined,
        oldLines: [],
        newLines: [],
        noNewlineOld: false,
        noNewlineNew: false,
      }
      file.hunks.push(hunk)
      last = undefined
      continue
    }
    if (!hunk) continue
    if (line.startsWith('\\')) {
      if (last === '-' || last === ' ') hunk.noNewlineOld = true
      if (last === '+' || last === ' ') hunk.noNewlineNew = true
      continue
    }
    const tag = line[0]
    if (tag === '+') {
      hunk.newLines.push(line.slice(1))
      last = '+'
    } else if (tag === '-') {
      hunk.oldLines.push(line.slice(1))
      last = '-'
    } else if (tag === ' ' || line === '') {
      // Models often strip the single space off a blank context line.
      if (line === '' && i === lines.length - 1) continue // the final newline
      hunk.oldLines.push(line.slice(1))
      hunk.newLines.push(line.slice(1))
      last = ' '
    } else {
      throw new Error(`Unexpected line in hunk: ${JSON.stringify(line.slice(0, 80))}`)
    }
  }
  return files.filter((f) => f.hunks.length > 0 || f.oldPath !== f.newPath)
}

type TextFile = { lines: string[]; eol: string; finalNewline: boolean }

function toTextFile(text: string): TextFile {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const finalNewline = lines.at(-1) === ''
  if (finalNewline) lines.pop()
  return { lines, eol, finalNewline }
}

function fromTextFile({ lines, eol, finalNewline }: TextFile): string {
  return lines.length === 0 ? '' : lines.join(eol) + (finalNewline ? eol : '')
}

function matchesAt(lines: string[], at: number, want: string[], loose: boolean): boolean {
  if (at < 0 || at + want.length > lines.length) return false
  for (let i = 0; i < want.length; i++) {
    const a = lines[at + i] as string
    const b = want[i] as string
    if (loose ? a.trimEnd() !== b.trimEnd() : a !== b) return false
  }
  return true
}

/** The index nearest `expected` (and not before `from`) where `want` matches `lines`. */
function locate(lines: string[], want: string[], expected: number, from: number): number {
  const max = lines.length - want.length
  for (const loose of [false, true]) {
    for (let d = 0; d <= Math.max(expected - from, max - expected, 0); d++) {
      for (const at of d === 0 ? [expected] : [expected - d, expected + d]) {
        if (at >= from && at <= max && matchesAt(lines, at, want, loose)) return at
      }
    }
  }
  return -1
}

function applyHunks(file: TextFile, hunks: Hunk[], label: string): void {
  let from = 0
  let delta = 0
  hunks.forEach((hunk, n) => {
    const expected =
      hunk.start === undefined
        ? hunk.oldLines.length === 0
          ? file.lines.length
          : from
        : hunk.start + delta
    let at: number
    if (hunk.oldLines.length === 0) {
      at = Math.min(Math.max(expected, from), file.lines.length)
    } else {
      at = locate(file.lines, hunk.oldLines, Math.max(expected, 0), from)
      if (at < 0) {
        const first = hunk.oldLines.find((l) => l.trim() !== '') ?? hunk.oldLines[0] ?? ''
        throw new Error(
          `Hunk ${n + 1} of ${label} does not apply: the context/removed lines were not found (starting with ${JSON.stringify(first.slice(0, 80))}). Re-read the file and regenerate the patch.`,
        )
      }
    }
    file.lines.splice(at, hunk.oldLines.length, ...hunk.newLines)
    delta += hunk.newLines.length - hunk.oldLines.length
    from = at + hunk.newLines.length
    if (at + hunk.newLines.length >= file.lines.length) {
      if (hunk.noNewlineNew) file.finalNewline = false
      else if (hunk.noNewlineOld) file.finalNewline = true
    }
  })
}

/** Counts real additions/removals, ignoring context lines carried on both sides. */
function countChanges(hunks: Hunk[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const h of hunks) {
    // Context lines appear in both arrays at the same positions; trim the common prefix/suffix.
    let pre = 0
    while (pre < h.oldLines.length && h.oldLines[pre] === h.newLines[pre]) pre++
    let suf = 0
    while (
      suf < h.oldLines.length - pre &&
      suf < h.newLines.length - pre &&
      h.oldLines[h.oldLines.length - 1 - suf] === h.newLines[h.newLines.length - 1 - suf]
    )
      suf++
    removed += h.oldLines.length - pre - suf
    added += h.newLines.length - pre - suf
  }
  return { added, removed }
}

/** Strips git's `a/` and `b/` prefixes when both sides carry them. */
function stripGitPrefixes(files: FilePatch[]): void {
  for (const f of files) {
    const a = f.oldPath?.startsWith('a/')
    const b = f.newPath?.startsWith('b/')
    if ((a || f.oldPath === undefined) && (b || f.newPath === undefined) && (a || b)) {
      if (f.oldPath && a) f.oldPath = f.oldPath.slice(2)
      if (f.newPath && b) f.newPath = f.newPath.slice(2)
    }
  }
}

export type ApplyPatchOptions = {
  root: string
  /** Require approval before the patch is written. @default true */
  approveWrites?: boolean
  /**
   * Refuse to change or delete an existing file the model has not read, or that changed since it
   * did. Share it with `workspaceTools` so reads there count.
   */
  tracker?: FileTracker
}

/**
 * An `apply_patch` tool that applies a unified diff to files inside the workspace, atomically:
 * every hunk of every file is applied in memory first, and nothing is written unless all of them
 * apply. Line numbers in hunk headers are treated as hints (models get them wrong), so each hunk
 * is located by its context. Pass `check: true` to validate without writing.
 */
export function applyPatchTool(options: ApplyPatchOptions): ToolDefinition {
  const { root, approveWrites = true, tracker } = options
  return defineTool({
    name: 'apply_patch',
    description:
      'Apply a unified diff (---/+++ headers and @@ hunks) to one or more files in the workspace, all or nothing. Use `--- /dev/null` to create a file and `+++ /dev/null` to delete one. Hunks are located by their context lines, so include 2-3 unchanged lines around each change. Set check to true to validate without writing.',
    input: z.object({ patch: z.string().min(1), check: z.boolean().default(false) }),
    needsApproval: approveWrites,
    execute: async ({ patch, check }) => {
      if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error('Patch is too large')
      const filePatches = parseUnifiedDiff(patch)
      if (filePatches.length === 0) throw new Error('No file changes found in the patch')
      stripGitPrefixes(filePatches)

      type Plan = { file: string; before?: string; after?: string }
      const plans: Plan[] = []
      const summary: PatchedFile[] = []
      const seen = new Set<string>()
      const claim = (p: string) => {
        if (seen.has(p)) throw new Error(`Patch touches ${p} more than once`)
        seen.add(p)
      }

      for (const fp of filePatches) {
        const target = fp.newPath ?? fp.oldPath
        if (!target) throw new Error('Patch has a file header with no path')
        const label = fp.newPath ?? (fp.oldPath as string)

        if (fp.newPath === undefined) {
          // Deletion.
          const oldPath = fp.oldPath as string
          claim(oldPath)
          const file = await resolveJailed(root, oldPath)
          const before = await readFile(file, 'utf8').catch(() => {
            throw new Error(`Cannot delete ${oldPath}: it does not exist`)
          })
          tracker?.assertFresh(file, before, oldPath)
          const tf = toTextFile(before)
          applyHunks(tf, fp.hunks, oldPath)
          if (tf.lines.length > 0) {
            throw new Error(`Cannot delete ${oldPath}: the patch does not remove every line`)
          }
          plans.push({ file, before })
          summary.push({
            path: oldPath,
            action: 'delete',
            hunks: fp.hunks.length,
            ...countChanges(fp.hunks),
          })
          continue
        }

        const creating = fp.oldPath === undefined
        const renaming = !creating && fp.oldPath !== fp.newPath
        const sourcePath = (creating ? undefined : fp.oldPath) as string | undefined
        claim(fp.newPath)
        const dest = await resolveJailed(root, fp.newPath)

        let before: string | undefined
        if (sourcePath) {
          const src = await resolveJailed(root, sourcePath)
          before = await readFile(src, 'utf8').catch(() => {
            throw new Error(`Cannot patch ${sourcePath}: it does not exist`)
          })
          tracker?.assertFresh(src, before, sourcePath)
        } else if (
          await readFile(dest).then(
            () => true,
            () => false,
          )
        ) {
          throw new Error(`Cannot create ${fp.newPath}: it already exists`)
        }

        const tf = toTextFile(before ?? '')
        if (creating) tf.finalNewline = true
        applyHunks(tf, fp.hunks, label)
        const after = fromTextFile(tf)

        if (renaming && sourcePath) {
          claim(sourcePath)
          plans.push({ file: await resolveJailed(root, sourcePath), before })
        }
        plans.push({ file: dest, before: renaming ? undefined : before, after })
        summary.push({
          path: fp.newPath,
          action: creating ? 'create' : renaming ? 'rename' : 'modify',
          ...(renaming && sourcePath ? { from: sourcePath } : {}),
          hunks: fp.hunks.length,
          ...countChanges(fp.hunks),
        })
      }

      if (check) return { applied: false, checked: true, files: summary }

      const done: Plan[] = []
      try {
        for (const plan of plans) {
          if (plan.after === undefined) {
            await rm(plan.file, { force: true })
          } else {
            await mkdir(path.dirname(plan.file), { recursive: true })
            // Re-resolve after mkdir so a symlinked parent created in between cannot redirect the write.
            await writeFile(await resolveJailed(root, plan.file), plan.after)
          }
          done.push(plan)
        }
        for (const plan of plans) {
          if (plan.after === undefined) tracker?.recordDelete(plan.file)
          else tracker?.recordWrite(plan.file, plan.after)
        }
      } catch (error) {
        // Roll back whatever was written so a failure never leaves a half-applied patch.
        for (const plan of done.reverse()) {
          if (plan.before === undefined) await rm(plan.file, { force: true }).catch(() => {})
          else await writeFile(plan.file, plan.before).catch(() => {})
        }
        throw error
      }
      return { applied: true, files: summary }
    },
  })
}
