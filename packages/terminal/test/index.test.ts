import { customProvider, Intelligence } from 'intellibrix'
import { describe, expect, it } from 'vitest'
import TerminalBrick, { chatRepl } from '../src/index.js'

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

  it('stops when the signal aborts', async () => {
    const controller = new AbortController()
    const { brick } = makeRepl(['a', 'b'], () => {
      controller.abort()
      return 'x'
    })
    await chatRepl(brick, { signal: controller.signal })
  })
})
