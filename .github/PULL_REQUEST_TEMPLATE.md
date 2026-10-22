## What and why

<!-- What does this change, and why? Link the issue: "Closes #123". -->

## Checklist

- [ ] The PR title follows Conventional Commits, e.g. `fix(workspace): ...`
- [ ] Tests added or updated (use `MockProvider`; no network or API keys)
- [ ] `pnpm -r typecheck`, `pnpm biome ci .`, `pnpm -r test` pass
- [ ] A changeset is included (`pnpm changeset`) if a published package changed
- [ ] Docs and package READMEs updated if behavior changed
- [ ] If the core API changed: `pnpm --filter intellibrix api:update` run, and `MIGRATION.md` updated for breaking changes
- [ ] New tools that write or execute set `needsApproval`; tools returning outside content set `resultTrust: 'untrusted'`
