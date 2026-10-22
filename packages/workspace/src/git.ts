import { defineTool, type ToolDefinition } from 'intellibrix'
import { simpleGit } from 'simple-git'
import { z } from 'zod'
import { resolveJailed } from './jail.js'

export type GitToolOptions = {
  root: string
  /** Require approval for `git_commit`. @default true */
  approveCommits?: boolean
}

/** `git_status`, `git_diff`, `git_commit`, `git_branch` over simple-git, scoped to the workspace root. */
export function gitTools({ root, approveCommits = true }: GitToolOptions): ToolDefinition[] {
  const git = async () => simpleGit({ baseDir: await resolveJailed(root, '.') })

  const git_status = defineTool({
    name: 'git_status',
    description: 'Show the working tree status.',
    input: z.object({}),
    resultTrust: 'untrusted',
    execute: async () => {
      const s = await (await git()).status()
      return {
        branch: s.current,
        ahead: s.ahead,
        behind: s.behind,
        staged: s.staged,
        modified: s.modified,
        created: s.created,
        deleted: s.deleted,
        untracked: s.not_added,
        conflicted: s.conflicted,
      }
    },
  })

  const git_diff = defineTool({
    name: 'git_diff',
    description: 'Show a unified diff of unstaged (or staged) changes.',
    input: z.object({ staged: z.boolean().default(false), path: z.string().optional() }),
    resultTrust: 'untrusted',
    execute: async ({ staged, path }) => {
      const args = staged ? ['--staged'] : []
      if (path) args.push('--', await resolveJailed(root, path))
      return { diff: await (await git()).diff(args) }
    },
  })

  const git_commit = defineTool({
    name: 'git_commit',
    description: 'Stage the given files (or all changes if none) and commit them.',
    input: z.object({ message: z.string().min(1), files: z.array(z.string()).optional() }),
    needsApproval: approveCommits,
    execute: async ({ message, files }) => {
      const g = await git()
      if (files?.length) {
        await g.add(await Promise.all(files.map((f) => resolveJailed(root, f))))
      } else {
        await g.add('-A')
      }
      const r = await g.commit(message)
      return { commit: r.commit, branch: r.branch, summary: r.summary }
    },
  })

  const git_branch = defineTool({
    name: 'git_branch',
    description: 'List branches, or create and switch to a new one when `create` is given.',
    input: z.object({ create: z.string().optional() }),
    needsApproval: (input) => Boolean(input.create) && approveCommits,
    execute: async ({ create }) => {
      const g = await git()
      if (create) await g.checkoutLocalBranch(create)
      const b = await g.branchLocal()
      return { current: b.current, all: b.all }
    },
  })

  return [git_status, git_diff, git_commit, git_branch]
}
