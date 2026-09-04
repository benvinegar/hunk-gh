export const GITHUB_HELP = `Usage: hunk gh <command>

GitHub commands:
  pr <pull-request> [--repo <owner/repo>] [-- <patch-options...>]
      Review a GitHub pull request without requiring the gh CLI.
  commit <sha> [--repo <owner/repo>] [-- <patch-options...>]
      Review a GitHub commit without requiring the gh CLI.
  compare <base>...<head> [--repo <owner/repo>] [-- <patch-options...>]
      Review the changes between two GitHub refs.

Run \`hunk gh <command> --help\` for command-specific help.
`;

export const GITHUB_PR_HELP = `Usage: hunk gh pr <pull-request> [--repo <owner/repo>] [-- <patch-options...>]

Review a GitHub pull request without requiring the gh CLI.

Pull request forms:
  123                                  infer owner/repo from the local origin
  123 --repo modem-dev/hunk            use an explicit repository
  'modem-dev/hunk#123'                 name the repository and pull request
  https://github.com/modem-dev/hunk/pull/123

Authentication:
  GH_TOKEN, then GITHUB_TOKEN           optional for public repositories
`;

export const GITHUB_COMMIT_HELP = `Usage: hunk gh commit <sha> [--repo <owner/repo>] [-- <patch-options...>]

Review a GitHub commit without requiring the gh CLI.

A 7–40 character hexadecimal commit SHA is required. The repository is inferred
from the local origin unless --repo names it explicitly.
`;

export const GITHUB_COMPARE_HELP = `Usage: hunk gh compare <base>...<head> [--repo <owner/repo>] [-- <patch-options...>]

Review the changes between two GitHub branches, tags, or commits.

Compare forms:
  main...feature                      infer owner/repo from the local origin
  v0.20.0...v0.21.0 --repo modem-dev/hunk

Use three dots exactly. Pass Hunk patch options after --.
`;
