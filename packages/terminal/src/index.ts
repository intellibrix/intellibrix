import { randomUUID } from 'node:crypto'
import { Brick, type BrickOptions } from 'intellibrix'
import TerminalKit from 'terminal-kit'

/**
 * Class representing a Terminal Brick.
 * It extends from the {@link Core.Brick} class.
 *
 * It uses the [TerminalKit](https://github.com/cronvel/terminal-kit) library to interact with the terminal.
 *
 * @example
 * const terminalBrick = new TerminalBrick({ logLevel: 'silent' })
 *
 * while (true) {
 *   terminalBrick.print('> ')
 *   const input = await terminalBrick.input()
 *
 *   switch (input.toLowerCase()) {
 *     case 'exit':
 *       terminalBrick.printSuccess('Bye!')
 *       process.exit()
 *     case 'error':
 *       terminalBrick.printError('Error!')
 *       break
 *     case 'yellow':
 *       terminalBrick.terminal.yellow('Yellow!')
 *       break
 *     default:
 *       terminalBrick.printLine(`Command: ${input}`)
 *   }
 * }
 */
export default class TerminalBrick extends Brick {
  /** The TerminalKit module. */
  kit: typeof TerminalKit
  /** The TerminalKit terminal instance. */
  terminal: TerminalKit.Terminal

  /**
   * Creates a new Terminal Brick.
   * @param options - The options for the Terminal Brick.
   */
  constructor(options: BrickOptions = {}) {
    super(options)

    this.kit = TerminalKit
    this.terminal = TerminalKit.terminal
  }

  /**
   * Prints some text to the terminal.
   * @param text - The text to print.
   */
  print(text: string) {
    this.terminal(text)
  }

  /**
   * Prints a line of text to the terminal.
   * @param text - The text to print.
   */
  printLine(text: string) {
    this.terminal('\n' + text + '\n')
  }

  /**
   * Prints an error message to the terminal in red color.
   * @param text - The error message to print.
   */
  printError(text: string) {
    this.terminal.red('\n' + text + '\n')
  }

  /**
   * Prints a success message to the terminal in green color.
   * @param text - The success message to print.
   */
  printSuccess(text: string) {
    this.terminal.green('\n' + text + '\n')
  }

  /**
   * Prints a warning message to the terminal in yellow color.
   * @param text - The warning message to print.
   */
  printWarning(text: string) {
    this.terminal.yellow('\n' + text + '\n')
  }

  /**
   * Prints an info message to the terminal in blue color.
   * @param text - The info message to print.
   */
  printInfo(text: string) {
    this.terminal.blue('\n' + text + '\n')
  }

  /**
   * Prints a debug message to the terminal in cyan color.
   * @param text - The debug message to print.
   */
  printDebug(text: string) {
    this.terminal.cyan('\n' + text + '\n')
  }

  /**
   * Prompts the user for input in the terminal.
   * @param inputOptions - The options for the input field.
   * @returns A promise that resolves to the user's input.
   */
  async input(inputOptions: TerminalKit.Terminal.InputFieldOptions = {}) {
    return new Promise<string>((resolve) => {
      this.terminal.inputField(inputOptions, (error, input) => {
        if (error) throw error
        resolve(input || '')
      })
    })
  }
}

/** The slice of {@link TerminalBrick} that {@link chatRepl} needs. */
export interface ReplIO {
  print(text: string): void
  printLine(text: string): void
  printError(text: string): void
  input(): Promise<string>
}

export interface ChatReplOptions {
  /** Thread id passed to `ask()`, so a configured `memory` carries the conversation. Defaults to a random id. */
  threadId?: string
  /** Prompt shown before each input. @default '> ' */
  prompt?: string
  /** Inputs (case-insensitive) that end the session. @default ['exit', 'quit'] */
  exitCommands?: string[]
  /** Aborts the session, including an in-flight `ask()`. */
  signal?: AbortSignal
}

/**
 * Runs an interactive chat loop: read a line with the brick's own `input()`,
 * send it through `brick.ask()`, print the reply. Errors from `ask()` are
 * printed and the loop continues. Resolves when an exit command is entered or
 * `opts.signal` aborts.
 *
 * Uses the brick's `terminal-kit` input rather than `node:readline`, so two
 * libraries never fight over stdin raw mode.
 */
export async function chatRepl(brick: Brick & ReplIO, opts: ChatReplOptions = {}): Promise<void> {
  const prompt = opts.prompt ?? '> '
  const exit = new Set((opts.exitCommands ?? ['exit', 'quit']).map((c) => c.toLowerCase()))
  const threadId = opts.threadId ?? randomUUID()

  while (!opts.signal?.aborted) {
    brick.print(prompt)
    const line = (await brick.input()).trim()
    if (!line) continue
    if (exit.has(line.toLowerCase())) return

    try {
      const { text } = await brick.ask(line, { threadId, abortSignal: opts.signal })
      brick.printLine(text)
    } catch (error) {
      if (opts.signal?.aborted) return
      brick.printError(error instanceof Error ? error.message : String(error))
    }
  }
}
