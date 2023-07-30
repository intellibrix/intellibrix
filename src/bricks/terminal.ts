import TerminalKit from 'terminal-kit'
import Brick, { BrickOptions } from '../brick'

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
