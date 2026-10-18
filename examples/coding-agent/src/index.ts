// ANTHROPIC_API_KEY=... pnpm --filter example-coding-agent start [dir]
import { provider } from '@intellibrix/ai-sdk'
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'
import { workspaceTools } from '@intellibrix/workspace'
import { Intelligence } from 'intellibrix'

const root = process.argv[2] ?? process.cwd()

const brick: TerminalBrick = new TerminalBrick({
  name: 'coding-agent',
  logLevel: 'fatal',
  intelligence: new Intelligence({
    provider: provider('anthropic:claude-sonnet-5'),
    model: 'claude-sonnet-5',
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
