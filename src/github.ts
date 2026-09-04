import { HunkExtensionUserError } from "hunkdiff/extension";
import type { GitHubFetch, GitHubRepository, ResolvedGitHubPullRequest } from "./types";

const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_DIFF_BYTES = 64 * 1024 * 1024;

/** Builds credential-safe GitHub diff request headers. */
function githubDiffHeaders(env: NodeJS.ProcessEnv, userAgent: string): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github.v3.diff",
    "User-Agent": userAgent,
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (token) {
    try {
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      throw new HunkExtensionUserError(
        "The configured GitHub token contains characters that cannot be sent in an HTTP header.",
        { suggestions: ["Set GH_TOKEN or GITHUB_TOKEN to the token value without line breaks."] },
      );
    }
  }
  return headers;
}

/** Reads a bounded response body so a remote server cannot exhaust process memory. */
async function readBoundedResponse(
  response: Response,
  signal: AbortSignal,
  emptyMessage = "GitHub returned an empty diff.",
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DIFF_BYTES) {
    throw new HunkExtensionUserError("The GitHub diff exceeds the 64 MiB safety limit.");
  }
  if (!response.body) {
    throw new HunkExtensionUserError(emptyMessage);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new HunkExtensionUserError("GitHub diff loading was cancelled.");
      }
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_DIFF_BYTES) {
        await reader.cancel();
        throw new HunkExtensionUserError("The GitHub diff exceeds the 64 MiB safety limit.");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (signal.aborted) {
      throw new HunkExtensionUserError("GitHub diff loading was cancelled.");
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) {
    throw new HunkExtensionUserError(emptyMessage);
  }
  return bytes;
}

/** Converts a non-success PR response into a fixed, credential-safe error. */
function pullRequestResponseError(response: Response, target: ResolvedGitHubPullRequest) {
  const name = `${target.owner}/${target.repo}#${target.number}`;
  if (response.status === 401) {
    return new HunkExtensionUserError(`GitHub rejected the configured token for ${name}.`, {
      suggestions: ["Refresh GH_TOKEN or GITHUB_TOKEN and retry."],
    });
  }
  if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
    return new HunkExtensionUserError(`GitHub API rate limiting blocked ${name}.`, {
      suggestions: [
        "Authenticate with GH_TOKEN or GITHUB_TOKEN, or retry after the rate limit resets.",
      ],
    });
  }
  if (response.status === 403) {
    return new HunkExtensionUserError(`GitHub denied access to ${name}.`, {
      suggestions: ["Check token repository permissions and organization SSO authorization."],
    });
  }
  if (response.status === 404) {
    return new HunkExtensionUserError(
      `GitHub could not find an accessible pull request at ${name}.`,
      {
        suggestions: [
          "Check the repository and PR number; private repositories require token access.",
        ],
      },
    );
  }
  if (response.status >= 300 && response.status < 400) {
    return new HunkExtensionUserError(
      "GitHub redirected the pull-request request; refusing to forward credentials.",
    );
  }
  return new HunkExtensionUserError(`GitHub returned HTTP ${response.status} for ${name}.`);
}

/** Fetches one GitHub pull-request diff without invoking the gh CLI. */
export async function fetchGitHubPullRequestDiff(
  target: ResolvedGitHubPullRequest,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: GitHubFetch = fetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/pulls/${target.number}`,
      {
        headers: githubDiffHeaders(env, "hunk-github-pr-extension"),
        redirect: "manual",
        signal,
      },
    );
  } catch (error) {
    if (error instanceof HunkExtensionUserError) throw error;
    if (signal.aborted)
      throw new HunkExtensionUserError("GitHub pull-request loading was cancelled.");
    throw new HunkExtensionUserError(
      "GitHub could not be reached while loading the pull request.",
      {
        suggestions: ["Check network access and retry."],
      },
    );
  }
  if (!response.ok) throw pullRequestResponseError(response, target);
  return readBoundedResponse(response, signal);
}

/** Fetches one GitHub commit diff without invoking the gh CLI. */
export async function fetchGitHubCommitDiff(
  repository: GitHubRepository,
  sha: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: GitHubFetch = fetch,
): Promise<Uint8Array> {
  const name = `${repository.owner}/${repository.repo}@${sha}`;
  let response: Response;
  try {
    response = await fetchImpl(
      `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/commits/${sha}`,
      { headers: githubDiffHeaders(env, "hunk-gh-extension"), redirect: "manual", signal },
    );
  } catch (error) {
    if (error instanceof HunkExtensionUserError) throw error;
    if (signal.aborted) throw new HunkExtensionUserError("GitHub commit loading was cancelled.");
    throw new HunkExtensionUserError("GitHub could not be reached while loading the commit.");
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new HunkExtensionUserError(`GitHub could not find an accessible commit at ${name}.`);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new HunkExtensionUserError(
        "GitHub redirected the commit request; refusing to forward credentials.",
      );
    }
    throw new HunkExtensionUserError(`GitHub returned HTTP ${response.status} for ${name}.`);
  }
  return readBoundedResponse(response, signal);
}

/** Fetches the diff between two GitHub refs without invoking the gh CLI. */
export async function fetchGitHubCompareDiff(
  repository: GitHubRepository,
  base: string,
  head: string,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: GitHubFetch = fetch,
): Promise<Uint8Array> {
  const name = `${repository.owner}/${repository.repo}:${base}...${head}`;
  let response: Response;
  try {
    const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    response = await fetchImpl(
      `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/compare/${range}`,
      { headers: githubDiffHeaders(env, "hunk-gh-extension"), redirect: "manual", signal },
    );
  } catch (error) {
    if (error instanceof HunkExtensionUserError) throw error;
    if (signal.aborted)
      throw new HunkExtensionUserError("GitHub comparison loading was cancelled.");
    throw new HunkExtensionUserError("GitHub could not be reached while loading the comparison.");
  }
  if (!response.ok) {
    if (response.status === 401) {
      throw new HunkExtensionUserError(`GitHub rejected the configured token for ${name}.`);
    }
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new HunkExtensionUserError(`GitHub API rate limiting blocked ${name}.`);
    }
    if (response.status === 403) {
      throw new HunkExtensionUserError(`GitHub denied access to ${name}.`);
    }
    if (response.status === 404) {
      throw new HunkExtensionUserError(
        `GitHub could not find an accessible comparison at ${name}.`,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      throw new HunkExtensionUserError(
        "GitHub redirected the comparison request; refusing to forward credentials.",
      );
    }
    throw new HunkExtensionUserError(`GitHub returned HTTP ${response.status} for ${name}.`);
  }
  return readBoundedResponse(
    response,
    signal,
    `GitHub found no changes between ${base} and ${head}.`,
  );
}
