# hunk-gh agent notes

## Purpose

- Hunk extension that exposes GitHub workflows under `hunk gh`.
- `hunk gh pr` and `hunk gh commit` fetch diffs directly from GitHub and delegate to Hunk's built-in `patch` command.
- The extension ships as TypeScript source with no runtime dependencies.

## Architecture

- `index.ts` is the folder-extension entry point and public re-export surface; keep it tiny.
- `src/parsing.ts` validates PR, commit, repository, and delegated patch arguments.
- `src/repository.ts` parses and resolves GitHub origins without invoking a shell.
- `src/github.ts` owns authenticated, bounded, redirect-safe GitHub diff requests.
- `src/temporaryPatch.ts` owns restrictive temporary patch creation and cleanup.
- `src/extension.ts` dispatches commands and delegates fetched diffs to Hunk.
- Tests stay colocated with each module under `src/`.

## Working rules

- Preserve the fixed `api.github.com` credential boundary and manual redirect policy.
- Never include response bodies or tokens in user-facing errors.
- Keep temporary patch permissions and shutdown cleanup behavior covered by tests.
- Add short JSDoc comments to functions and helpers.
- Validate with `bun run check`.

## Releases

- Record user-visible changes in `CHANGELOG.md` under `Unreleased`.
- Use Conventional Commit titles: `<type>[scope]: <description>`.
- Tag releases as `v<version>` after updating the package version and changelog.
