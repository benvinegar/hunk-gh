# hunk-gh agent notes

## Purpose

- Hunk extension that exposes GitHub workflows under `hunk gh`.
- `hunk gh pr` fetches a pull request diff directly from GitHub and delegates to Hunk's built-in `patch` command.
- The extension ships as TypeScript source with no runtime dependencies.

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
