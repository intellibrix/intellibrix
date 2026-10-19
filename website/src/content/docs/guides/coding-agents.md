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

Everything the read tools return is tagged `untrusted`, because file contents can contain
instructions aimed at the model. See [Approvals and trust](/guides/approvals-and-trust/).

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
