// Runs every example offline and checks its output. Requires `pnpm -r build` first.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const TIMEOUT_MS = 60_000

/** Runs `pnpm <args>` in the repo, feeding `stdin`, and resolves with the process result. */
function run(args, { stdin = '', env = {}, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd,
      env: { ...process.env, ANTHROPIC_API_KEY: '', OPENROUTER_API_KEY: '', ...env },
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`timed out after ${TIMEOUT_MS}ms: pnpm ${args.join(' ')}`))
    }, TIMEOUT_MS)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.end(stdin)
  })
}

function assert(condition, message, result) {
  if (condition) return
  throw new Error(
    `${message}\n--- stdout ---\n${result?.stdout}\n--- stderr ---\n${result?.stderr}`,
  )
}

const checks = {
  async supervisor() {
    const r = await run(['--filter', 'example-supervisor', '--silent', 'start'])
    assert(r.code === 0, 'exited non-zero', r)
    assert(r.stdout.includes('Per the researcher'), 'unexpected output', r)
  },

  async qa() {
    const r = await run(['--filter', 'example-qa', '--silent', 'start'])
    assert(r.code === 0, 'exited non-zero', r)
    assert(r.stdout.includes('84'), 'unexpected output', r)
  },

  // Speaks raw MCP over stdio, the way Claude Desktop or Cursor would.
  async 'mcp-server'() {
    const messages = [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '0' },
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'word_count', arguments: { text: 'one two three' } },
      },
    ]
    const child = spawn('pnpm', ['--filter', 'example-mcp-server', '--silent', 'start'], {
      cwd: root,
    })
    let stdout = ''
    child.stdout.on('data', (d) => {
      stdout += d
    })
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no reply to tools/call:\n${stdout}`)),
        30_000,
      )
      child.stdout.on('data', () => {
        const lines = stdout.split('\n').filter(Boolean)
        const parsed = lines.map((l) => JSON.parse(l)) // every stdout line must be protocol JSON
        const answer = parsed.find((m) => m.id === 2)
        if (answer) {
          clearTimeout(timer)
          resolve(answer)
        }
      })
    })
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`)
    try {
      const answer = await reply
      assert(
        JSON.stringify(answer).includes('\\"words\\":3'),
        `unexpected tool result: ${JSON.stringify(answer)}`,
      )
    } finally {
      child.kill()
    }
  },

  // No TTY and closed stdin: the REPL must exit cleanly instead of hanging.
  async 'coding-agent'() {
    const r = await run(['--filter', 'example-coding-agent', '--silent', 'start'], {
      env: { OPENROUTER_API_KEY: 'smoke-test-key' },
    })
    assert(r.code === 0, 'exited non-zero on closed stdin', r)
  },
}

let failed = 0
for (const [name, check] of Object.entries(checks)) {
  try {
    await check()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed++
    console.error(`FAIL ${name}\n${error instanceof Error ? error.message : error}\n`)
  }
}
process.exit(failed ? 1 : 0)
