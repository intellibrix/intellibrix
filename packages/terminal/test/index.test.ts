import { describe, expect, it } from 'vitest'
import TerminalBrick from '../src/index.js'

describe('Terminal Brick', () => {
  let brick: TerminalBrick

  it('Should be able to create a terminal brick', async () => {
    brick = new TerminalBrick({ name: 'Terminal Brick' })
    expect(brick).toBeInstanceOf(TerminalBrick)
    brick.printDebug('Terminal Brick Created')
  })
})
