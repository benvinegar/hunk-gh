import { tmpdir } from "node:os";
import {
  HunkExtensionUserError,
  type ExtensionCliCommandHandler,
  type ExtensionFactory,
} from "hunkdiff/extension";
import { fetchGitHubCommitDiff, fetchGitHubPullRequestDiff } from "./github";
import { GITHUB_COMMIT_HELP, GITHUB_HELP, GITHUB_PR_HELP } from "./help";
import { parseGitHubCommitInvocation, parseGitHubPrInvocation } from "./parsing";
import { readGitOrigin, resolveGitHubPullRequest, resolveGitHubRepository } from "./repository";
import { TemporaryPatchStore } from "./temporaryPatch";
import type { GitHubExtensionRuntime } from "./types";

interface PreparedDiff {
  bytes: Uint8Array;
  filename: string;
  patchArgs: readonly string[];
}

/** Resolves and fetches one PR command into a patch-ready diff. */
async function preparePullRequest(
  args: readonly string[],
  ctx: Parameters<ExtensionCliCommandHandler>[1],
  runtime: GitHubExtensionRuntime,
): Promise<PreparedDiff | typeof GITHUB_PR_HELP> {
  const invocation = parseGitHubPrInvocation(args);
  if (invocation.help) return GITHUB_PR_HELP;
  const target = await resolveGitHubPullRequest(
    invocation,
    ctx.cwd,
    ctx.signal,
    runtime.resolveOrigin,
  );
  await ctx.stderr.write(
    `Fetching GitHub pull request ${target.owner}/${target.repo}#${target.number}…\n`,
  );
  return {
    bytes: await fetchGitHubPullRequestDiff(target, ctx.signal, runtime.env, runtime.fetchImpl),
    filename: `${target.repo}-pr-${target.number}.diff`,
    patchArgs: invocation.patchArgs,
  };
}

/** Resolves and fetches one commit command into a patch-ready diff. */
async function prepareCommit(
  args: readonly string[],
  ctx: Parameters<ExtensionCliCommandHandler>[1],
  runtime: GitHubExtensionRuntime,
): Promise<PreparedDiff | typeof GITHUB_COMMIT_HELP> {
  const invocation = parseGitHubCommitInvocation(args);
  if (invocation.help) return GITHUB_COMMIT_HELP;
  const repository = await resolveGitHubRepository(
    invocation.explicitRepository,
    ctx.cwd,
    ctx.signal,
    runtime.resolveOrigin,
  );
  await ctx.stderr.write(
    `Fetching GitHub commit ${repository.owner}/${repository.repo}@${invocation.sha}…\n`,
  );
  return {
    bytes: await fetchGitHubCommitDiff(
      repository,
      invocation.sha,
      ctx.signal,
      runtime.env,
      runtime.fetchImpl,
    ),
    filename: `${repository.repo}-commit-${invocation.sha}.diff`,
    patchArgs: invocation.patchArgs,
  };
}

/** Builds the GitHub extension with injectable runtime boundaries for tests. */
export function createGitHubPrExtension(
  overrides: Partial<GitHubExtensionRuntime> = {},
): ExtensionFactory {
  const runtime: GitHubExtensionRuntime = {
    fetchImpl: overrides.fetchImpl ?? fetch,
    env: overrides.env ?? process.env,
    resolveOrigin: overrides.resolveOrigin ?? readGitOrigin,
    temporaryRoot: overrides.temporaryRoot ?? tmpdir(),
  };
  const patches = new TemporaryPatchStore(runtime.temporaryRoot);
  let activeRegistries = 0;

  return (hunk) => {
    activeRegistries += 1;
    let retired = false;
    const handler: ExtensionCliCommandHandler = async (args, ctx) => {
      if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
        await ctx.stdout.write(GITHUB_HELP);
        return { kind: "exit" };
      }

      let prepared: PreparedDiff | string;
      if (args[0] === "pr") {
        prepared = await preparePullRequest(args.slice(1), ctx, runtime);
      } else if (args[0] === "commit") {
        prepared = await prepareCommit(args.slice(1), ctx, runtime);
      } else {
        throw new HunkExtensionUserError(`Unknown GitHub command: ${args[0]}`, {
          suggestions: ["Run `hunk gh --help` to list available commands."],
        });
      }
      if (typeof prepared === "string") {
        await ctx.stdout.write(prepared);
        return { kind: "exit" };
      }
      if (ctx.signal.aborted)
        throw new HunkExtensionUserError("GitHub diff loading was cancelled.");

      const patchPath = await patches.write(prepared.filename, prepared.bytes);
      if (ctx.signal.aborted) {
        await patches.remove(patchPath);
        throw new HunkExtensionUserError("GitHub pull-request loading was cancelled.");
      }
      await ctx.stderr.write(
        `Opening ${prepared.bytes.byteLength.toLocaleString()} bytes in Hunk…\n`,
      );
      if (ctx.signal.aborted) {
        await patches.remove(patchPath);
        throw new HunkExtensionUserError("GitHub pull-request loading was cancelled.");
      }
      return { kind: "delegate", argv: ["patch", patchPath, ...prepared.patchArgs] };
    };

    hunk.registerCliCommand(
      {
        name: "gh",
        summary: "Review GitHub pull requests and commits",
        usage: "pr <number|owner/repo#number|pull-request-url> [--repo <owner/repo>]",
      },
      handler,
    );
    hunk.on("shutdown", () => {
      if (retired) return;
      retired = true;
      activeRegistries -= 1;
      if (activeRegistries === 0) patches.cleanup();
    });
  };
}

export default createGitHubPrExtension();
