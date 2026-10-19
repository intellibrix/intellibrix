import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RunCodeResult, Sandbox, SandboxProvider } from '../provider.js'

const MAX_OUTPUT = 64 * 1024

/** The result of one container CLI invocation. */
export type ContainerExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
}

/**
 * Runs the container CLI. The default spawns the binary directly (never through a shell);
 * override it to test, to run the CLI over SSH, or to log every command.
 */
export type ContainerExec = (
  bin: string,
  args: string[],
  options?: { input?: string; timeoutMs?: number; signal?: AbortSignal },
) => Promise<ContainerExecResult>

/** A directory shared from the host into the container. */
export type ContainerMount = {
  /** Absolute path on the host. */
  host: string
  /** Absolute path inside the container. */
  container: string
  /** @default true */
  readOnly?: boolean
}

export type ContainerProviderOptions = {
  /** Container CLI to use. `'auto'` picks Podman, then Docker. @default 'auto' */
  runtime?: 'docker' | 'podman' | 'auto'
  /** Image to run. Must contain the interpreters for the languages you allow. Also overridable per tool with `template`. @default 'python:3.13-slim' */
  image?: string
  /** Language used when the model does not name one. @default 'python' */
  defaultLanguage?: string
  /** Extra or replacement languages, each as the argv that runs code read from stdin. */
  languages?: Record<string, string[]>
  /** `'none'` gives the code no network. @default 'none' */
  network?: 'none' | 'bridge'
  /** Memory limit, e.g. `'512m'`. @default '512m' */
  memory?: string
  /** CPU limit, e.g. `'1'`. @default '1' */
  cpus?: string
  /** Maximum number of processes. @default 256 */
  pidsLimit?: number
  /** Mount the root filesystem read-only (`/tmp` and the workdir stay writable). @default false */
  readOnlyRoot?: boolean
  /** Directories to share with the container. Read-only unless you say otherwise. */
  mounts?: ContainerMount[]
  /** Environment variables for the code. Do not put secrets here: the model can print them. */
  env?: Record<string, string>
  /** Working directory inside the container. @default '/workspace' */
  workdir?: string
  /** User to run as, e.g. `'1000:1000'`. Defaults to the image's user. */
  user?: string
  /** Kill a single `runCode` after this long. @default 60000 */
  runTimeoutMs?: number
  /** Replaces the process spawner. */
  exec?: ContainerExec
}

const DEFAULT_LANGUAGES: Record<string, string[]> = {
  python: ['python3', '-'],
  python3: ['python3', '-'],
  javascript: ['node', '-'],
  js: ['node', '-'],
  node: ['node', '-'],
  bash: ['bash', '-s'],
  sh: ['sh', '-s'],
  shell: ['sh', '-s'],
}

const IMAGE = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/

const spawnExec: ContainerExec = (bin, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: options.signal,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const keep = (current: string, chunk: Buffer) =>
      current.length >= MAX_OUTPUT
        ? current
        : (current + chunk.toString('utf8')).slice(0, MAX_OUTPUT)
    child.stdout.on('data', (c: Buffer) => {
      stdout = keep(stdout, c)
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr = keep(stderr, c)
    })
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : undefined
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ stdout, stderr: error.message, exitCode: -1, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : (code ?? 1), timedOut })
    })
    child.stdin.on('error', () => {}) // the process may exit before reading its input
    child.stdin.end(options.input ?? '')
  })

async function pickRuntime(
  choice: 'docker' | 'podman' | 'auto',
  exec: ContainerExec,
): Promise<string> {
  const candidates = choice === 'auto' ? ['podman', 'docker'] : [choice]
  for (const bin of candidates) {
    if ((await exec(bin, ['--version'], { timeoutMs: 10_000 })).exitCode === 0) return bin
  }
  throw new Error(
    `containerProvider could not find ${choice === 'auto' ? 'Podman or Docker' : choice} on PATH. Install one, or pass runtime explicitly.`,
  )
}

/**
 * Runs code in a local [Podman](https://podman.io) or [Docker](https://docker.com) container, so
 * nothing leaves the machine and no account is needed.
 *
 * Each sandbox is one long-lived container (so files persist between calls in a run), started with
 * no network, dropped capabilities, `no-new-privileges`, and memory, CPU and process limits. Code
 * is piped to the interpreter over stdin, never interpolated into a command line. A call that
 * exceeds `runTimeoutMs` has its processes killed; files in the workdir survive.
 *
 * The container is a strong boundary, but it is on your machine: mount only what the code needs,
 * keep secrets out of `env`, and leave `network` at `'none'` unless the task requires more.
 */
export function containerProvider(options: ContainerProviderOptions = {}): SandboxProvider {
  const exec = options.exec ?? spawnExec
  const languages = { ...DEFAULT_LANGUAGES, ...options.languages }
  const workdir = options.workdir ?? '/workspace'
  const runTimeoutMs = options.runTimeoutMs ?? 60_000
  let runtime: Promise<string> | undefined

  return {
    id: 'container',
    async create(opts) {
      const image = opts?.template ?? options.image ?? 'python:3.13-slim'
      if (!IMAGE.test(image)) throw new Error(`Invalid container image name: ${image}`)
      for (const m of options.mounts ?? []) {
        if (!path.isAbsolute(m.host) || !path.posix.isAbsolute(m.container)) {
          throw new Error('Container mounts need absolute host and container paths')
        }
        if (/[:,]/.test(m.host + m.container)) {
          throw new Error('Container mount paths cannot contain ":" or ","')
        }
      }

      runtime ??= pickRuntime(options.runtime ?? 'auto', exec)
      const bin = await runtime.catch((error) => {
        runtime = undefined
        throw error
      })
      const name = `intellibrix-${randomUUID().slice(0, 12)}`

      const args = [
        'run',
        '--detach',
        '--rm',
        '--name',
        name,
        '--label',
        'intellibrix.sandbox=1',
        '--network',
        options.network ?? 'none',
        '--memory',
        options.memory ?? '512m',
        '--cpus',
        options.cpus ?? '1',
        '--pids-limit',
        String(options.pidsLimit ?? 256),
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--workdir',
        workdir,
        '--tmpfs',
        '/tmp',
      ]
      if (options.readOnlyRoot) args.push('--read-only', '--tmpfs', workdir)
      else args.push('--tmpfs', workdir)
      if (options.user) args.push('--user', options.user)
      for (const [k, v] of Object.entries(options.env ?? {})) args.push('--env', `${k}=${v}`)
      for (const m of options.mounts ?? []) {
        args.push('--volume', `${m.host}:${m.container}:${m.readOnly === false ? 'rw' : 'ro'}`)
      }
      // PID 1 just idles; code runs through `exec`.
      args.push(image, 'tail', '-f', '/dev/null')

      const started = await exec(bin, args)
      if (started.exitCode !== 0) {
        throw new Error(
          `Could not start a ${bin} container from ${image}: ${started.stderr.trim() || `exit ${started.exitCode}`}`,
        )
      }

      const remove = () => exec(bin, ['rm', '--force', name], { timeoutMs: 30_000 })
      let lifetime: NodeJS.Timeout | undefined
      if (opts?.timeoutMs) {
        lifetime = setTimeout(() => void remove().catch(() => {}), opts.timeoutMs)
        lifetime.unref()
      }

      const sandbox: Sandbox = {
        async runCode(code, runOpts): Promise<RunCodeResult> {
          const language = (runOpts?.language ?? options.defaultLanguage ?? 'python').toLowerCase()
          const argv = languages[language]
          if (!argv) {
            throw new Error(
              `Unsupported language "${language}". Supported: ${Object.keys(languages).join(', ')}`,
            )
          }
          const result = await exec(
            bin,
            ['exec', '--interactive', '--workdir', workdir, name, ...argv],
            {
              input: code,
              timeoutMs: runTimeoutMs,
            },
          )
          if (result.timedOut) {
            // Killing the CLI client leaves the code running inside; kill it there, keeping files.
            const killed = await exec(bin, ['exec', name, 'sh', '-c', 'kill -9 -1'], {
              timeoutMs: 30_000,
            })
            // No `sh` in the image: restart instead (this clears the in-memory workdir).
            if (killed.exitCode !== 0 && killed.exitCode !== 137) {
              await exec(bin, ['restart', '--time', '0', name], { timeoutMs: 30_000 })
            }
            return {
              stdout: result.stdout,
              stderr:
                `${result.stderr}\nTimed out after ${runTimeoutMs}ms; running processes were killed.`.trim(),
              exitCode: 124,
            }
          }
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
        },
        async close() {
          clearTimeout(lifetime)
          await remove()
        },
      }
      return sandbox
    },
  }
}
