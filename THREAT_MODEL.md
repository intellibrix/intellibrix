# Threat model

This document says what intellibrix defends against, what it leaves to you, and the known
limits of each defense. It is the reference for [SECURITY.md](SECURITY.md).

## The core assumption

**The model is not trusted.** An LLM can be steered by anything it reads, a practice usually
called prompt injection, and an agent that reads files, issues, web pages or tool output can be
instructed by whoever wrote them. intellibrix therefore does not rely on the model to behave. It
limits what the model *can* do, and asks a human or policy before the dangerous things happen.

Three mechanisms carry this: approvals, trust tagging and the workspace jail. They are
defense in depth. None of them makes an agent safe by itself.

## Assets

- The host filesystem and processes reachable from the agent's process.
- Credentials: model API keys, GitHub tokens, webhook secrets, database URLs.
- Data in memory and vector stores, and in conversation history.
- The integrity of actions taken on your behalf (commits, comments, deployments, code run).

## Actors

| Actor | Capability |
|---|---|
| End user | Types prompts. Usually trusted, but may be an attacker if you expose the agent. |
| Content author | Wrote a file, issue, PR, web page or MCP result the agent reads. **Untrusted.** |
| Remote MCP caller | Calls tools exposed through `serveMcp`. **Untrusted.** |
| Webhook sender | Posts to the GitHub bridge. Untrusted until the signature verifies. |
| Model provider | Sees everything sent to it. Trusted with your data by your choice. |

## Defenses

### 1. Approvals (`needsApproval`)

Tools that can change the world declare `needsApproval`. By default this is on for `shell`,
`write_file`, `edit_file`, `git_commit` (and branch creation) and sandboxed `run_code`. The
loop calls your `onToolApproval` hook with the tool name, input, run id and the trust level of
the triggering content, and the call proceeds only if the hook approves (or edits) it.

- With no `onToolApproval` hook, gated calls are denied. Tools behind `serveMcp` are likewise
  denied unless you provide one.
- `alwaysApprove` options exist for unattended use. Using them removes this defense.
- Approval is only as good as the human or policy behind it. Show the full tool input, not a
  summary, and prefer policies that key off `trust`.

### 2. Trust tagging

Every message `Part` may carry `trust: 'trusted' | 'untrusted'`. Content from outside the
process is tagged `untrusted`: workspace file reads and git output, GitHub issue/PR data, and
results from MCP tools. Input arriving through `serveMcp` is untrusted by definition. The
trust of the content that triggered a tool call is passed to `onToolApproval`, so you can write
rules such as "never auto-approve a write that follows an untrusted read".

- Tagging is metadata. It does not stop the model from following injected instructions; it
  gives your approval policy the information to decide.
- Tools you write yourself should set `resultTrust: 'untrusted'` if they return external data.

### 3. Workspace jail (`@intellibrix/workspace`)

File tools resolve every path against a root. The lexical check rejects `..` escapes, then the
deepest existing ancestor is passed through `fs.realpath` and containment is checked again, so a
symlink inside the root cannot point outside it. A `JailEscapeError` is thrown on violation.

### 4. Shell tool

The `shell` tool uses `execFile`, never a shell, so there is no metacharacter interpolation. It
runs only commands on an allowlist, in a jailed working directory, with a timeout and an
output cap, and requires approval by default. It is omitted unless you configure an allowlist.

### 5. Webhook and MCP boundaries

The GitHub webhook bridge verifies the `x-hub-signature-256` HMAC with a constant-time
comparison before doing anything else. `serveMcp` denies gated tools unless you supply an
approval hook.

### 6. Sandboxed execution (`@intellibrix/sandbox`)

Model-written code should run in a hosted sandbox (E2B, Daytona, Cloudflare), not in your
process. `run_code` is approval-gated by default. Isolation is provided by the vendor.

## Known limitations

These are deliberate or inherent. Please do not report them as vulnerabilities, but do tell us
if you find a way to make one worse.

- **Allowlisted binaries are as powerful as the binary.** Allowing `node`, `python`, `pnpm` or
  `git` lets the model run arbitrary code (`node -e`, package scripts, git hooks). The allowlist
  restricts *which program starts*, not what the program does. The child process inherits the
  environment and is not otherwise confined. Allowlist narrowly, and use the sandbox for
  untrusted code.
- **The shell allowlist matches the command's basename.** `command` values such as
  `/some/dir/git` are checked as `git`. Keep untrusted binaries off paths the agent can write
  to, and do not allowlist names you have not vetted.
- **The jail covers the intellibrix file tools, not the process.** Anything an allowlisted
  command does, or any code you run outside the sandbox, is not subject to the jail.
- **Check-then-use races.** The jail resolves paths just before use. An attacker with
  concurrent write access to the workspace (another process, not the model) could swap a path
  for a symlink between the check and the operation.
- **Text-format tool calls.** `textToolCalls` turns tool-call markup in model *text* into real
  calls. Those calls go through the same loop, approvals and trust rules as native ones, but
  they also mean text containing such markup, including text copied from untrusted content,
  can become a call. Keep approvals on, or use `knownToolsOnly`.
- **Prompt injection is not solved.** Approvals, trust tags and narrow tool sets reduce the
  blast radius. They do not guarantee the model will not be misled.
- **Telemetry and logs may contain prompts and tool inputs.** Treat them as sensitive.

## Hardening checklist

- Give each agent the smallest tool set that does its job.
- Leave `needsApproval` on; build an `onToolApproval` policy that inspects `trust` and the full input.
- Run model-written code in `@intellibrix/sandbox`, not in-process.
- Allowlist shell commands narrowly, and never an interpreter you do not need.
- Run the agent as an unprivileged user, ideally in a container with only the workspace mounted.
- Keep secrets out of the workspace and out of the child-process environment.
- Verify webhook secrets are set; do not expose `serveMcp` over a network without authentication in front.
- Use `intellibrix/testing` (`MockProvider`, record/replay) to write regression tests for
  approval policies.

## Reporting

See [SECURITY.md](SECURITY.md).
