---
title: Sandboxed code execution
description: Let an agent run code it wrote in an isolated hosted sandbox.
---

`@intellibrix/sandbox` adds one tool, `run_code`, that executes code in a hosted sandbox and
returns `{ stdout, stderr, exitCode }`. The package ships no default backend: you pick one, so
nothing runs anywhere you did not choose.

```ts
import { e2bProvider, sandboxTool } from '@intellibrix/sandbox'
import { Intelligence } from 'intellibrix'

const run = sandboxTool(e2bProvider({ apiKey: process.env.E2B_API_KEY }))

const intelligence = new Intelligence({
  provider,
  model,
  tools: [run],
  onToolApproval: async ({ input }) => askHuman(input),
})

try {
  await intelligence.ask('Compute the 30th Fibonacci number in Python', { runId: 'job-1' })
} finally {
  await run.closeAll()
}
```

## Backends

| Factory | Service | Install |
|---|---|---|
| `e2bProvider()` | [E2B](https://e2b.dev) | `pnpm add @e2b/code-interpreter` |
| `daytonaProvider()` | [Daytona](https://daytona.io) | `pnpm add @daytonaio/sdk` |
| `cloudflareProvider(() => handle)` | Cloudflare Sandbox | pass a function returning the handle from your Worker (`python`, `javascript`, `bash`) |

Vendor SDKs are optional peer dependencies, loaded on first use. If one is missing the error names
the package to install.

## Lifecycle

- A sandbox is created lazily, **one per `runId`**, and reused for that run's later calls. Files
  and variables persist between calls, which is what lets the model iterate.
- Close it with `run.closeRun(runId)` when a run finishes, or `run.closeAll()` on shutdown.
- As a backstop, an idle sandbox closes itself after `idleTtlMs` (five minutes by default).
- A failed creation is not cached, so the next call retries.

## Safety

- `run_code` needs approval by default. It is the highest-blast-radius tool, so only relax it
  with `alwaysApprove: true` when the sandbox itself is the boundary you trust.
- Output is tagged `untrusted`.
- The sandbox isolates the code, not your prompt. A model that reads hostile text can still be
  talked into running hostile code inside the sandbox, so keep secrets out of it.

## Your own backend

A backend is two small interfaces:

```ts
import type { Sandbox, SandboxProvider } from '@intellibrix/sandbox'

const myProvider: SandboxProvider = {
  id: 'my-service',
  async create({ template, timeoutMs } = {}) {
    const box = await myService.start({ template, timeoutMs })
    const sandbox: Sandbox = {
      runCode: async (code, { language } = {}) => {
        const r = await box.exec(code, language)
        return { stdout: r.out, stderr: r.err, exitCode: r.status }
      },
      close: () => box.stop(),
    }
    return sandbox
  },
}
```
