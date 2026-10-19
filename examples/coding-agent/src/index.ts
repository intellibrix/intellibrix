// OPENROUTER_API_KEY=... pnpm --filter example-coding-agent start [dir]
// Set OPENROUTER_MODEL to use a model other than the default (openrouter/free).
import { compatibleProvider } from '@intellibrix/ai-sdk'
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'
import { workspaceTools } from '@intellibrix/workspace'
import { Intelligence, textToolCalls } from 'intellibrix'

const root = process.argv[2] ?? process.cwd()
const apiKey = process.env.OPENROUTER_API_KEY
const model = process.env.OPENROUTER_MODEL ?? 'openrouter/free'

if (!apiKey) {
  console.error('Set OPENROUTER_API_KEY to run this example (https://openrouter.ai/keys).')
  process.exit(1)
}

const brick: TerminalBrick = new TerminalBrick({
  name: 'coding-agent',
  logLevel: 'fatal',
  intelligence: new Intelligence({
    // Free models often write tool calls as text instead of using native tool calling.
    // textToolCalls() turns those into real calls, and passes native ones straight through.
    provider: textToolCalls(
      compatibleProvider(model, {
        name: 'openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
      }),
    ),
    model,
    // Show progress so the prompt doesn't look frozen while the model works.
    onEvent: (event) => {
      if (event.type === 'step-start') brick.printLine('\x1b[2m… thinking\x1b[0m')
      else if (event.type === 'tool-call-start')
        brick.printLine(`\x1b[2m→ ${event.toolName}(${JSON.stringify(event.input)})\x1b[0m`)
      else if (event.type === 'tool-call-denied') brick.printLine('\x1b[2m✗ denied\x1b[0m')
    },
    system: `You are a careful coding agent working in ${root}. Read before you edit.`,
    tools: workspaceTools({ root, shell: { allow: ['node', 'pnpm', 'git'] } }),
    // Writes, shell and commits need approval; ask the human.
    onToolApproval: async (call): Promise<boolean> => {
      brick.print(`\nApprove ${call.toolName}(${JSON.stringify(call.input)})? [y/N] `)
      return (await brick.input()).trim().toLowerCase() === 'y'
    },
  }),
})

await chatRepl(brick)
process.exit(0)
