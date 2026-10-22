# @intellibrix/workspace

Jailed filesystem tools, allowlisted shell and git tools for intellibrix agents.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/workspace intellibrix
```

## Usage

Exports `workspaceTools`. Paths are confined to the workspace root (symlink escapes are rejected); `shell`, file writes and `git_commit` require approval.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
