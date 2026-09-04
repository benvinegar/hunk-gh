# hunk-gh

Review GitHub pull requests, commits, and comparisons in [Hunk](https://hunk.dev) without leaving the terminal or installing the GitHub CLI.

[![CI](https://github.com/modem-dev/hunk-gh/actions/workflows/ci.yml/badge.svg)](https://github.com/modem-dev/hunk-gh/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![hunk gh pr opening a GitHub pull request in Hunk](assets/hunk-gh.gif)

<sub>Prefer a still? See the [screenshot](assets/hunk-gh.png).</sub>

## Install

Hunk 0.21 or newer can install the extension directly from GitHub:

```bash
hunk extension install modem-dev/hunk-gh
```

New Hunk sessions load it automatically.

## Use

Open the single accessible pull request for the current branch. The repository is inferred from its GitHub `origin`:

```bash
hunk gh pr
```

Pass a number when you want a specific pull request:

```bash
hunk gh pr 123
```

Name a repository explicitly when running elsewhere:

```bash
hunk gh pr 123 --repo modem-dev/hunk
hunk gh pr 'modem-dev/hunk#123'
hunk gh pr https://github.com/modem-dev/hunk/pull/123
```

Quote the `owner/repo#number` form because some shells treat `#` as a comment.

Review a commit by its 7–40 character hexadecimal SHA, repository shorthand, or GitHub URL:

```bash
hunk gh commit a1b2c3d
hunk gh commit a1b2c3d --repo modem-dev/hunk
hunk gh commit modem-dev/hunk@a1b2c3d
hunk gh commit https://github.com/modem-dev/hunk/commit/a1b2c3d
```

Compare branches, tags, or commits with an explicit three-dot range:

```bash
hunk gh compare main...feature
hunk gh compare v0.20.0...v0.21.0 --repo modem-dev/hunk
```

Pass Hunk patch options after `--` for any command:

```bash
hunk gh pr 123 -- --mode stack
hunk gh commit a1b2c3d -- --mode stack
hunk gh compare main...feature -- --mode stack
```

Run `hunk gh --help` or `hunk gh pr --help` for command help.

## Authentication

Public repositories work anonymously within GitHub's API rate limits. For private repositories or higher limits, set `GH_TOKEN` or, when it is absent, `GITHUB_TOKEN`.

The token must have access to the target repository and may require organization SSO authorization. hunk-gh sends credentials only to the fixed `https://api.github.com` endpoint and refuses redirects.

## How it works

hunk-gh fetches the PR, commit, or comparison diff directly from GitHub's API, writes a temporary patch, and delegates to Hunk's built-in `patch` command. It does not require the `gh` CLI and has no runtime dependencies.

Fetched diffs are limited to 64 MiB. On POSIX systems, temporary directories use mode `0700` and patches use mode `0600`; Windows inherits the ACL of the system temporary directory. Patches remain available for review reloads and are removed when the extension shuts down.

GitHub Enterprise is not currently supported.

## Manage

```bash
hunk extension update hunk-gh
hunk extension remove hunk-gh
```

Pin a release when you want updates to stay on a specific version:

```bash
hunk extension install modem-dev/hunk-gh@v0.1.0
```

## Develop

The extension ships as TypeScript source—there is no build step.

```bash
bun install
bun run check
hunk --extension /path/to/hunk-gh gh pr 123 --repo modem-dev/hunk
```

See [Hunk's extension guide](https://hunk.dev/docs/extend/extensions/) for the public API and trust model.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities through [GitHub's private security advisory flow](SECURITY.md).

## License

[MIT](LICENSE)
