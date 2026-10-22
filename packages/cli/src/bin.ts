#!/usr/bin/env node
import { runCli } from './index.js'

runCli(process.argv.slice(2)).then(
  (handle) => {
    // `mcp serve` returns a live server; everything else is done.
    if (!handle) return
    const shutdown = () => void handle.close().finally(() => process.exit(0))
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  },
  (error) => {
    process.stderr.write(`intellibrix: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  },
)
