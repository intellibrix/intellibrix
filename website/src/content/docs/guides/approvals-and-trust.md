---
title: Approvals and trust
description: Keep humans in control of what an agent does, and defend against prompt injection.
---

An LLM can be steered by anything it reads. intellibrix is built on the assumption that **the
model is not trusted**, and gives you three mechanisms. The full analysis is in the
[threat model](https://github.com/intellibrix/intellibrix/blob/master/THREAT_MODEL.md).

## 1. Approvals

Mark a tool `needsApproval` and the loop pauses before running it. You supply the decision with
`onToolApproval`:

```ts
import { Intelligence, defineTool } from 'intellibrix'
import { z } from 'zod'

const deleteFile = defineTool({
  name: 'delete_file',
  description: 'Delete a file',
  input: z.object({ path: z.string() }),
  needsApproval: true,
  execute: async ({ path }) => ({ deleted: path }),
})

const intelligence = new Intelligence({
  provider,
  model,
  tools: [deleteFile],
  onToolApproval: async ({ toolName, input, trust }) => {
    // return true to allow, false to deny, or { edit } to approve with changed input
    return askHuman(`Allow ${toolName}(${JSON.stringify(input)})?`)
  },
})
```

- **No hook means no.** If a tool needs approval and there is no `onToolApproval`, the call is
  denied. Tools served through `serveMcp` behave the same way.
- A decision can be `true`, `false` or `{ edit: newInput }`, which approves the call with the
  input you substitute.
- The built-in tools that change the world (`shell`, `write_file`, `edit_file`, `git_commit`,
  sandboxed `run_code`) ask for approval by default.
- `needsApproval` can also be a function of the input and context, so you can gate only the
  risky calls.

## 2. Trust tagging

Every message `Part` may carry `trust: 'trusted' | 'untrusted'`. Content from outside the
process (workspace file reads, GitHub data, MCP results, anything arriving through `serveMcp`) is
tagged `untrusted`. The hook receives the trust level of the content that led to the call, so a
policy can say: *never auto-approve a write that follows an untrusted read*.

```ts
onToolApproval: async ({ toolName, input, trust }) => {
  if (trust === 'untrusted') return askHuman(`Untrusted context. Allow ${toolName}?`)
  return autoApproveList.includes(toolName)
}
```

Tag your own tools too: set `resultTrust: 'untrusted'` on any tool that returns fetched or
user-controlled content.

## 3. Narrow tools

The best defence is a small tool set. `@intellibrix/workspace` jails file tools to a root
directory (symlink escapes are rejected, and glob patterns cannot leave it), and its shell tool runs
only allowlisted command names without a shell. Run model-written code in `@intellibrix/sandbox`,
not in your process.

:::caution
Allowlisting an interpreter such as `node` or `python` lets the model run arbitrary code. The
allowlist controls which program starts, not what it does. See the
[threat model](https://github.com/intellibrix/intellibrix/blob/master/THREAT_MODEL.md#known-limitations).
:::

## Observing decisions

`onRunEvent` emits `approval:requested` and `approval:resolved` events with the tool name, input,
trust and decision. Log them for an audit trail.
