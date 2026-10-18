import { Octokit } from '@octokit/rest'
import { defineTool, type ToolDefinition } from 'intellibrix'
import { z } from 'zod'

export type GithubToolsOptions = {
  /** A GitHub token. Never read from the environment implicitly. */
  auth: string
  baseUrl?: string
  /** Inject a preconfigured client (used by tests). */
  octokit?: Octokit
  /** Require approval for tools that write to GitHub. @default true */
  approveWrites?: boolean
}

const repo = { owner: z.string(), repo: z.string() }

const issueSummary = (i: {
  number: number
  title: string
  state: string
  user?: { login: string } | null
  body?: string | null
  html_url: string
  labels?: unknown[]
}) => ({
  number: i.number,
  title: i.title,
  state: i.state,
  author: i.user?.login,
  body: i.body ?? '',
  url: i.html_url,
})

/**
 * Issue, pull-request, comment and review tools over octokit. Everything read
 * from GitHub is user-controlled text, so read tools are tagged
 * `resultTrust: 'untrusted'`; writes require approval by default.
 */
export function githubTools(options: GithubToolsOptions): ToolDefinition[] {
  const octokit = options.octokit ?? new Octokit({ auth: options.auth, baseUrl: options.baseUrl })
  const approve = options.approveWrites ?? true

  const get_issue = defineTool({
    name: 'github_get_issue',
    description: 'Fetch a GitHub issue by number.',
    input: z.object({ ...repo, number: z.number().int() }),
    resultTrust: 'untrusted',
    execute: async ({ owner, repo, number }) =>
      issueSummary((await octokit.rest.issues.get({ owner, repo, issue_number: number })).data),
  })

  const list_issues = defineTool({
    name: 'github_list_issues',
    description: 'List issues in a repository (pull requests excluded).',
    input: z.object({
      ...repo,
      state: z.enum(['open', 'closed', 'all']).default('open'),
      labels: z.string().optional().describe('Comma-separated label names'),
      perPage: z.number().int().min(1).max(100).default(30),
    }),
    resultTrust: 'untrusted',
    execute: async ({ owner, repo, state, labels, perPage }) => {
      const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state,
        labels,
        per_page: perPage,
      })
      return data.filter((i) => !i.pull_request).map(issueSummary)
    },
  })

  const create_issue = defineTool({
    name: 'github_create_issue',
    description: 'Open a new issue.',
    input: z.object({
      ...repo,
      title: z.string(),
      body: z.string().optional(),
      labels: z.array(z.string()).optional(),
    }),
    needsApproval: approve,
    execute: async ({ owner, repo, ...rest }) =>
      issueSummary((await octokit.rest.issues.create({ owner, repo, ...rest })).data),
  })

  const add_comment = defineTool({
    name: 'github_add_comment',
    description: 'Comment on an issue or pull request.',
    input: z.object({ ...repo, number: z.number().int(), body: z.string().min(1) }),
    needsApproval: approve,
    execute: async ({ owner, repo, number, body }) => {
      const { data } = await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: number,
        body,
      })
      return { id: data.id, url: data.html_url }
    },
  })

  const get_pull_request = defineTool({
    name: 'github_get_pull_request',
    description: 'Fetch a pull request, optionally with its unified diff.',
    input: z.object({ ...repo, number: z.number().int(), includeDiff: z.boolean().default(false) }),
    resultTrust: 'untrusted',
    execute: async ({ owner, repo, number, includeDiff }) => {
      const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: number })
      const summary = {
        ...issueSummary(data),
        head: data.head.ref,
        base: data.base.ref,
        merged: data.merged,
        draft: data.draft,
        changedFiles: data.changed_files,
      }
      if (!includeDiff) return summary
      const diff = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner,
        repo,
        pull_number: number,
        headers: { accept: 'application/vnd.github.v3.diff' },
      })
      return { ...summary, diff: String(diff.data) }
    },
  })

  const list_pull_requests = defineTool({
    name: 'github_list_pull_requests',
    description: 'List pull requests in a repository.',
    input: z.object({
      ...repo,
      state: z.enum(['open', 'closed', 'all']).default('open'),
      perPage: z.number().int().min(1).max(100).default(30),
    }),
    resultTrust: 'untrusted',
    execute: async ({ owner, repo, state, perPage }) =>
      (await octokit.rest.pulls.list({ owner, repo, state, per_page: perPage })).data.map(
        issueSummary,
      ),
  })

  const create_pull_request = defineTool({
    name: 'github_create_pull_request',
    description: 'Open a pull request from `head` into `base`.',
    input: z.object({
      ...repo,
      title: z.string(),
      head: z.string(),
      base: z.string(),
      body: z.string().optional(),
      draft: z.boolean().optional(),
    }),
    needsApproval: approve,
    execute: async ({ owner, repo, ...rest }) =>
      issueSummary((await octokit.rest.pulls.create({ owner, repo, ...rest })).data),
  })

  const create_review = defineTool({
    name: 'github_create_review',
    description: 'Submit a review on a pull request (comment, approve, or request changes).',
    input: z.object({
      ...repo,
      number: z.number().int(),
      event: z.enum(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']),
      body: z.string().optional(),
      comments: z
        .array(z.object({ path: z.string(), line: z.number().int(), body: z.string() }))
        .optional(),
    }),
    needsApproval: approve,
    execute: async ({ owner, repo, number, event, body, comments }) => {
      const { data } = await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: number,
        event,
        body,
        comments,
      })
      return { id: data.id, state: data.state, url: data.html_url }
    },
  })

  return [
    get_issue,
    list_issues,
    create_issue,
    add_comment,
    get_pull_request,
    list_pull_requests,
    create_pull_request,
    create_review,
  ]
}
