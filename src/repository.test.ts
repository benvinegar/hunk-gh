import { describe, expect, test } from "vitest";
import { parseGitHubPrInvocation } from "./parsing";
import {
  parseGitHubRemoteRepository,
  readGitOrigin,
  resolveGitHubPullRequest,
  resolveGitHubRepository,
} from "./repository";

describe("GitHub repository resolution", () => {
  test("parses common github.com remote forms", () => {
    for (const remote of [
      "https://github.com/modem-dev/hunk.git",
      "ssh://git@github.com/modem-dev/hunk.git",
      "git://github.com/modem-dev/hunk.git",
      "git@github.com:modem-dev/hunk.git",
    ]) {
      expect(parseGitHubRemoteRepository(remote)).toEqual({ owner: "modem-dev", repo: "hunk" });
    }
  });

  test("rejects non-GitHub and malformed remotes", () => {
    for (const remote of [
      "https://gitlab.com/modem-dev/hunk.git",
      "https://github.com/modem-dev/hunk/extra.git",
      "git@github.com:modem-dev.git",
      "not a remote",
    ]) {
      expect(parseGitHubRemoteRepository(remote)).toBeNull();
    }
  });

  test("rejects an already-cancelled origin lookup before spawning Git", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readGitOrigin(process.cwd(), controller.signal)).rejects.toThrow("cancelled");
  });

  test("uses the injected origin only when a PR does not name a repository", async () => {
    const signal = new AbortController().signal;
    const calls: string[] = [];
    const resolveOrigin = async (cwd: string, receivedSignal: AbortSignal) => {
      expect(receivedSignal).toBe(signal);
      calls.push(cwd);
      return "git@github.com:modem-dev/hunk.git";
    };

    await expect(
      resolveGitHubPullRequest(parseGitHubPrInvocation(["123"]), "/repo", signal, resolveOrigin),
    ).resolves.toEqual({ owner: "modem-dev", repo: "hunk", number: "123" });
    await expect(
      resolveGitHubPullRequest(
        parseGitHubPrInvocation(["modem-dev/hunk#124"]),
        "/elsewhere",
        signal,
        resolveOrigin,
      ),
    ).resolves.toEqual({ owner: "modem-dev", repo: "hunk", number: "124" });
    expect(calls).toEqual(["/repo"]);
  });

  test("resolves explicit commit repositories without reading origin", async () => {
    let originReads = 0;
    await expect(
      resolveGitHubRepository("modem-dev/hunk", "/repo", new AbortController().signal, async () => {
        originReads += 1;
        return "";
      }),
    ).resolves.toEqual({ owner: "modem-dev", repo: "hunk" });
    expect(originReads).toBe(0);
  });
});
