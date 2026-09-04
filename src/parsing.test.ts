import { describe, expect, test } from "vitest";
import {
  parseGitHubCommitInvocation,
  parseGitHubPrInvocation,
  parseGitHubPullRequestLocator,
  parseGitHubRepository,
} from "./parsing";

describe("GitHub PR invocation parsing", () => {
  test("accepts numbers, repository shorthands, URLs, and both repo option forms", () => {
    expect(parseGitHubPrInvocation(["123"])).toMatchObject({
      locator: { number: "123" },
      help: false,
    });
    expect(parseGitHubPrInvocation(["--repo", "modem-dev/hunk", "123"])).toMatchObject({
      locator: { number: "123" },
      explicitRepository: "modem-dev/hunk",
    });
    expect(parseGitHubPrInvocation(["123", "--repo=modem-dev/hunk"])).toMatchObject({
      locator: { number: "123" },
      explicitRepository: "modem-dev/hunk",
    });
    expect(parseGitHubPullRequestLocator("modem-dev/hunk#123")).toEqual({
      owner: "modem-dev",
      repo: "hunk",
      number: "123",
    });
    expect(parseGitHubPullRequestLocator("https://github.com/modem-dev/hunk/pull/123")).toEqual({
      owner: "modem-dev",
      repo: "hunk",
      number: "123",
    });
  });

  test("keeps tokens after the separator for delegated patch options", () => {
    expect(
      parseGitHubPrInvocation(["123", "--repo", "modem-dev/hunk", "--", "--pager"]),
    ).toMatchObject({ patchArgs: ["--pager"] });
    expect(parseGitHubPrInvocation(["--help"])).toMatchObject({ help: true });
  });

  test("rejects malformed or ambiguous invocations", () => {
    for (const args of [
      [],
      ["0"],
      ["-1"],
      ["1.5"],
      ["1", "2"],
      ["1", "--unknown"],
      ["1", "--repo"],
      ["1", "--repo", "a/b", "--repo", "c/d"],
      ["a/b#1", "--repo", "a/b"],
    ]) {
      expect(() => parseGitHubPrInvocation(args)).toThrow();
    }
  });

  test("rejects unsafe repository and URL forms", () => {
    for (const repository of [
      ".",
      "../repo",
      "owner/..",
      "owner/repo/extra",
      "owner%2Frepo/name",
    ]) {
      expect(() => parseGitHubRepository(repository)).toThrow();
    }
    for (const locator of [
      "owner/repo/extra#1",
      "owner%2Frepo/name#1",
      "https://gitlab.com/owner/repo/pull/1",
      "http://github.com/owner/repo/pull/1",
      "https://user@github.com/owner/repo/pull/1",
      "https://github.com/owner/repo/pull/1/files",
      "https://github.com/owner/repo/pull/1?diff=1",
      "https://github.com/owner/repo/pull/1#discussion",
    ]) {
      expect(() => parseGitHubPullRequestLocator(locator)).toThrow();
    }
  });
});

describe("GitHub commit invocation parsing", () => {
  test("accepts hexadecimal SHAs, repositories, and patch options", () => {
    expect(
      parseGitHubCommitInvocation(["ABCDEF1", "--repo", "modem-dev/hunk", "--", "--pager"]),
    ).toEqual({
      sha: "abcdef1",
      explicitRepository: "modem-dev/hunk",
      patchArgs: ["--pager"],
      help: false,
    });
    expect(parseGitHubCommitInvocation(["--help"])).toMatchObject({ help: true });
  });

  test("rejects refs, malformed SHAs, invalid repositories, and ambiguous arguments", () => {
    for (const args of [
      [],
      ["main"],
      ["abcdef"],
      ["abcdefg"],
      ["abcdef1", "1234567"],
      ["abcdef1", "--repo="],
      ["abcdef1", "--repo", "owner/.."],
    ]) {
      expect(() => parseGitHubCommitInvocation(args)).toThrow();
    }
  });
});
