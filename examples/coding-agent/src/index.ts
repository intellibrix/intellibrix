// OPENROUTER_API_KEY=... pnpm --filter example-coding-agent start [dir]
// Set OPENROUTER_MODEL to use a model other than the default (openrouter/free).
import { agentTools } from '@intellibrix/agent-tools'
import { compatibleProvider } from '@intellibrix/ai-sdk'
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'
import { workspaceTools } from '@intellibrix/workspace'
import { defaultToolCallParsers, Intelligence, jsonToolCalls, textToolCalls } from 'intellibrix'

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
      // Some models reply with a bare {"tool": ..., "args": ...} object; only accept offered tools.
      { parsers: [...defaultToolCallParsers, jsonToolCalls], knownToolsOnly: true },
    ),
    model,
    // Show progress so the prompt doesn't look frozen while the model works.
    onEvent: (event) => {
      if (event.type === 'step-start') brick.printLine('\x1b[2m… thinking\x1b[0m')
      else if (event.type === 'tool-call-start')
        brick.printLine(`\x1b[2m→ ${event.toolName}(${JSON.stringify(event.input)})\x1b[0m`)
      else if (event.type === 'tool-call-denied') brick.printLine('\x1b[2m✗ denied\x1b[0m')
    },
    system: `You are a careful coding agent working in ${root}. Read before you edit.
Use only these tools, by exact name: read_file (optionally with offset and limit), list_dir, glob, grep, write_file, edit_file, apply_patch (a unified diff, applied to several files all or nothing), run_checks (runs the project's test, typecheck and lint and returns the failures), todo (your task list for multi-step work), shell (a command plus an args array; only node, pnpm and git are allowed), git_status, git_diff, git_commit, git_branch. The working directory is ${root}.`,
    tools: [
      ...workspaceTools({ root, shell: { allow: ['node', 'pnpm', 'git'] } }),
      ...agentTools({ root }),
    ],
    // Writes, shell and commits need approval; ask the human.
    onToolApproval: async (call): Promise<boolean> => {
      brick.print(`\nApprove ${call.toolName}(${JSON.stringify(call.input)})? [y/N] `)
      return (await brick.input()).trim().toLowerCase() === 'y'
    },
  }),
})

await chatRepl(brick)
process.exit(0)
