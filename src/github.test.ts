import { describe, expect, test } from "vitest";
import {
  fetchGitHubCommitDiff,
  fetchGitHubCompareDiff,
  fetchGitHubPullRequestDiff,
} from "./github";
import type { GitHubFetch } from "./types";

const signal = () => new AbortController().signal;

describe("GitHub pull-request fetching", () => {
  test("sends the exact diff request with GH_TOKEN precedence", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const bytes = await fetchGitHubPullRequestDiff(
      { owner: "modem-dev", repo: "hunk", number: "123" },
      signal(),
      { GH_TOKEN: "preferred", GITHUB_TOKEN: "fallback" },
      (async (url, init) => {
        requestUrl = String(url);
        requestInit = init;
        return new Response("diff --git a/a.ts b/a.ts\n", { status: 200 });
      }) as GitHubFetch,
    );
    expect(requestUrl).toBe("https://api.github.com/repos/modem-dev/hunk/pulls/123");
    expect(requestInit?.redirect).toBe("manual");
    expect(new Headers(requestInit?.headers).get("accept")).toBe("application/vnd.github.v3.diff");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer preferred");
    expect(new TextDecoder().decode(bytes)).toContain("diff --git");
  });

  test("keeps malformed tokens, HTTP errors, and network errors credential-safe", async () => {
    const target = { owner: "private", repo: "repo", number: "7" };
    let fetches = 0;
    await expect(
      fetchGitHubPullRequestDiff(target, signal(), { GH_TOKEN: "top-secret\nvalue" }, (async () => {
        fetches += 1;
        return new Response("unexpected");
      }) as GitHubFetch),
    ).rejects.toThrow("cannot be sent in an HTTP header");
    expect(fetches).toBe(0);

    for (const response of [
      new Response("secret response body", { status: 401 }),
      new Response("secret response body", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" },
      }),
      new Response("secret response body", { status: 404 }),
      new Response("secret response body", { status: 500 }),
      new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } }),
    ]) {
      try {
        await fetchGitHubPullRequestDiff(
          target,
          signal(),
          { GH_TOKEN: "top-secret-token" },
          (async () => response) as GitHubFetch,
        );
        throw new Error("Expected the request to fail.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("top-secret-token");
        expect(message).not.toContain("secret response body");
      }
    }

    await expect(
      fetchGitHubPullRequestDiff(target, signal(), {}, (async () => {
        throw new Error("network internals");
      }) as GitHubFetch),
    ).rejects.toThrow("could not be reached");
  });

  test("rejects declared and streamed bodies over 64 MiB", async () => {
    const target = { owner: "modem-dev", repo: "hunk", number: "1" };
    await expect(
      fetchGitHubPullRequestDiff(
        target,
        signal(),
        {},
        (async () =>
          new Response("small", {
            headers: { "content-length": String(64 * 1024 * 1024 + 1) },
          })) as GitHubFetch,
      ),
    ).rejects.toThrow("64 MiB");

    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(32 * 1024 * 1024));
        controller.enqueue(new Uint8Array(32 * 1024 * 1024));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      fetchGitHubPullRequestDiff(
        target,
        signal(),
        {},
        (async () => new Response(body)) as GitHubFetch,
      ),
    ).rejects.toThrow("64 MiB");
    expect(cancelled).toBe(true);
  });

  test("stops reading a streamed body when cancelled", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        pulls += 1;
        stream.enqueue(new TextEncoder().encode("diff --git a/a b/a\n"));
        controller.abort();
      },
    });

    await expect(
      fetchGitHubPullRequestDiff(
        { owner: "modem-dev", repo: "hunk", number: "1" },
        controller.signal,
        {},
        (async () => new Response(body)) as GitHubFetch,
      ),
    ).rejects.toThrow("cancelled");
    expect(pulls).toBe(1);
  });
});

describe("GitHub comparison fetching", () => {
  test("encodes refs independently and requests a bounded diff without redirects", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const bytes = await fetchGitHubCompareDiff(
      { owner: "modem-dev", repo: "hunk" },
      "release/v1",
      "feature#topic",
      signal(),
      { GH_TOKEN: "token" },
      (async (url, init) => {
        requestUrl = String(url);
        requestInit = init;
        return new Response("diff --git a/a b/a\n");
      }) as GitHubFetch,
    );
    expect(requestUrl).toBe(
      "https://api.github.com/repos/modem-dev/hunk/compare/release%2Fv1...feature%23topic",
    );
    expect(requestInit?.redirect).toBe("manual");
    expect(new Headers(requestInit?.headers).get("accept")).toBe("application/vnd.github.v3.diff");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer token");
    expect(new TextDecoder().decode(bytes)).toContain("diff --git");
  });

  test("keeps tokens and response bodies out of comparison errors", async () => {
    for (const response of [
      new Response("sensitive body", { status: 401 }),
      new Response("sensitive body", { status: 403 }),
      new Response("sensitive body", { status: 404 }),
      new Response("sensitive body", { status: 500 }),
      new Response(null, { status: 302 }),
    ]) {
      try {
        await fetchGitHubCompareDiff(
          { owner: "private", repo: "repo" },
          "base",
          "head",
          signal(),
          { GH_TOKEN: "top-secret-token" },
          (async () => response) as GitHubFetch,
        );
        throw new Error("Expected comparison failure.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain("top-secret-token");
        expect(message).not.toContain("sensitive body");
      }
    }
  });

  test("reports a successful empty comparison as no changes", async () => {
    for (const response of [new Response(""), new Response(null)]) {
      await expect(
        fetchGitHubCompareDiff(
          { owner: "modem-dev", repo: "hunk" },
          "base",
          "head",
          signal(),
          {},
          (async () => response) as GitHubFetch,
        ),
      ).rejects.toThrow("no changes between base and head");
    }
  });

  test("reports cancellation and network failures without transport details", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchGitHubCompareDiff(
        { owner: "modem-dev", repo: "hunk" },
        "base",
        "head",
        controller.signal,
        {},
        (async () => {
          throw new Error("network internals");
        }) as GitHubFetch,
      ),
    ).rejects.toThrow("cancelled");
    const streamingController = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      pull(stream) {
        stream.enqueue(new TextEncoder().encode("diff --git a/a b/a\n"));
        streamingController.abort();
      },
    });
    await expect(
      fetchGitHubCompareDiff(
        { owner: "modem-dev", repo: "hunk" },
        "base",
        "head",
        streamingController.signal,
        {},
        (async () => new Response(body)) as GitHubFetch,
      ),
    ).rejects.toThrow("diff loading was cancelled");

    await expect(
      fetchGitHubCompareDiff(
        { owner: "modem-dev", repo: "hunk" },
        "base",
        "head",
        signal(),
        {},
        (async () => {
          throw new Error("network internals");
        }) as GitHubFetch,
      ),
    ).rejects.toThrow("could not be reached");
  });
});

describe("GitHub commit fetching", () => {
  test("requests the commit diff without following redirects", async () => {
    let requestUrl = "";
    const bytes = await fetchGitHubCommitDiff(
      { owner: "modem-dev", repo: "hunk" },
      "abcdef1",
      signal(),
      {},
      (async (url, init) => {
        requestUrl = String(url);
        expect(init?.redirect).toBe("manual");
        return new Response("diff --git a/a b/a\n", { status: 200 });
      }) as GitHubFetch,
    );
    expect(requestUrl).toBe("https://api.github.com/repos/modem-dev/hunk/commits/abcdef1");
    expect(new TextDecoder().decode(bytes)).toContain("diff --git");
  });

  test("applies the same malformed-token and redirect safeguards", async () => {
    let fetches = 0;
    await expect(
      fetchGitHubCommitDiff(
        { owner: "private", repo: "repo" },
        "abcdef1",
        signal(),
        { GH_TOKEN: "secret\nvalue" },
        (async () => {
          fetches += 1;
          return new Response("unexpected");
        }) as GitHubFetch,
      ),
    ).rejects.toThrow("cannot be sent in an HTTP header");
    expect(fetches).toBe(0);

    await expect(
      fetchGitHubCommitDiff(
        { owner: "private", repo: "repo" },
        "abcdef1",
        signal(),
        { GH_TOKEN: "secret" },
        (async () => new Response("sensitive body", { status: 302 })) as GitHubFetch,
      ),
    ).rejects.toThrow("refusing to forward credentials");
  });
});
