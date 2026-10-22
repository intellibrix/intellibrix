import { createHmac, timingSafeEqual } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import type { Request, RequestHandler, Response } from 'express'
import express from 'express'

/** Anything with an event bus: a `Brick` or a `Structure`. */
export type WebhookTarget = { events: EventEmitter }

export type GithubWebhookOptions = {
  /** The webhook secret configured on GitHub. */
  secret: string
  target: WebhookTarget
}

/** Computes GitHub's `X-Hub-Signature-256` value for a raw body. */
export function signPayload(secret: string, body: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

/** Constant-time check of a signature header against the raw body. */
export function verifySignature(
  secret: string,
  body: Buffer | string,
  header: string | undefined,
): boolean {
  if (!header) return false
  const expected = Buffer.from(signPayload(secret, body))
  const actual = Buffer.from(header)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/**
 * A webhook handler for GitHub deliveries. The body must be the **raw**
 * Buffer: HMAC verification is over the exact bytes GitHub sent, so a
 * JSON-parsed body cannot be verified.
 *
 * Valid deliveries are re-emitted on `target.events` as `github.<event>` (and
 * `github.<event>.<action>` when the payload has an action) with the parsed
 * payload, plus a catch-all `github` event carrying `{event, action, deliveryId, payload}`.
 */
export function githubWebhookHandler({ secret, target }: GithubWebhookOptions): RequestHandler {
  return (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(500).json({
        error:
          'GitHub webhook route needs the raw body. Mount it with express.raw() before any JSON body parser.',
      })
      return
    }

    if (!verifySignature(secret, req.body, req.header('x-hub-signature-256'))) {
      res.status(401).json({ error: 'invalid signature' })
      return
    }

    const event = req.header('x-github-event')
    if (!event) {
      res.status(400).json({ error: 'missing X-GitHub-Event' })
      return
    }

    let payload: { action?: string } & Record<string, unknown>
    try {
      payload = JSON.parse(req.body.toString('utf8'))
    } catch {
      res.status(400).json({ error: 'invalid JSON' })
      return
    }

    const action = typeof payload.action === 'string' ? payload.action : undefined
    target.events.emit(`github.${event}`, payload)
    if (action) target.events.emit(`github.${event}.${action}`, payload)
    target.events.emit('github', {
      event,
      action,
      deliveryId: req.header('x-github-delivery'),
      payload,
    })
    res.status(202).json({ ok: true })
  }
}

/**
 * Middleware pair for `app.post(path, ...githubWebhookRoute(opts))`: `express.raw`
 * scoped to this route, then {@link githubWebhookHandler}.
 *
 * With `ExpressBrick`, disable its global JSON parser (`builtinMiddleware:
 * { json: false, urlencoded: true }`) or mount this route on the underlying app
 * before it, otherwise the body is consumed before it can be verified.
 */
export function githubWebhookRoute(options: GithubWebhookOptions): RequestHandler[] {
  return [express.raw({ type: 'application/json', limit: '25mb' }), githubWebhookHandler(options)]
}
