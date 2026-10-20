# @intellibrix/agent-tools

Patch, verify, plan, compute, query and look things up: tools for intellibrix coding agents.

Part of [intellibrix](https://github.com/intellibrix/intellibrix), a model-agnostic TypeScript framework for building agents and AI-powered software components. Requires Node 22+.

## Install

```sh
npm install @intellibrix/agent-tools @intellibrix/workspace intellibrix
```

## Usage

Exports `agentTools`, plus each tool on its own:

- `applyPatchTool`: apply a unified diff across several files, all or nothing.
- `runChecksTool`: run the project's test, typecheck and lint commands and get structured failures back.
- `todoTool`: a task list the model keeps up to date.
- `calculatorTool`: exact arithmetic (`+ - * / % ^`, parentheses, `sqrt`, `round`, `min`, `max`, …) from a parsed expression, never `eval`.
- `datetimeTool`: the current time, time zone conversion, date arithmetic and differences.
- `jsonQueryTool`: jq-style queries over JSON and JSON Lines files in the workspace.
- `diffTool`: a unified diff between two files or texts (`createUnifiedDiff` for the function).
- `memoryTool`: notes the model saves and searches across runs, in any `KeyValueStore`.
- `webSearchTool`: search the web through Brave, Tavily, SearXNG or your own backend.
- `fetchUrlTool`: read a web page as Markdown of its main content, with protection against reaching internal addresses and optional `robots.txt` support.
- `askUserTool`: let the model ask the human a question.
- `delegateTool`: hand a task to a named sub-agent.

With a shared `FileTracker`, writes to unread or since-changed files are refused. `web_search`, `fetch_url`, `ask_user` and `delegate` are included when you configure them. Patches and checks are confined to the workspace root and require approval by default.

## Links

- [Documentation](https://github.com/intellibrix/intellibrix#readme)
- [Migration guide (0.x to 1.0)](https://github.com/intellibrix/intellibrix/blob/master/MIGRATION.md)
- [Issues](https://github.com/intellibrix/intellibrix/issues)

## License

MIT
