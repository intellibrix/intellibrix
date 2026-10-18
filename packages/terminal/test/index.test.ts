import { customProvider, Intelligence } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import TerminalBrick, { chatRepl, InputClosedError } from '../src/index.js'

describe('Terminal Brick', () => {
  let brick: TerminalBrick

  it('Should be able to create a terminal brick', async () => {
    brick = new TerminalBrick({ name: 'Terminal Brick' })
    expect(brick).toBeInstanceOf(TerminalBrick)
    brick.printDebug('Terminal Brick Created')
  })
})

describe('chatRepl', () => {
  const makeRepl = (inputs: string[], reply: (p: string) => string | Promise<string>) => {
    const out: string[] = []
    const brick = new TerminalBrick({
      logLevel: 'fatal',
      intelligence: new Intelligence({
        provider: customProvider(async (p) => reply(p)),
        model: 'mock',
      }),
    })
    brick.print = (t) => void out.push(`print:${t}`)
    brick.printLine = (t) => void out.push(`line:${t}`)
    brick.printError = (t) => void out.push(`error:${t}`)
    brick.input = async () => inputs.shift() ?? 'exit'
    return { brick, out }
  }

  it('reads input, prints replies, and stops on exit', async () => {
    const { brick, out } = makeRepl(['hello', '', 'EXIT', 'never'], (p) => `got ${p}`)
    await chatRepl(brick)
    expect(out.filter((o) => o.startsWith('line:'))).toEqual(['line:got hello'])
  })

  it('keeps going after an ask() error', async () => {
    let n = 0
    const { brick, out } = makeRepl(['a', 'b', 'quit'], () => {
      if (n++ === 0) throw new Error('boom')
      return 'ok'
    })
    await chatRepl(brick)
    expect(out).toContain('error:boom')
    expect(out).toContain('line:ok')
  })

  it('stops cleanly when input closes', async () => {
    const { brick, out } = makeRepl(['hello'], (p) => `got ${p}`)
    let calls = 0
    brick.input = async () => {
      if (calls++ === 0) return 'hello'
      throw new InputClosedError()
    }
    await chatRepl(brick)
    expect(out).toContain('line:got hello')
  })

  it('prints a quit hint once, and releases the terminal on exit', async () => {
    const { brick, out } = makeRepl(['hi'], () => 'ok')
    let released = 0
    brick.release = () => void released++
    await chatRepl(brick)
    expect(out.filter((o) => o.includes('Ctrl+C'))).toEqual([
      'print:Type "exit" or press Ctrl+C to quit.\n',
    ])
    expect(released).toBe(1)

    const quiet = makeRepl([], () => 'ok')
    await chatRepl(quiet.brick, { hint: false })
    expect(quiet.out.some((o) => o.includes('Ctrl+C'))).toBe(false)
  })

  it('cancels only the current turn when Ctrl+C arrives during ask()', async () => {
    const { brick, out } = makeRepl(['slow', 'next'], (p) => `got ${p}`)
    const realAsk = brick.ask.bind(brick)
    // Like a real provider's fetch, a hung call rejects when its signal aborts.
    brick.ask = ((prompt: string, options: { abortSignal?: AbortSignal }) =>
      prompt === 'slow'
        ? new Promise((_, reject) =>
            options.abortSignal?.addEventListener('abort', () => reject(new Error('aborted'))),
          )
        : realAsk(prompt, options)) as typeof brick.ask
    let interrupt: () => void = () => {}
    brick.onInterrupt = (h) => {
      interrupt = h
      return () => {}
    }
    const done = chatRepl(brick)
    await new Promise((r) => setTimeout(r, 20))
    interrupt()
    await done
    expect(out).toContain('error:Cancelled.')
    expect(out).toContain('line:got next')
  })

  it('stops when the signal aborts', async () => {
    const controller = new AbortController()
    const { brick } = makeRepl(['a', 'b'], () => {
      controller.abort()
      return 'x'
    })
    await chatRepl(brick, { signal: controller.signal })
  })
})
