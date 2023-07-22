import { IncomingMessage, Server, ServerResponse } from 'http'
import Brick, { BrickOptions } from '../brick'
import express, { Application, Request, RequestHandler, Response } from 'express'

/**
 * Interface for the options of ExpressBrick.
 * It extends from BrickOptions and adds properties specific to ExpressBrick.
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

/**
 * Class representing a brick that sets up an Express server.
 * It extends from the {@link Core.Brick} class.
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
  constructor(options: ExpressBrickOptions = { port: 3000, host: 'localhost', routes: [], middleware: [], builtinMiddleware: { json: true, urlencoded: true } }) {
    super(options)
    const host = options.host || 'localhost'
    const port = options.port || 3000
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
      middleware.forEach(middleware => {
        this.express.use(middleware)
      })
    }

    if (routes) {
      routes.forEach(route => {
        (this.express as any)[route.method](route.path, route.handler)
      })
    }

    if (port !== 0) { // If port is 0, don't start the server
      this.server = this.express.listen(port, host, () => {
        this.log.info(`Express Brick listening on ${host}:${port}`)
      })
    }
  }
}
