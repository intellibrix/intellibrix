// OPENROUTER_API_KEY=... pnpm --filter example-coding-agent start [dir]
// Set OPENROUTER_MODEL to use a model other than the default (openrouter/free).
// Optional web search: set BRAVE_API_KEY, TAVILY_API_KEY or SEARXNG_URL.
import { agentTools, braveSearch, searxngSearch, tavilySearch } from '@intellibrix/agent-tools'
import { compatibleProvider } from '@intellibrix/ai-sdk'
import TerminalBrick, { chatRepl } from '@intellibrix/terminal'
import { FileTracker, workspaceTools } from '@intellibrix/workspace'
import { defaultToolCallParsers, Intelligence, jsonToolCalls, textToolCalls } from 'intellibrix'

const root = process.argv[2] ?? process.cwd()
const apiKey = process.env.OPENROUTER_API_KEY
const model = process.env.OPENROUTER_MODEL ?? 'openrouter/free'
// Refuse edits to files the model has not read, or that changed since it did.
const tracker = new FileTracker()

// Web search needs a backend; pick whichever one is configured.
const env = process.env
const searchProvider = env.BRAVE_API_KEY
  ? braveSearch({ apiKey: env.BRAVE_API_KEY })
  : env.TAVILY_API_KEY
    ? tavilySearch({ apiKey: env.TAVILY_API_KEY })
    : env.SEARXNG_URL
      ? searxngSearch({ baseUrl: env.SEARXNG_URL })
      : undefined

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
    maxSteps: 25,
    // Show progress so the prompt doesn't look frozen while the model works.
    onEvent: (event) => {
      if (event.type === 'step-start') brick.printLine('\x1b[2m… thinking\x1b[0m')
      else if (event.type === 'tool-call-start')
        brick.printLine(`\x1b[2m→ ${event.toolName}(${JSON.stringify(event.input)})\x1b[0m`)
      else if (event.type === 'tool-call-denied') brick.printLine('\x1b[2m✗ denied\x1b[0m')
    },
    system: `You are a careful assistant, mainly for coding, working in ${root}. Questions that are not about the code (news, facts) do not need the project files: use web_search and fetch_url for those, and do not browse the project. Read a file before you edit it; edits to unread or changed files are refused.
Use only these tools, by exact name: read_file (optionally with offset and limit), list_dir, glob, grep, write_file, edit_file, apply_patch (a unified diff, applied to several files all or nothing), run_checks (runs the project's test, typecheck and lint and returns the failures), todo (your task list for multi-step work), calculator (exact arithmetic: use it instead of computing numbers yourself), fetch_url (read one web page at a URL), ask_user (ask the human a question), shell (a command plus an args array; only node, pnpm and git are allowed), git_status, git_diff, git_commit, git_branch${searchProvider ? ', web_search (search the web for titles, URLs and snippets; then fetch_url to read a result)' : ''}. The working directory is ${root}.
${searchProvider ? '' : 'You have NO web search tool. If asked to search the web, say so plainly and suggest setting BRAVE_API_KEY, TAVILY_API_KEY or SEARXNG_URL. Do not try search engine result pages with fetch_url; they are blocked. Only fetch a URL the user gave you, or one you are sure exists.'}`,
    tools: [
      ...workspaceTools({ root, tracker, shell: { allow: ['node', 'pnpm', 'git'] } }),
      ...agentTools({
        root,
        tracker,
        fetch: true,
        ...(searchProvider ? { search: { provider: searchProvider } } : {}),
        askUser: {
          ask: async ({ question, choices }) => {
            brick.print(`\n${question}${choices ? ` (${choices.join(' / ')})` : ''} `)
            return (await brick.input()).trim()
          },
        },
      }),
    ],
    // Writes, shell and commits need approval; ask the human.
    onToolApproval: async (call): Promise<boolean> => {
      brick.print(`\nApprove ${call.toolName}(${JSON.stringify(call.input)})? [y/N] `)
      return (await brick.input()).trim().toLowerCase() === 'y'
    },
  }),
})

if (!searchProvider)
  console.error(
    'Note: web search is off. Set BRAVE_API_KEY, TAVILY_API_KEY or SEARXNG_URL to enable it.',
  )
await chatRepl(brick)
process.exit(0)
