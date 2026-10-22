---
title: Serving over HTTP
description: Expose an agent as a JSON endpoint or a Server-Sent Events stream with ExpressBrick.
---

`@intellibrix/express` wraps an Express app in a Brick and ships two ready-made routes.

```ts
import ExpressBrick from '@intellibrix/express'
import { Intelligence } from 'intellibrix'

const api = new ExpressBrick({
  name: 'api',
  port: 10100,
  host: '0.0.0.0', // the default is localhost; use 0.0.0.0 inside a container
  intelligence: new Intelligence({ provider, model, memory }),
})

api.askEndpoint() // POST /ask
api.askStreamEndpoint() // GET /ask/stream
```

## `POST /ask`

```bash
curl -s localhost:10100/ask -H 'content-type: application/json' \
  -d '{"prompt":"What is 2+2?","threadId":"demo"}'
# {"reply":"4"}
```

A missing prompt returns `400`; a failure returns `500` with `{ error }`. `threadId` selects the
conversation when the Intelligence has `memory`. If the client disconnects, the run is aborted so
you do not pay for an answer nobody is waiting for.

## `GET /ask/stream`

```bash
curl -N 'localhost:10100/ask/stream?prompt=Tell+me+a+story'
```

The response is Server-Sent Events, one `event: <type>` and `data: <json>` frame per stream
event (text deltas, tool calls, the finish), followed by `event: done`. In the browser use
`EventSource`. Disconnecting aborts the run here too.

## Using the routes yourself

`askRoute(target)` and `askStreamRoute(target)` are plain Express handlers, and `target` can be a
Brick or an Intelligence, so you can add them to an app you already have:

```ts
import { askRoute } from '@intellibrix/express'

app.post('/chat', express.json(), authenticate, askRoute(brick))
```

## Before you expose it

- **Authenticate.** An open `/ask` lets anyone spend your tokens and use your tools. Add
  middleware (`middleware: [authenticate]` in the options runs before every route).
- **Gate tools.** There is no human in an HTTP request, so a tool that `needsApproval` is denied
  unless you provide an `onToolApproval` policy. Do not give a public endpoint tools that write.
- **Limit cost.** Put rate limits in front and keep `maxSteps` modest.
- Mind the body parser. `ExpressBrick` parses JSON by default; for signed webhooks see
  [Working with GitHub](/guides/github/).
