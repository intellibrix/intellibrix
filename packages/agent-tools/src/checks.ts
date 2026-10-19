import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveJailed } from '@intellibrix/workspace'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

const MAX_FAILURES = 50
const MAX_OUTPUT = 6 * 1024
const MAX_BUFFER = 8 * 1024 * 1024

/** One problem pulled out of a check's output. */
export type CheckFailure = {
  file?: string
  line?: number
  column?: number
  message: string
}

/** Turns a check's (color-stripped) output into structured failures. */
export type FailureParser = (output: string) => CheckFailure[]

/** A command the model may run through `run_checks`. */
export type CheckSpec = {
  command: string
  args?: string[]
  /** Working directory relative to the workspace root. */
  cwd?: string
  /** Kill the command after this many ms. @default 300000 */
  timeoutMs?: number
  /** How to extract failures. `'auto'` tries every built-in parser. @default 'auto' */
  parse?: 'auto' | 'tsc' | 'generic' | 'vitest' | FailureParser
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const TSC_PAREN = /^(.+?)\((\d+),(\d+)\):\s*(?:error|warning)\s+(TS\d+):\s*(.+)$/
const TSC_PRETTY = /^(.+?):(\d+):(\d+)\s+-\s+(?:error|warning)\s+(TS\d+):\s*(.+)$/
const GENERIC = /^\s*(?:\.\/)?([^\s:()<>"']+\.\w+):(\d+):(\d+):?\s+(.+)$/
const VITEST_FAIL = /^\s*(?:FAIL|×|✗)\s+(\S+\.[cm]?[jt]sx?)(?:\s+>\s+(.+))?$/

const fromLine = (
  line: string,
  re: RegExp,
  pick: (m: RegExpExecArray) => CheckFailure,
): CheckFailure | undefined => {
  const m = re.exec(line)
  return m ? pick(m) : undefined
}

const PARSERS: Record<'tsc' | 'generic' | 'vitest', FailureParser> = {
  tsc: (output) =>
    output.split('\n').flatMap((line) => {
      const f =
        fromLine(line, TSC_PAREN, (m) => ({
          file: m[1],
          line: Number(m[2]),
          column: Number(m[3]),
          message: `${m[4]}: ${m[5]}`,
        })) ??
        fromLine(line, TSC_PRETTY, (m) => ({
          file: m[1],
          line: Number(m[2]),
          column: Number(m[3]),
          message: `${m[4]}: ${m[5]}`,
        }))
      return f ? [f] : []
    }),
  generic: (output) =>
    output.split('\n').flatMap((line) => {
      const f = fromLine(line, GENERIC, (m) => ({
        file: m[1],
        line: Number(m[2]),
        column: Number(m[3]),
        message: (m[4] as string).trim(),
      }))
      return f ? [f] : []
    }),
  vitest: (output) =>
    output.split('\n').flatMap((line) => {
      const f = fromLine(line, VITEST_FAIL, (m) => ({
        file: m[1],
        message: m[2] ? `test failed: ${m[2]}` : 'test file failed',
      }))
      return f ? [f] : []
    }),
}

function parseFailures(spec: CheckSpec, output: string): CheckFailure[] {
  const parse = spec.parse ?? 'auto'
  const found =
    typeof parse === 'function'
      ? parse(output)
      : parse === 'auto'
        ? // First matching parser wins per line, so tsc's pretty output isn't re-read as generic.
          output
            .split('\n')
            .flatMap(
              (line) =>
                [PARSERS.tsc, PARSERS.vitest, PARSERS.generic]
                  .map((p) => p(line))
                  .find((f) => f.length > 0) ?? [],
            )
        : PARSERS[parse](output)
  const seen = new Set<string>()
  return found
    .filter((f) => {
      const key = `${f.file}:${f.line}:${f.column}:${f.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_FAILURES)
}

/** The outcome of one named check. */
export type CheckResult = {
  name: string
  ok: boolean
  exitCode: number
  timedOut: boolean
  durationMs: number
  failures: CheckFailure[]
  /** The tail of the output; empty when the check passed. */
  output: string
}

async function runCheck(
  root: string,
  name: string,
  spec: CheckSpec,
  signal?: AbortSignal,
): Promise<CheckResult> {
  const cwd = await resolveJailed(root, spec.cwd ?? '.')
  const started = Date.now()
  return new Promise((resolve) => {
    execFile(
      spec.command,
      spec.args ?? [],
      {
        cwd,
        timeout: spec.timeoutMs ?? 300_000,
        signal,
        maxBuffer: MAX_BUFFER,
        // CI=1 keeps test runners out of watch mode; colors would break the parsers.
        env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
      },
      (error, stdout, stderr) => {
        const e = error as
          | (NodeJS.ErrnoException & { killed?: boolean; code?: number | string })
          | null
        const spawnFailed =
          e && typeof e.code === 'string' && e.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        const output = spawnFailed
          ? e.message
          : `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`.replace(ANSI, '')
        const exitCode = spawnFailed ? -1 : e ? (typeof e.code === 'number' ? e.code : 1) : 0
        const ok = exitCode === 0
        resolve({
          name,
          ok,
          exitCode,
          timedOut: Boolean(e?.killed) && !spawnFailed,
          durationMs: Date.now() - started,
          failures: ok ? [] : parseFailures(spec, output),
          output: ok ? '' : output.slice(-MAX_OUTPUT),
        })
      },
    )
  })
}

type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun'

async function exists(file: string): Promise<boolean> {
  return readFile(file).then(
    () => true,
    () => false,
  )
}

/**
 * Infers checks from `package.json` scripts: `test`, `typecheck` (or `type-check`/`tsc`), `lint`
 * and `build`, run with the package manager that owns the lockfile. Returns `{}` when there is no
 * `package.json`.
 */
export async function detectChecks(root: string): Promise<Record<string, CheckSpec>> {
  const dir = await resolveJailed(root, '.')
  let scripts: Record<string, unknown>
  try {
    scripts = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).scripts ?? {}
  } catch {
    return {}
  }
  const manager: PackageManager = (await exists(path.join(dir, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await exists(path.join(dir, 'yarn.lock')))
      ? 'yarn'
      : (await exists(path.join(dir, 'bun.lock'))) || (await exists(path.join(dir, 'bun.lockb')))
        ? 'bun'
        : 'npm'

  const checks: Record<string, CheckSpec> = {}
  const add = (name: string, candidates: string[], parse?: CheckSpec['parse']) => {
    const script = candidates.find((c) => typeof scripts[c] === 'string')
    if (script) checks[name] = { command: manager, args: ['run', script], parse }
  }
  add('test', ['test'])
  add('typecheck', ['typecheck', 'type-check', 'tsc'], 'tsc')
  add('lint', ['lint'])
  add('build', ['build'])
  return checks
}

export type RunChecksOptions = {
  root: string
  /** Named checks the model may run. Omit to detect them from `package.json` on each call. */
  checks?: Record<string, CheckSpec>
  /** Skip the approval prompt (CI / non-interactive use). Checks run project code. @default false */
  alwaysApprove?: boolean
}

/**
 * A `run_checks` tool that runs named, developer-defined commands (tests, typecheck, lint, build)
 * and returns structured results (pass/fail, exit code, parsed file/line failures) instead of raw
 * terminal output, so a model can drive an edit, check, fix loop. The model picks check names,
 * never command lines. Commands run via `execFile`, never through a shell.
 */
export function runChecksTool(options: RunChecksOptions): ToolDefinition {
  const { root } = options
  const configured = options.checks
  return defineTool({
    name: 'run_checks',
    description: `Run the project's checks (${configured ? Object.keys(configured).join(', ') : 'test, typecheck, lint, build, as defined in package.json'}) and get back pass/fail with parsed failures (file, line, message). Omit checks to run all of them.`,
    input: z.object({ checks: z.array(z.string()).optional() }),
    needsApproval: !options.alwaysApprove,
    resultTrust: 'untrusted',
    execute: async ({ checks: wanted }, ctx) => {
      const available = configured ?? (await detectChecks(root))
      const names = Object.keys(available)
      if (names.length === 0) throw new Error('No checks are configured for this workspace')
      const unknown = (wanted ?? []).filter((n) => !(n in available))
      if (unknown.length > 0) {
        throw new Error(`Unknown check: ${unknown.join(', ')}. Available: ${names.join(', ')}`)
      }
      const results: CheckResult[] = []
      for (const name of wanted?.length ? wanted : names) {
        results.push(await runCheck(root, name, available[name] as CheckSpec, ctx.signal))
      }
      return { ok: results.every((r) => r.ok), results }
    },
  })
}
