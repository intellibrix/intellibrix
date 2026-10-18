# Security Policy

intellibrix is a framework for building agents that read files, run commands and call
external services, so we treat security reports seriously.

## Supported versions

| Version | Supported |
|---|---|
| 1.x | Yes |
| 0.x | No. See [MIGRATION.md](MIGRATION.md) to upgrade. |

All `intellibrix` and `@intellibrix/*` packages are versioned together, so a fix ships as a new
release of every package.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately in one of these ways:

- Use GitHub's private reporting: **Security → Report a vulnerability** on
  [intellibrix/intellibrix](https://github.com/intellibrix/intellibrix/security/advisories/new).
- Or email `dev@intellibrix.dev` with `[security]` in the subject.

Please include the affected package and version, a description of the impact, and steps or a
proof of concept to reproduce it.

You can expect an acknowledgement within a few days. We will keep you informed while we
investigate, agree on a disclosure date with you, and credit you in the advisory unless you
prefer otherwise.

## Scope

In scope: the packages in this repository, in particular the guarantees described in the
[threat model](THREAT_MODEL.md):

- escapes from the workspace jail (`@intellibrix/workspace`)
- ways to run a gated tool without going through `needsApproval`
- missing or wrong `trust` tagging on content from outside the process
- authentication bypass in the GitHub webhook bridge or `serveMcp`
- secrets leaking into logs, events or telemetry

Out of scope: vulnerabilities in third-party model providers, MCP servers you choose to mount,
or sandbox vendors; prompt injection that only changes model *output* without bypassing an
approval or a jail; and behavior you have explicitly enabled (for example `alwaysApprove`, or
allowlisting an interpreter such as `node` in the shell tool).
