# Contributing to intellibrix

Thanks for helping! This guide gets you from clone to pull request. By participating you agree
to the [Code of Conduct](CODE_OF_CONDUCT.md). To report a security problem, see
[SECURITY.md](SECURITY.md) instead of opening an issue.

## Ways to contribute

- **Report a bug** or **request a feature** with the [issue forms](../../issues/new/choose).
- **Propose a new brick or package** with the "Brick proposal" form before writing code, so we
  can agree on scope and naming.
- **Improve docs and examples.** Fixes to the README, package READMEs, and `examples/` are
  always welcome and are a good first contribution.
- **Fix a bug or build a feature.** For anything larger than a small fix, please open an issue
  first.

## Setup

Requires Node 22+ and [pnpm](https://pnpm.io). With [mise](https://mise.jdx.dev) just run
`mise install`.

```sh
git clone https://github.com/intellibrix/intellibrix.git
cd intellibrix
pnpm install      # also installs the git hooks
pnpm -r build     # examples and some tests use the built packages
pnpm -r test
```

## The checks CI runs

Run these before pushing; they are the same ones CI runs.

| Command | What it checks |
|---|---|
| `pnpm -r typecheck` | TypeScript, every package and example |
| `pnpm biome ci .` | Lint and formatting (`pnpm lint:fix` fixes most issues) |
| `pnpm -r build` | Builds ESM + CJS + types |
| `pnpm check:packages` | publint and are-the-types-wrong on each packed package |
| `pnpm check:api` | Public API of `intellibrix` against `packages/core/etc/*.api.md` |
| `pnpm smoke:examples` | Runs each example offline |
| `pnpm -r test` | Vitest suites (`pnpm --filter <pkg> test` for one package) |

The git hooks (via [lefthook](https://lefthook.dev)) run Biome on staged files before each
commit, check your commit message, and typecheck before push. `LEFTHOOK=0 git commit ...`
skips them in a pinch; CI will still check.

## Conventions

- **Commits and PR titles** follow [Conventional Commits](https://www.conventionalcommits.org):
  `type(scope): summary`, for example `fix(workspace): reject path-qualified commands`.
  Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore` and `ci`; the scope is
  usually a package name. PRs are squash-merged, and the PR title becomes the commit.
- **Changesets.** Any change that affects a published package needs one: run `pnpm changeset`,
  pick the packages and bump (all packages release in lockstep), and describe the change for
  users. Docs-only, CI and test-only changes don't need one.
- **The core API is stable.** `packages/core/src/{messages,tool,provider,loop,intelligence,brick,structure,database,testing,checkpoint}.ts`
  define the v1 surface. `pnpm check:api` fails when it changes. If the change is intentional and
  additive, run `pnpm --filter intellibrix api:update` and commit the updated report. If it
  is breaking, it also needs a `MIGRATION.md` entry and a major changeset, and will usually wait
  for the next major version. Prefer adding new things as new files.
- **Tools** are defined with `defineTool` and a Zod 4 schema. Anything that writes, executes or
  commits must set `needsApproval`; anything that returns outside content must set
  `resultTrust: 'untrusted'`. See the [threat model](THREAT_MODEL.md).
- **Providers** do exactly one model step per call; `loop.ts` owns iteration.
- **Tests** live in each package's `test/` directory. Use `MockProvider` from `intellibrix/testing`
  so tests need no network or API keys. New behavior needs a test; bug fixes need a regression test.
- **Style** is enforced by Biome. Match the surrounding code, including comment density.

[AGENTS.md](AGENTS.md) has the same information in a form aimed at AI coding agents, plus a list
of things that break silently. Read it too.

## Pull requests

1. Fork, branch from `master`, and keep the PR focused on one thing.
2. Make sure the checks above pass and add tests, docs and a changeset where needed.
3. Fill in the PR template. Link the issue it closes.
4. A maintainer will review. Please respond to feedback in the same PR; we squash on merge.

## Writing a new package

Scaffold under `packages/<name>` by copying a small existing package, such as
`packages/memory-sqlite`. Include the same `package.json` fields (repository, `publishConfig`,
`exports`), a README and a LICENSE, add `intellibrix` as `"workspace:^"`, add the package to
`typedoc.json` and the `fixed` list in `.changeset/config.json`, then run `pnpm install`.
