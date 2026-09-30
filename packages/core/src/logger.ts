import { pino } from 'pino'

let sharedLogger: pino.Logger | undefined

/**
 * Returns a process-wide shared pino logger, created lazily on first use and
 * shared across every {@link Brick}/{@link Structure} instance. Fixes the
 * pre-1.0 behavior of constructing a new pino-pretty transport (and worker
 * thread) per instance.
 */
export function getSharedLogger(options?: {
  logJSON?: boolean
  pinoOptions?: pino.LoggerOptions
}): pino.Logger {
  if (sharedLogger) return sharedLogger

  if (options?.pinoOptions) {
    sharedLogger = pino(options.pinoOptions)
    return sharedLogger
  }

  // stdout carries the protocol for stdio MCP servers, so logs must go elsewhere.
  if (process.env.INTELLIBRIX_LOG_STDERR) {
    sharedLogger = pino({}, pino.destination(2))
    return sharedLogger
  }

  const pretty =
    !options?.logJSON && Boolean(process.stdout.isTTY) && process.env.NODE_ENV !== 'production'

  sharedLogger = pino(
    pretty
      ? {
          transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
        }
      : {},
  )

  return sharedLogger
}

/** Resets the shared logger singleton. Intended for use in tests only. */
export function resetSharedLogger(): void {
  sharedLogger = undefined
}
