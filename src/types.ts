export interface GitHubRepository {
  owner: string;
  repo: string;
}

export interface GitHubPullRequestLocator {
  owner?: string;
  repo?: string;
  number: string;
}

export interface GitHubPrInvocation {
  locator: GitHubPullRequestLocator;
  explicitRepository?: string;
  patchArgs: readonly string[];
  help: boolean;
}

export interface ResolvedGitHubPullRequest extends GitHubRepository {
  number: string;
}

export interface GitHubCommitInvocation {
  sha: string;
  explicitRepository?: string;
  patchArgs: readonly string[];
  help: boolean;
}

export interface GitHubCompareInvocation {
  base: string;
  head: string;
  explicitRepository?: string;
  patchArgs: readonly string[];
  help: boolean;
}

export type GitHubFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GitHubExtensionRuntime {
  fetchImpl: GitHubFetch;
  env: NodeJS.ProcessEnv;
  resolveOrigin(cwd: string, signal: AbortSignal): Promise<string>;
  temporaryRoot: string;
}

/** Retains the historical runtime type name for API compatibility. */
export type GitHubPrExtensionRuntime = GitHubExtensionRuntime;
