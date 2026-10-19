---
title: Coding agents
description: Give an agent a jailed filesystem, an allowlisted shell and git, with a human approving every change.
---

`@intellibrix/workspace` is the toolset for agents that work on code. One call builds it:

```ts
import { workspaceTools } from '@intellibrix/workspace'

const tools = workspaceTools({
  root: '/path/to/project',
  shell: { allow: ['node', 'pnpm', 'git'] },
})
```

| Tool | Does | Approval |
|---|---|---|
| `read_file`, `list_dir` | Read files and directories | no |
| `glob`, `grep` | Find files and search contents; both respect `.gitignore` | no |
| `write_file`, `edit_file` | Create or change files | **yes** |
| `git_status`, `git_diff`, `git_branch` | Inspect the repository | no |
| `git_commit` | Commit staged work | **yes** |
| `shell` | Run an allowlisted command | **yes** |

`read_file` also takes `offset`, `limit` and `lineNumbers`, so a model can read part of a file that is
too large to read whole.

Everything the read tools return is tagged `untrusted`, because file contents can contain
instructions aimed at the model. See [Approvals and trust](/guides/approvals-and-trust/).

## Patching, checking and planning

`@intellibrix/agent-tools` adds the tools that make the edit, check, fix loop reliable:

```ts
import { agentTools } from '@intellibrix/agent-tools'

const tools = [...workspaceTools({ root }), ...agentTools({ root })]
```

| Tool | Does | Approval |
|---|---|---|
| `apply_patch` | Apply a unified diff across several files, all or nothing | **yes** |
| `run_checks` | Run named checks (test, typecheck, lint, build) and return parsed failures | **yes** |
| `todo` | Keep a task list for the run | no |
| `web_search`, `fetch_url`, `ask_user`, `delegate` | Search and read the web, ask the human, hand off to a sub-agent (see below) | `fetch_url`: yes unless `allowHosts` |

**`apply_patch`** takes a unified diff. Every hunk of every file is applied in memory first, and
nothing is written unless all of them apply, so a bad hunk never leaves half a change behind. Line
numbers in hunk headers are only hints (models often miscount), so each hunk is found by its
context lines. It creates files (`--- /dev/null`), deletes them (`+++ /dev/null`), renames them,
keeps CRLF line endings and a missing final newline, and stays inside the workspace root. Pass
`check: true` to validate a patch without writing it.

**`run_checks`** runs commands you define, never command lines the model writes. By default it reads
`package.json` and uses the `test`, `typecheck` (or `type-check`), `lint` and `build` scripts with
the package manager that owns your lockfile. To set your own:

```ts
agentTools({
  root,
  checks: {
    checks: {
      test: { command: 'pnpm', args: ['vitest', 'run'], parse: 'vitest' },
      typecheck: { command: 'pnpm', args: ['tsc', '--noEmit'], parse: 'tsc' },
    },
  },
})
```

Each result has `ok`, `exitCode`, `durationMs`, the tail of the output when it failed, and
`failures`, a list of `{ file, line, column, message }` pulled from the output. The built-in
parsers read `tsc`, Vitest and the common `file:line:col: message` format; pass a function as
`parse` for anything else.

**`todo`** gives the model a task list it replaces on each call (one task `in_progress` at a time),
scoped to the run. Read it from your own code with `tool.store.get(runId)`, or pass `onChange` to
render progress as it updates. Pass `checks: false` or `todo: false` to leave either out.

## Refusing stale edits

Give `workspaceTools` and `agentTools` one `FileTracker` and a write is refused when the model never read
the file, or when the file changed after it did (another process, a formatter, you):

```ts
import { FileTracker, workspaceTools } from '@intellibrix/workspace'

const tracker = new FileTracker() // one per session
const tools = [...workspaceTools({ root, tracker }), ...agentTools({ root, tracker })]
```

It covers `write_file`, `edit_file` and `apply_patch`. Creating a new file needs no read, a model's own
writes count as seen so it can keep editing, and reading part of a file with `offset`/`limit` counts as
a read. The model gets a plain error ("changed since you last read it; read it again") and recovers by
reading. Tracking is off unless you pass a tracker.

## Reading the web, asking questions, delegating

Three more tools are included only when you configure them:

```ts
agentTools({
  root,
  fetch: { allowHosts: ['developer.mozilla.org', '*.nodejs.org'] },
  askUser: { ask: async ({ question, choices }) => askHuman(question, choices) },
  delegate: { agents: { reviewer: { agent: reviewerIntelligence, description: 'reviews a diff' } } },
})
```

**`web_search`** (`search: { provider }`) returns titles, URLs and snippets from a backend you choose, tagged
`untrusted`: `braveSearch({ apiKey })`, `tavilySearch({ apiKey })` or `searxngSearch({ baseUrl })` for a
self-hosted instance. Or implement `SearchProvider` (an `id` and a `search(query, { limit, signal })`) for
anything else. Pair it with `fetch_url` to read a result in full.

**`fetch_url`** returns a page as readable text (or the source with `format: 'raw'`), tagged `untrusted`.
A model that has read hostile text could try to use it to reach your internal network or to carry data
out in a URL, so it is built to resist both:

- only `http` and `https`, with no credentials in the URL;
- the address is checked when the connection is made, so loopback, private, link-local (including the
  cloud metadata address) and multicast ranges are refused, including IPv6 forms that wrap an IPv4
  address, and a DNS answer cannot change between the check and the connection;
- every redirect is followed by hand and checked again;
- the body is size-limited, uncompressed and text only, with a time limit.

It needs approval unless you pin `allowHosts` (exact names, or `*.example.com`), since a URL can carry
data in its query string. `allowPrivateNetwork: true` turns the address check off for local testing.

**`ask_user`** pauses the run so the model can ask a clarifying question instead of guessing. You
decide how it is shown; in a terminal that is `brick.print` and `await brick.input()`.

**`delegate`** hands a self-contained task to a named sub-agent (an `Intelligence` or a `Brick`) and
returns its final answer. The sub-agent keeps its own tools and approval policy, so set `onToolApproval`
on it: delegating never widens what a tool call may do. The answer is `untrusted` unless you set
`trusted: true`, because a sub-agent that read a hostile file can pass its instructions along. Do not
give the sub-agent the `delegate` tool.

## Wiring it up

```ts
import { Intelligence } from 'intellibrix'

const intelligence = new Intelligence({
  provider,
  model,
  system: 'You are a careful coding agent. Read before you edit.',
  tools,
  onToolApproval: async ({ toolName, input }) => askHuman(`${toolName} ${JSON.stringify(input)}`),
})

await intelligence.ask('Rename getUser to fetchUser everywhere and run the tests')
```

The [`coding-agent` example](https://github.com/intellibrix/intellibrix/tree/master/examples/coding-agent)
puts this in an interactive terminal session with `chatRepl`.

With no `onToolApproval`, every write, commit and shell call is denied and the model sees an
error. Read-only exploration still works, which is a useful mode for a "review this repo" agent.

## What the jail guarantees

All paths are resolved against `root` by `resolveJailed`:

- `..` traversal and absolute paths outside the root throw `JailEscapeError`.
- Symlinks are resolved with `fs.realpath` and re-checked, so a link pointing outside the
  workspace is refused. This holds for reads, for writes to files that do not exist yet, and for
  `grep`, which silently skips such links.
- `glob` and `grep` patterns that leave the workspace (`../*`, `/etc/*`, `~/*`) or that are
  built to exhaust the glob engine (very long, deeply nested braces) are rejected.

## The shell tool

`shell` runs a command through `execFile`, never through a shell, so `; rm -rf /` in an
argument is just a string.

```ts
workspaceTools({ root, shell: { allow: ['node', 'pnpm'], timeoutMs: 60_000 } })
```

- `command` must be a **bare name on the allowlist**. `node` works; `/tmp/evil/node` and
  `./node` are rejected. The name is resolved through `PATH`, so keep `PATH` trustworthy.
- `cwd` is jailed like any other path.
- Output is capped and a timeout kills the process.
- Leave `shell` out entirely and the model has no way to run commands.

Think hard before allowlisting an interpreter or a build tool. `node -e` and `pnpm run` execute
arbitrary code by design. That is fine behind approval, but it means the allowlist is a
convenience, not a sandbox. When you need real isolation, use
[sandboxed code execution](/guides/sandboxed-code/).

## Options

| Option | Default | Effect |
|---|---|---|
| `git` | `true` | Include the git tools |
| `shell` | omitted | Include `shell` with this allowlist |
| `shell.alwaysApprove` | `false` | Run without asking (CI only) |
| `approveWrites` | `true` | Ask before `write_file` and `edit_file` |

For unattended runs, prefer relaxing approval one tool at a time over turning everything off,
and read the [threat model](https://github.com/intellibrix/intellibrix/blob/master/THREAT_MODEL.md) first.
