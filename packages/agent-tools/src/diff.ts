import { readTextFile, resolveJailed } from '@intellibrix/workspace'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const MAX_LINES = 50_000
/** Edit-distance cap for Myers' search; past it the differing middle is shown as a replacement. */
const MAX_EDITS = 1500
/** Marks a last line with no trailing newline, so it never equals the same text with one. */
const NO_EOL = '\n\\'

function toLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  else lines[lines.length - 1] += NO_EOL
  return lines
}

type Op = { kind: ' ' | '-' | '+'; line: string }

/** Shortest edit script from `a` to `b` (Myers 1986), or `undefined` if it takes over MAX_EDITS edits. */
function myers(a: string[], b: string[]): Op[] | undefined {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDITS)
  const trace: Int32Array[] = []
  const v = new Int32Array(2 * max + 2)
  const off = max
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))) {
        x = v[off + k + 1] as number
      } else {
        x = (v[off + k - 1] as number) + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[off + k] = x
      if (x >= n && y >= m) {
        // Walk the trace backwards, from the end, to recover the edits.
        const ops: Op[] = []
        let px = n
        let py = m
        for (let dd = d; dd >= 0; dd--) {
          const prev = trace[dd] as Int32Array
          const kk = px - py
          const prevK =
            kk === -dd ||
            (kk !== dd && (prev[off + kk - 1] as number) < (prev[off + kk + 1] as number))
              ? kk + 1
              : kk - 1
          const prevX = prev[off + prevK] as number
          const prevY = prevX - prevK
          while (px > prevX && py > prevY) {
            ops.push({ kind: ' ', line: a[px - 1] as string })
            px--
            py--
          }
          if (dd > 0) {
            if (px === prevX) ops.push({ kind: '+', line: b[prevY] as string })
            else ops.push({ kind: '-', line: a[prevX] as string })
          }
          px = prevX
          py = prevY
        }
        return ops.reverse()
      }
    }
  }
  return undefined
}

function script(a: string[], b: string[]): { ops: Op[]; approximate: boolean } {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const found = midA.length === 0 || midB.length === 0 ? undefined : myers(midA, midB)
  const middle: Op[] = found ?? [
    ...midA.map((line): Op => ({ kind: '-', line })),
    ...midB.map((line): Op => ({ kind: '+', line })),
  ]
  return {
    ops: [
      ...a.slice(0, start).map((line): Op => ({ kind: ' ', line })),
      ...middle,
      ...a.slice(endA).map((line): Op => ({ kind: ' ', line })),
    ],
    approximate: found === undefined && midA.length > 0 && midB.length > 0,
  }
}

export type UnifiedDiff = {
  /** The diff in unified format, empty when the texts are equal. */
  patch: string
  identical: boolean
  added: number
  removed: number
  /** True when the texts differed too much for a minimal diff, so the changed region is shown whole. */
  approximate: boolean
}

/**
 * A unified diff from `before` to `after`, with `context` lines around each change. The output
 * applies with `patch -p1` or `apply_patch`; a missing final newline is marked the usual way.
 */
export function createUnifiedDiff(
  before: string,
  after: string,
  options: { beforeName?: string; afterName?: string; context?: number } = {},
): UnifiedDiff {
  const context = options.context ?? 3
  const { ops, approximate } = script(toLines(before), toLines(after))
  const added = ops.filter((o) => o.kind === '+').length
  const removed = ops.filter((o) => o.kind === '-').length
  if (added === 0 && removed === 0) {
    return { patch: '', identical: true, added, removed, approximate: false }
  }

  // Positions in each file before every op, to number the hunks.
  const pos = ops.map(() => ({ a: 0, b: 0 }))
  let a = 0
  let b = 0
  ops.forEach((op, i) => {
    pos[i] = { a, b }
    if (op.kind !== '+') a++
    if (op.kind !== '-') b++
  })

  const changed = ops.flatMap((op, i) => (op.kind === ' ' ? [] : [i]))
  const hunks: { from: number; to: number }[] = []
  for (const i of changed) {
    const from = Math.max(0, i - context)
    const to = Math.min(ops.length, i + context + 1)
    const last = hunks[hunks.length - 1]
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else hunks.push({ from, to })
  }

  const out = [`--- ${options.beforeName ?? 'a'}`, `+++ ${options.afterName ?? 'b'}`]
  for (const h of hunks) {
    const slice = ops.slice(h.from, h.to)
    const countA = slice.filter((o) => o.kind !== '+').length
    const countB = slice.filter((o) => o.kind !== '-').length
    const startA =
      countA === 0 ? (pos[h.from] as { a: number }).a : (pos[h.from] as { a: number }).a + 1
    const startB =
      countB === 0 ? (pos[h.from] as { b: number }).b : (pos[h.from] as { b: number }).b + 1
    out.push(
      `@@ -${startA}${countA === 1 ? '' : `,${countA}`} +${startB}${countB === 1 ? '' : `,${countB}`} @@`,
    )
    for (const op of slice) {
      const noEol = op.line.endsWith(NO_EOL)
      out.push(op.kind + (noEol ? op.line.slice(0, -NO_EOL.length) : op.line))
      if (noEol) out.push('\\ No newline at end of file')
    }
  }
  return { patch: `${out.join('\n')}\n`, identical: false, added, removed, approximate }
}

export type DiffToolOptions = {
  root: string
  /** Largest file to compare, in bytes. @default 2097152 */
  maxBytes?: number
}

const side = z
  .object({ path: z.string().optional(), text: z.string().optional() })
  .describe('A file in the workspace (path) or literal text (text); give exactly one')

/**
 * A `diff` tool that compares two files in the workspace, or two pieces of text, and returns a
 * unified diff: for "what changed between these two versions?" when git has no answer, such as
 * a generated file against its backup, or a file against the text the model plans to write.
 */
export function diffTool(options: DiffToolOptions): ToolDefinition {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const load = async (s: { path?: string; text?: string }, which: string) => {
    if ((s.path === undefined) === (s.text === undefined)) {
      throw new Error(`${which} needs exactly one of path or text`)
    }
    if (s.text !== undefined) return { name: which, text: s.text }
    const file = await resolveJailed(options.root, s.path as string)
    const { size, text } = await readTextFile(file, maxBytes)
    if (text === undefined) throw new Error(`${s.path} is ${size} bytes; the limit is ${maxBytes}`)
    if (text.includes('\u0000')) throw new Error(`${s.path} looks like a binary file`)
    return { name: s.path as string, text }
  }
  return defineTool({
    name: 'diff',
    description:
      'Compare two files, or two pieces of text, and get a unified diff of what changed from a to b. Each side is {path} for a workspace file or {text} for literal text. For changes tracked in git, use git_diff instead.',
    input: z.object({
      a: side,
      b: side,
      context: z.number().int().min(0).max(20).default(3),
      maxChars: z.number().int().min(100).max(200_000).default(20_000),
    }),
    resultTrust: 'untrusted',
    execute: async ({ a, b, context = 3, maxChars = 20_000 }) => {
      const [left, right] = await Promise.all([load(a, 'a'), load(b, 'b')])
      if (toLines(left.text).length > MAX_LINES || toLines(right.text).length > MAX_LINES) {
        throw new Error(`Each side may have at most ${MAX_LINES} lines`)
      }
      const d = createUnifiedDiff(left.text, right.text, {
        beforeName: `a/${left.name}`,
        afterName: `b/${right.name}`,
        context,
      })
      return {
        identical: d.identical,
        added: d.added,
        removed: d.removed,
        ...(d.approximate
          ? {
              note: 'The files differ too much for a minimal diff; the changed region is shown whole.',
            }
          : {}),
        patch: d.patch.slice(0, maxChars),
        truncated: d.patch.length > maxChars,
      }
    },
  })
}
