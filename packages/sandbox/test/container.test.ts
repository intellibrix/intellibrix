import { describe, expect, it } from 'vitest'
import {
  type ContainerExec,
  type ContainerExecResult,
  containerProvider,
  sandboxTool,
} from '../src/index.js'

const ok = (stdout = ''): ContainerExecResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
  timedOut: false,
})

/** A fake container CLI that records every call. */
function fake(
  respond: (args: string[], input?: string) => Partial<ContainerExecResult> = () => ({}),
) {
  const calls: { bin: string; args: string[]; input?: string }[] = []
  const exec: ContainerExec = async (bin, args, options) => {
    calls.push({ bin, args, input: options?.input })
    return { ...ok(), ...respond(args, options?.input) }
  }
  return { exec, calls }
}

describe('containerProvider', () => {
  it('starts a locked-down detached container and runs code over stdin', async () => {
    const { exec, calls } = fake((args) => (args[0] === 'exec' ? { stdout: '42\n' } : {}))
    const sbx = await containerProvider({ exec, runtime: 'docker' }).create()
    const r = await sbx.runCode('print(6*7)')
    expect(r).toEqual({ stdout: '42\n', stderr: '', exitCode: 0 })

    const run = calls.find((c) => c.args[0] === 'run')
    expect(run?.bin).toBe('docker')
    const args = run?.args ?? []
    for (const flag of ['--detach', '--rm', '--cap-drop', 'ALL', 'no-new-privileges', 'none']) {
      expect(args).toContain(flag)
    }
    expect(args.at(-4)).toBe('python:3.13-slim')
    expect(args.slice(-3)).toEqual(['tail', '-f', '/dev/null'])

    const execCall = calls.find((c) => c.args[0] === 'exec')
    expect(execCall?.input).toBe('print(6*7)')
    expect(execCall?.args.slice(-2)).toEqual(['python3', '-'])
    // The code is never part of the command line.
    expect(JSON.stringify(calls.map((c) => c.args))).not.toContain('print(6*7)')
  })

  it('maps languages, honors custom ones, and rejects unknown ones', async () => {
    const { exec, calls } = fake()
    const sbx = await containerProvider({
      exec,
      runtime: 'podman',
      languages: { ruby: ['ruby', '-'] },
    }).create()
    await sbx.runCode('1', { language: 'JavaScript' })
    await sbx.runCode('2', { language: 'ruby' })
    const execs = calls.filter((c) => c.args[0] === 'exec').map((c) => c.args.slice(-2))
    expect(execs).toEqual([
      ['node', '-'],
      ['ruby', '-'],
    ])
    await expect(sbx.runCode('x', { language: 'cobol' })).rejects.toThrow(
      /Unsupported language "cobol"/,
    )
  })

  it('applies options: image, network, limits, mounts, env, user', async () => {
    const { exec, calls } = fake()
    await containerProvider({
      exec,
      runtime: 'podman',
      image: 'node:22-slim',
      network: 'bridge',
      memory: '1g',
      cpus: '2',
      pidsLimit: 64,
      readOnlyRoot: true,
      user: '1000:1000',
      env: { A: 'b' },
      mounts: [
        { host: '/data', container: '/data' },
        { host: '/out', container: '/out', readOnly: false },
      ],
    }).create({ template: 'python:3.12' })
    const args = calls.find((c) => c.args[0] === 'run')?.args.join(' ') ?? ''
    expect(args).toContain('--network bridge')
    expect(args).toContain('--memory 1g')
    expect(args).toContain('--cpus 2')
    expect(args).toContain('--pids-limit 64')
    expect(args).toContain('--read-only')
    expect(args).toContain('--user 1000:1000')
    expect(args).toContain('--env A=b')
    expect(args).toContain('--volume /data:/data:ro')
    expect(args).toContain('--volume /out:/out:rw')
    expect(args).toContain('python:3.12 tail')
  })

  it('picks Podman before Docker, falls back, and explains when neither exists', async () => {
    const { exec, calls } = fake()
    await containerProvider({ exec }).create()
    expect(calls[0]).toMatchObject({ bin: 'podman', args: ['--version'] })

    const noPodman = fake(() => ({}))
    const exec2: ContainerExec = async (bin, args, o) =>
      bin === 'podman' ? { ...ok(), exitCode: -1 } : noPodman.exec(bin, args, o)
    await containerProvider({ exec: exec2 }).create()
    expect(noPodman.calls[0]?.bin).toBe('docker')

    const none: ContainerExec = async () => ({ ...ok(), exitCode: -1 })
    await expect(containerProvider({ exec: none }).create()).rejects.toThrow(/Podman or Docker/)
  })

  it('reports a failed start with the CLI error', async () => {
    const { exec } = fake((args) =>
      args[0] === 'run' ? { exitCode: 125, stderr: 'pull access denied' } : {},
    )
    await expect(containerProvider({ exec, runtime: 'docker' }).create()).rejects.toThrow(
      /Could not start a docker container.*pull access denied/,
    )
  })

  it('kills the timed-out code in place, and restarts only if it cannot', async () => {
    const { exec, calls } = fake((args) =>
      args[0] === 'exec'
        ? args.includes('sh')
          ? {}
          : { timedOut: true, exitCode: 124, stdout: 'partial' }
        : {},
    )
    const sbx = await containerProvider({ exec, runtime: 'docker', runTimeoutMs: 5 }).create()
    const r = await sbx.runCode('while True: pass')
    expect(r).toMatchObject({ exitCode: 124, stdout: 'partial' })
    expect(r.stderr).toMatch(/Timed out after 5ms/)
    expect(calls.some((c) => c.args.includes('kill -9 -1'))).toBe(true)
    expect(calls.some((c) => c.args[0] === 'restart')).toBe(false)

    const noSh = fake((args) =>
      args[0] === 'exec'
        ? args.includes('sh')
          ? { exitCode: 127 }
          : { timedOut: true, exitCode: 124 }
        : {},
    )
    const sbx2 = await containerProvider({ exec: noSh.exec, runtime: 'docker' }).create()
    await sbx2.runCode('x')
    expect(noSh.calls.some((c) => c.args[0] === 'restart')).toBe(true)
  })

  it('removes the container on close and rejects hostile names and mounts', async () => {
    const { exec, calls } = fake()
    const sbx = await containerProvider({ exec, runtime: 'docker' }).create()
    await sbx.close()
    const name = calls.find((c) => c.args[0] === 'run')?.args[
      (calls.find((c) => c.args[0] === 'run')?.args.indexOf('--name') as number) + 1
    ]
    expect(calls.at(-1)?.args).toEqual(['rm', '--force', name])

    await expect(
      containerProvider({ exec, runtime: 'docker' }).create({ template: '--privileged' }),
    ).rejects.toThrow(/Invalid container image/)
    await expect(
      containerProvider({
        exec,
        runtime: 'docker',
        mounts: [{ host: '/a:/etc', container: '/x' }],
      }).create(),
    ).rejects.toThrow(/cannot contain/)
    await expect(
      containerProvider({
        exec,
        runtime: 'docker',
        mounts: [{ host: 'rel', container: '/x' }],
      }).create(),
    ).rejects.toThrow(/absolute/)
  })

  it('plugs into sandboxTool, one container per run', async () => {
    const { exec, calls } = fake()
    const tool = sandboxTool(containerProvider({ exec, runtime: 'docker' }))
    const run = (runId: string) => tool.execute({ code: 'x' }, { runId })
    await run('a')
    await run('a')
    await run('b')
    expect(calls.filter((c) => c.args[0] === 'run')).toHaveLength(2)
    await tool.closeAll()
    expect(calls.filter((c) => c.args[0] === 'rm')).toHaveLength(2)
  })
})
