# @intellibrix/sandbox

Vendor-neutral code-execution tool for intellibrix: local Podman/Docker containers, or hosted E2B, Daytona and Cloudflare sandboxes.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/sandbox intellibrix
```

Peer dependencies are optional; install the ones you use.

## Usage

Exports `sandboxTool`, an approval-gated `run_code` tool. `containerProvider()` runs code in a local Podman or Docker container with no extra dependencies; for a hosted vendor, install its peer.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
