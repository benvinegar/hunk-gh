import { HunkExtensionUserError } from "hunkdiff/extension";

/** Builds a user-facing invocation error with valid forms attached. */
export function invocationError(message: string): HunkExtensionUserError {
  return new HunkExtensionUserError(message, {
    suggestions: [
      "Run `hunk gh pr --help` for accepted pull-request forms.",
      "Use `hunk gh pr 123 --repo owner/repo` outside a GitHub checkout.",
    ],
  });
}
