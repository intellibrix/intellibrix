/** The outcome of running code in a sandbox. */
export type RunCodeResult = {
  stdout: string
  stderr: string
  exitCode: number
}

/** A live, isolated execution environment. */
export interface Sandbox {
  runCode(code: string, opts?: { language?: string }): Promise<RunCodeResult>
  close(): Promise<void>
}

/**
 * A hosted-sandbox backend (E2B, Daytona, Cloudflare, ...). Implementations
 * are thin; the package ships no default so consumers pick one explicitly.
 */
export interface SandboxProvider {
  id: string
  create(opts?: { template?: string; timeoutMs?: number }): Promise<Sandbox>
}

/**
 * Dynamically imports an optional vendor SDK, throwing an actionable error
 * (naming the package to install) when it is absent.
 */
export async function importVendor<T>(pkg: string, adapter: string): Promise<T> {
  try {
    // Variable specifier: keeps the vendor SDK out of the type graph and the bundle.
    const specifier: string = pkg
    return (await import(specifier)) as T
  } catch (cause) {
    throw new Error(
      `${adapter} requires the optional peer dependency "${pkg}". Install it: pnpm add ${pkg}`,
      { cause },
    )
  }
}
