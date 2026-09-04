import { execFile } from "node:child_process";
import { HunkExtensionUserError } from "hunkdiff/extension";
import { parseGitHubRepository } from "./parsing";
import type {
  GitHubExtensionRuntime,
  GitHubPrInvocation,
  GitHubRepository,
  ResolvedGitHubPullRequest,
} from "./types";

/** Parses a github.com remote URL into its owner and repository. */
export function parseGitHubRemoteRepository(value: string): GitHubRepository | null {
  const scp = /^(?:[^@\s]+@)?github\.com:([^/\s]+\/[^/\s]+)$/i.exec(value);
  let repositoryPath: string | undefined;
  if (scp) {
    repositoryPath = scp[1];
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (
      !["https:", "ssh:", "git:"].includes(url.protocol) ||
      url.hostname.toLowerCase() !== "github.com" ||
      url.port ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    repositoryPath = url.pathname.replace(/^\//, "");
  }

  if (!repositoryPath) return null;
  try {
    return parseGitHubRepository(repositoryPath.replace(/\.git$/i, ""));
  } catch {
    return null;
  }
}

/** Reads origin without a shell so repository paths never become executable syntax. */
export async function readGitOrigin(cwd: string, signal: AbortSignal): Promise<string> {
  if (signal.aborted)
    throw new HunkExtensionUserError("GitHub pull-request loading was cancelled.");
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["remote", "get-url", "origin"],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 16 * 1024,
        signal,
        timeout: 5_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (signal.aborted) {
          reject(new HunkExtensionUserError("GitHub pull-request loading was cancelled."));
          return;
        }
        if (error || !stdout.trim()) {
          const unavailable = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
          reject(
            new HunkExtensionUserError(
              unavailable
                ? "Git is unavailable for local origin inference."
                : "The current directory has no small, readable Git origin.",
              { suggestions: ["Pass `--repo owner/repo` or use an owner/repo#number locator."] },
            ),
          );
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/** Resolves an explicit repository or infers one from the local GitHub origin. */
export async function resolveGitHubRepository(
  explicitRepository: string | undefined,
  cwd: string,
  signal: AbortSignal,
  resolveOrigin: GitHubExtensionRuntime["resolveOrigin"] = readGitOrigin,
): Promise<GitHubRepository> {
  if (explicitRepository) return parseGitHubRepository(explicitRepository);
  const repository = parseGitHubRemoteRepository(await resolveOrigin(cwd, signal));
  if (!repository) {
    throw new HunkExtensionUserError("The local origin is not a supported github.com repository.", {
      suggestions: ["Pass `--repo owner/repo` explicitly."],
    });
  }
  return repository;
}

/** Resolves the repository named by a PR invocation or inferred from local origin. */
export async function resolveGitHubPullRequest(
  invocation: GitHubPrInvocation,
  cwd: string,
  signal: AbortSignal,
  resolveOrigin: GitHubExtensionRuntime["resolveOrigin"] = readGitOrigin,
): Promise<ResolvedGitHubPullRequest> {
  if (invocation.locator.owner && invocation.locator.repo) {
    return {
      owner: invocation.locator.owner,
      repo: invocation.locator.repo,
      number: invocation.locator.number,
    };
  }
  const repository = await resolveGitHubRepository(
    invocation.explicitRepository,
    cwd,
    signal,
    resolveOrigin,
  );
  return { ...repository, number: invocation.locator.number };
}
