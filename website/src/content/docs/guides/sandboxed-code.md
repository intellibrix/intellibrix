---
title: Sandboxed code execution
description: Let an agent run code it wrote in an isolated hosted sandbox.
---

`@intellibrix/sandbox` adds one tool, `run_code`, that executes code in a sandbox and returns
`{ stdout, stderr, exitCode }`. The package ships no default backend: you pick one, so nothing runs
anywhere you did not choose. The sandbox can be a local Podman or Docker container, or a hosted
service.

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
| `containerProvider()` | Local [Podman](https://podman.io) or [Docker](https://docker.com) container | nothing: needs the `podman` or `docker` CLI |
| `e2bProvider()` | [E2B](https://e2b.dev) | `pnpm add @e2b/code-interpreter` |
| `daytonaProvider()` | [Daytona](https://daytona.io) | `pnpm add @daytonaio/sdk` |
| `cloudflareProvider(() => handle)` | Cloudflare Sandbox | pass a function returning the handle from your Worker (`python`, `javascript`, `bash`) |

Vendor SDKs are optional peer dependencies, loaded on first use. If one is missing the error names
the package to install.

## Local containers

`containerProvider()` runs code on your own machine, with no account and no network round trip:

```ts
import { containerProvider, sandboxTool } from '@intellibrix/sandbox'

const run = sandboxTool(
  containerProvider({
    image: 'python:3.13-slim', // must contain the interpreters you allow
    mounts: [{ host: '/path/to/data', container: '/data' }], // read-only unless you say otherwise
  }),
)
```

It uses Podman if it is installed and Docker otherwise (set `runtime` to choose). Each sandbox is
one container that idles until code arrives, so files written in one call are there in the next.
The container starts with:

- **no network** (`network: 'bridge'` turns it on),
- all Linux capabilities dropped and `no-new-privileges`,
- 512 MB of memory, one CPU and 256 processes (`memory`, `cpus`, `pidsLimit`),
- a writable `/workspace` and `/tmp` held in memory (`readOnlyRoot: true` makes the rest read-only).

Code is written to the interpreter's standard input, never placed on a command line. The model can
name `python`, `javascript` (`node`), `bash` or `sh`; add more with `languages`, for example
`{ ruby: ['ruby', '-'] }`, and pick a matching `image`. A call that runs longer than `runTimeoutMs`
(60 seconds) has its processes killed and returns exit code 124; files survive.

The container is a strong boundary but it shares your machine. Mount only what the code needs, keep
secrets out of `env` (the model can print them), and leave the network off unless the task needs it.
Containers are removed on `closeRun`/`closeAll`; ones that outlive a crashed process carry the label
`intellibrix.sandbox=1`, so `podman ps --filter label=intellibrix.sandbox=1` finds them.

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
