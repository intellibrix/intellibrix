import type { Application, Request, RequestHandler, Response } from 'express'
import express from 'express'
import type { IncomingMessage, Server, ServerResponse } from 'http'
import { type AskOptions, Brick, type BrickOptions, type Intelligence } from 'intellibrix'

/**
 * Interface for the options of ExpressBrick.
 * It extends from {@link BrickOptions} and adds properties specific to ExpressBrick.
 * @extends BrickOptions
 * @namespace ExpressBrick
 */
export interface ExpressBrickOptions extends BrickOptions {
  /** The port on which the Express server will listen. */
  port?: number
  /** The host on which the Express server will listen. */
  host?: string
  /** An array of routes that the Express server will handle. */
  routes?: {
    /** The path for the route. */
    path: string
    /** The HTTP method for the route. */
    method: string
    /** The handler function to execute when the route is hit. */
    handler: (req: Request, res: Response) => void
  }[]
  /** An array of middleware functions to use in the Express application. */
  middleware?: RequestHandler[]
  /** An object specifying whether to use built-in middleware functions. */
  builtinMiddleware?: {
    /** Whether to use the built-in JSON middleware. */
    json: boolean
    /** Whether to use the built-in URL-encoded middleware. */
    urlencoded: boolean
  }
}

/**
 * Interface for the request object in ExpressBrick.
 * It extends from the Request object and adds a property for the Brick instance.
 */
export interface ExpressBrickRequest extends Request {
  /** The Brick instance associated with the request. */
  brick?: Brick
}

/** Anything `askRoute`/`askStreamRoute` can send a prompt to. */
export type AskTarget = Brick | Intelligence

function intelligenceOf(target: AskTarget): Intelligence {
  const ai = target instanceof Brick ? target.ai : target
  if (!ai) throw new Error('askStreamRoute target has no Intelligence configured')
  return ai
}

function promptOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * POST handler: reads `{prompt, threadId?}` from the JSON body and replies
 * `{reply}` with the target's answer. Responds 400 on a missing prompt and 500
 * on failure.
 */
export function askRoute(target: AskTarget): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const prompt = promptOf(req.body?.prompt)
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }

    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) controller.abort()
    })
    const options: AskOptions = {
      abortSignal: controller.signal,
      threadId: promptOf(req.body?.threadId),
    }

    try {
      const result = await target.ask(prompt, options)
      res.status(200).json({ reply: result.text })
    } catch (error) {
      if (!res.headersSent)
        res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/**
 * GET handler: reads `?prompt=` (and optional `threadId`) and streams the
 * target's {@link Intelligence.stream} output as Server-Sent Events, one
 * `event: <type>` / `data: <json>` frame per stream event. The run is aborted
 * if the client disconnects.
 */
export function askStreamRoute(target: AskTarget): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const prompt = promptOf(req.query.prompt)
    if (!prompt) {
      res.status(400).json({ error: 'prompt is required' })
      return
    }

    const controller = new AbortController()
    res.on('close', () => controller.abort())

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.flushHeaders()

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      const ai = intelligenceOf(target)
      const tools = target instanceof Brick ? [...ai.tools, ...target.toolset()] : undefined
      for await (const event of ai.stream(prompt, {
        abortSignal: controller.signal,
        threadId: promptOf(req.query.threadId),
        tools,
      })) {
        if (controller.signal.aborted) break
        send(
          event.type,
          event.type === 'error'
            ? { message: String((event.error as Error)?.message ?? event.error) }
            : event,
        )
      }
      send('done', {})
    } catch (error) {
      send('error', { message: error instanceof Error ? error.message : String(error) })
    } finally {
      res.end()
    }
  }
}

/**
 * Class representing a brick that sets up an Express server.
 * It extends from the {@link intellibrix!Brick} class.
 *
 * Access all of Express's functionality through the {@link ExpressBrick.express} property.
 *
 * @example
 * const brick = new ExpressBrick({
 *   port: 3000,
 *   routes: [
 *     {
 *       path: '/',
 *       method: 'get',
 *       handler: (req, res) => {
 *         res.status(200).send('Hello World')
 *       }
 *     },
 *     {
 *       path: '/echo',
 *       method: 'post',
 *       handler: (req, res) => {
 *         res.status(200).json(req.body)
 *       }
 *     }
 *   ]
 * })
 */
export default class ExpressBrick extends Brick {
  /** The Express application instance. */
  express: Application
  /** The HTTP server instance. */
  server?: Server<typeof IncomingMessage, typeof ServerResponse>

  /**
   * Creates a new ExpressBrick.
   *
   * @remarks Supports all {@link BrickOptions} as well as {@link ExpressBrickOptions}.
   *
   * @param options - The options for the ExpressBrick.
   * @param options.port - The port on which the Express server will listen (default=3000, 0=disabled)
   * @param options.host - The host on which the Express server will listen (default=localhost)
   * @param options.routes - An array of routes that the Express server will handle (default=[])
   * @param options.middleware - An array of middleware functions to use in the Express application (default=[])
   * @param options.builtinMiddleware - An object specifying whether to use built-in middleware functions (default={ json: true, urlencoded: true })
   */
  constructor(
    options: ExpressBrickOptions = {
      port: 3000,
      host: 'localhost',
      routes: [],
      middleware: [],
      builtinMiddleware: { json: true, urlencoded: true },
    },
  ) {
    super(options)
    const host = options.host || 'localhost'
    const port = options.port ?? 3000
    const routes = options.routes || []
    const middleware = options.middleware || []
    const builtinMiddleware = options.builtinMiddleware || { json: true, urlencoded: true }

    this.express = express()
    this.express.use((req: ExpressBrickRequest, _, next) => {
      req.brick = this
      next()
    })

    if (builtinMiddleware?.json) this.express.use(express.json())
    if (builtinMiddleware?.urlencoded) this.express.use(express.urlencoded({ extended: true }))

    if (middleware) {
      middleware.forEach((middleware) => {
        this.express.use(middleware)
      })
    }

    if (routes) {
      routes.forEach((route) => {
        ;(this.express as any)[route.method](route.path, route.handler)
      })
    }

    if (port !== 0) {
      // If port is 0, don't start the server
      this.server = this.express.listen(port, host, () => {
        this.log.info(`Express Brick listening on ${host}:${port}`)
      })
    }
  }

  /**
   * Registers `POST <path>` (default `/ask`) answering with {@link askRoute}.
   * Defaults to this brick as the target.
   */
  askEndpoint(path = '/ask', target: AskTarget = this) {
    this.express.post(path, askRoute(target))
    return this
  }

  /**
   * Registers `GET <path>` (default `/ask/stream`) streaming with {@link askStreamRoute}.
   * Defaults to this brick as the target.
   */
  askStreamEndpoint(path = '/ask/stream', target: AskTarget = this) {
    this.express.get(path, askStreamRoute(target))
    return this
  }
}
