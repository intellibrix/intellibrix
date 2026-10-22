---
title: Working with GitHub
description: Issue, pull request and review tools, and a webhook that turns deliveries into events.
---

`@intellibrix/github` lets an agent read and act on GitHub, and lets GitHub wake your agent up.

## Tools

```ts
import { githubTools } from '@intellibrix/github'

const tools = githubTools({ auth: process.env.GITHUB_TOKEN! })
```

| Tool | Approval |
|---|---|
| `github_get_issue`, `github_list_issues` | no |
| `github_get_pull_request`, `github_list_pull_requests` | no |
| `github_create_issue`, `github_add_comment` | **yes** |
| `github_create_pull_request`, `github_create_review` | **yes** |

- The token is passed in explicitly and never read from the environment.
- Issue and PR text is written by strangers. Read tools are tagged `untrusted`, so a malicious
  issue body cannot silently authorize a write.
- Set `approveWrites: false` only for runs where nobody could inject text, and give the token
  the narrowest scope you can.
- `baseUrl` points the client at GitHub Enterprise.

## Reacting to webhooks

`githubWebhookRoute` verifies GitHub's HMAC signature and re-emits each delivery on a Brick's
event bus:

```ts
import { githubWebhookRoute } from '@intellibrix/github'
import express from 'express'

const triage = new Brick({ name: 'triage', intelligence })

triage.events.on('github.issues.opened', async (payload) => {
  const { number, title } = payload.issue
  await triage.ask(`Triage issue #${number}: ${title}`, { tools: githubTools({ auth }) })
})

const app = express()
app.post('/webhooks/github', ...githubWebhookRoute({ secret: process.env.GH_WEBHOOK_SECRET!, target: triage }))
app.listen(3000)
```

Events arrive as `github.<event>`, `github.<event>.<action>` when the payload has one, and a
catch-all `github` carrying `{ event, action, deliveryId, payload }`.

Things to know:

- The signature is computed over the **raw bytes**. `githubWebhookRoute` mounts `express.raw`
  for you, so do not put `express.json()` in front of it. With `ExpressBrick`, pass
  `builtinMiddleware: { json: false, urlencoded: true }` or register the webhook first.
- Bad signatures get a `401` and never reach your handlers. Valid deliveries get a `202`
  immediately, so a slow agent does not hit GitHub's delivery timeout.
- The payload is attacker-influenced text, like any issue body. Treat it as untrusted when you
  put it in a prompt.
- Use `verifySignature` and `signPayload` directly if you serve webhooks without Express.
